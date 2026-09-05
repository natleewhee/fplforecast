"""ILP-based squad optimiser (2026-09-05 transfer-scenarios plan). One
function, ``solve_squad``, drives every scenario family -- pinned-transfer-
count, Free Hit, and Wildcard -- via its arguments. Money is worked in
integer tenths of a million (e.g. £7.7m -> 77) inside the ILP to avoid float
infeasibility bugs; callers pass and receive plain float £m."""

from __future__ import annotations

from dataclasses import dataclass, field

import pulp

from engine.config import (
    CLUB_LIMIT,
    HIT_COST,
    HIT_TIEBREAK_EPSILON,
    SQUAD_COMPOSITION,
    SQUAD_SIZE,
    XI_FORMATION_BOUNDS,
    XI_SIZE,
)


def _to_tenths(value: float) -> int:
    return round(value * 10)


@dataclass
class ScenarioResult:
    """One solved scenario. ``xi_by_gw`` / ``captain_by_gw`` are keyed by
    gameweek offset within the horizon (0-indexed). ``points`` is the gross
    projected total (optimal XI/captain each week); ``net_points`` subtracts
    ``hit_cost``."""

    squad_ids: list[int]
    xi_by_gw: list[list[int]]
    captain_by_gw: list[int]
    points: float
    transfers_in: list[int]
    transfers_out: list[int]
    hit_cost: int
    net_points: float
    horizon_gws: int
    feasible: bool = True


def _infeasible(horizon_gws: int) -> ScenarioResult:
    return ScenarioResult(
        squad_ids=[],
        xi_by_gw=[[] for _ in range(horizon_gws)],
        captain_by_gw=[None] * horizon_gws,
        points=0.0,
        transfers_in=[],
        transfers_out=[],
        hit_cost=0,
        net_points=0.0,
        horizon_gws=horizon_gws,
        feasible=False,
    )


def solve_squad(
    players: list[dict],
    held: list[int] | set[int],
    bank: float,
    free_transfers: int,
    horizon_gws: int,
    *,
    max_transfers: int | None = None,
    unlimited: bool = False,
) -> ScenarioResult:
    """Solve for the 15-man squad (plus per-gameweek XI and captain) that
    maximises projected points over ``horizon_gws`` gameweeks (the first
    ``horizon_gws`` entries of each player's ``perGameweek``), subject to
    squad-composition, club-limit, and budget constraints.

    ``held`` is the set of player ids currently owned. ``bank`` is spare
    cash in £m. ``free_transfers`` free transfers available this window.

    ``max_transfers``, if given, pins the exact number of players transferred
    out of ``held`` (used for the k=0..FT+1 pinned-count scenario family).
    ``unlimited=True`` drops the held-squad budget carry-over and the hit
    penalty entirely (Free Hit / Wildcard: full budget, no transfer cost).
    """
    held_ids = set(held)
    by_id = {p["id"]: p for p in players}
    prob = pulp.LpProblem("squad", pulp.LpMaximize)

    x = {p["id"]: pulp.LpVariable(f"x_{p['id']}", cat="Binary") for p in players}
    start = {
        p["id"]: [
            pulp.LpVariable(f"start_{p['id']}_{gw}", cat="Binary") for gw in range(horizon_gws)
        ]
        for p in players
    }
    cap = {
        p["id"]: [
            pulp.LpVariable(f"cap_{p['id']}_{gw}", cat="Binary") for gw in range(horizon_gws)
        ]
        for p in players
    }

    # Squad size, composition, club limits.
    prob += pulp.lpSum(x.values()) == SQUAD_SIZE
    for elem_type, count in SQUAD_COMPOSITION.items():
        prob += pulp.lpSum(x[p["id"]] for p in players if p["elementType"] == elem_type) == count
    clubs = {p["team"] for p in players}
    for club in clubs:
        prob += pulp.lpSum(x[p["id"]] for p in players if p["team"] == club) <= CLUB_LIMIT

    # Per-gameweek XI / formation / captain.
    for gw in range(horizon_gws):
        for p in players:
            prob += start[p["id"]][gw] <= x[p["id"]]
            prob += cap[p["id"]][gw] <= start[p["id"]][gw]
        prob += pulp.lpSum(start[p["id"]][gw] for p in players) == XI_SIZE
        prob += pulp.lpSum(cap[p["id"]][gw] for p in players) == 1
        for elem_type, (lo, hi) in XI_FORMATION_BOUNDS.items():
            count = pulp.lpSum(
                start[p["id"]][gw] for p in players if p["elementType"] == elem_type
            )
            prob += count >= lo
            prob += count <= hi

    # Budget: buys of non-held players <= bank + sales of held players not kept.
    bank_tenths = _to_tenths(bank)
    if unlimited:
        prob += (
            pulp.lpSum(_to_tenths(p["price"]) * x[p["id"]] for p in players) <= bank_tenths
        )
    else:
        buys = pulp.lpSum(
            _to_tenths(p["price"]) * x[p["id"]] for p in players if p["id"] not in held_ids
        )
        sales = pulp.lpSum(
            _to_tenths(by_id[pid]["sellPrice"]) * (1 - x[pid])
            for pid in held_ids
            if pid in by_id
        )
        prob += buys <= bank_tenths + sales

    # Hits: only for held players actually transferred out; skipped entirely
    # for unlimited (Free Hit / Wildcard) scenarios.
    if unlimited:
        hits = None
    else:
        transferred_out = pulp.lpSum(1 - x[pid] for pid in held_ids if pid in by_id)
        if max_transfers is not None:
            prob += transferred_out == max_transfers
        hits = pulp.LpVariable("hits", lowBound=0, cat="Integer")
        prob += hits >= transferred_out - free_transfers

    # Objective: sum of per-GW (starter xP + captain xP again), minus hits.
    points_terms = []
    for p in players:
        per_gw = p["perGameweek"]
        for gw in range(horizon_gws):
            xp = per_gw[gw]
            points_terms.append(xp * start[p["id"]][gw])
            points_terms.append(xp * cap[p["id"]][gw])
    objective = pulp.lpSum(points_terms)
    if hits is not None:
        objective = objective - HIT_COST * hits - HIT_TIEBREAK_EPSILON * hits
    prob += objective

    status = prob.solve(pulp.PULP_CBC_CMD(msg=False))
    if pulp.LpStatus[status] != "Optimal":
        return _infeasible(horizon_gws)

    squad_ids = [pid for pid, var in x.items() if var.value() > 0.5]
    xi_by_gw = [
        [pid for pid, var in start.items() if var[gw].value() > 0.5] for gw in range(horizon_gws)
    ]
    captain_by_gw = [
        next(pid for pid, var in cap.items() if var[gw].value() > 0.5) for gw in range(horizon_gws)
    ]
    gross_points = sum(
        by_id[pid]["perGameweek"][gw] for gw in range(horizon_gws) for pid in xi_by_gw[gw]
    ) + sum(by_id[captain_by_gw[gw]]["perGameweek"][gw] for gw in range(horizon_gws))
    hit_cost_value = int(round(hits.value())) * HIT_COST if hits is not None else 0
    transfers_out = sorted(pid for pid in held_ids if pid not in set(squad_ids))
    transfers_in = sorted(pid for pid in squad_ids if pid not in held_ids)

    return ScenarioResult(
        squad_ids=sorted(squad_ids),
        xi_by_gw=xi_by_gw,
        captain_by_gw=captain_by_gw,
        points=round(gross_points, 2),
        transfers_in=transfers_in,
        transfers_out=transfers_out,
        hit_cost=hit_cost_value,
        net_points=round(gross_points - hit_cost_value, 2),
        horizon_gws=horizon_gws,
    )


def derive_free_transfers(
    history_current: list[dict], chips: list, target_gw: int
) -> tuple[int, str]:
    """KD5: 1 free transfer accrued per gameweek since GW1, capped at
    ``FT_MAX_BANKED``, minus transfers already used, floored at 1.

    ``history_current`` is the ``current`` list from the entry-history
    snapshot (one row per completed gameweek with ``event_transfers``);
    ``chips`` is that snapshot's ``chips`` list (currently unused in the
    arithmetic -- reserved for a future rule around chip gameweeks, e.g. a
    Wildcard/Free Hit gameweek not consuming a free transfer).
    """
    from engine.config import FT_MAX_BANKED

    gws_elapsed = max(0, target_gw - 1)
    transfers_used = sum(gw.get("event_transfers", 0) or 0 for gw in history_current)
    raw = gws_elapsed - transfers_used
    value = max(1, min(FT_MAX_BANKED, raw))
    derivation = (
        f"{gws_elapsed} FT accrued since GW1 (1/GW), capped at {FT_MAX_BANKED}, "
        f"minus {transfers_used} used"
    )
    return value, derivation
