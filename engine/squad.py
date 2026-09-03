"""Best-XI selection over projected points, and squad-vs-pool upgrade
detection. Pure -- no I/O. ``best_xi`` / ``VALID_FORMATIONS`` are lifted
verbatim from ``scripts/compute_forecast.py`` (U1); ``window_points`` is U7
(R12, R13, KD8, KTD5, KTD11); ``pool_upgrades`` is U3/U6 (R12, R13, KTD4,
KTD8) -- the sole squad-vs-pool upgrade surface, at any price."""

from __future__ import annotations

from collections.abc import Callable, Mapping

from engine.config import ROLLING_WINDOW
from engine.history import ColdStart

# (GKP, DEF, MID, FWD) counts for every legal starting XI shape.
VALID_FORMATIONS = [
    (g, d, m, f)
    for g in (1,)
    for d in range(3, 6)
    for m in range(2, 6)
    for f in range(1, 4)
    if g + d + m + f == 11
]


def best_xi(squad: list[dict]) -> tuple[list[dict], list[dict]]:
    """Brute-force every legal formation, return (starting XI, bench) sorted by position."""
    by_position: dict[int, list[dict]] = {1: [], 2: [], 3: [], 4: []}
    for p in squad:
        by_position[p["element_type"]].append(p)
    for pos in by_position.values():
        pos.sort(key=lambda p: p["projected"], reverse=True)

    best_total = -1.0
    best_combo: list[dict] = []
    for g, d, m, f in VALID_FORMATIONS:
        counts = {1: g, 2: d, 3: m, 4: f}
        if any(len(by_position[pos]) < n for pos, n in counts.items()):
            continue
        combo = [
            p
            for pos, n in counts.items()
            for p in by_position[pos][:n]
        ]
        total = sum(p["projected"] for p in combo)
        if total > best_total:
            best_total = total
            best_combo = combo

    starting_ids = {p["id"] for p in best_combo}
    bench = [p for p in squad if p["id"] not in starting_ids]
    bench.sort(key=lambda p: p["projected"], reverse=True)
    return best_combo, bench


def window_points(
    feature_frame,
    project_fn: Callable[[Mapping, int], float | ColdStart],
    start_gw: int,
    window: int = ROLLING_WINDOW,
) -> dict:
    """Sum of ``project_fn(row, gw)`` over ``start_gw .. start_gw + window - 1``
    per player (``window`` defaults to KD8's 5; pass ``window=1`` for the
    captaincy score). A player who is cold-start in any gameweek of the window
    maps to ``None`` -- never a partial total."""
    totals: dict = {}
    for player_id, row in feature_frame.iterrows():
        total = 0.0
        for gw in range(start_gw, start_gw + window):
            projected = project_fn(row, gw)
            if isinstance(projected, ColdStart):
                total = None
                break
            total += projected
        totals[player_id] = total
    return totals


def window_points_by_gw(
    feature_frame,
    project_fn: Callable[[Mapping, int], float | ColdStart],
    start_gw: int,
    window: int = ROLLING_WINDOW,
) -> dict:
    """Like ``window_points`` but keeps the per-gameweek values: ``{player_id:
    [gw0, gw1, ...]}`` over ``start_gw .. start_gw + window - 1``. A player who
    is cold-start in any gameweek of the window maps to ``None`` -- never a
    partial list -- matching ``window_points`` (U1)."""
    by_gw: dict = {}
    for player_id, row in feature_frame.iterrows():
        vals: list | None = []
        for gw in range(start_gw, start_gw + window):
            projected = project_fn(row, gw)
            if isinstance(projected, ColdStart):
                vals = None
                break
            vals.append(projected)
        by_gw[player_id] = vals
    return by_gw


def pool_upgrades(squad: list[dict], pool: list[dict], bank: float) -> dict:
    """For each held player, every same-position pool player with a higher
    five-gameweek total -- no price band. Returns ``{squad_id: [rows]}`` with
    each row ``{poolPlayerId, gap, priceDelta, overBudget}``, largest gap first.
    ``overBudget`` is true when the price rise exceeds ``bank`` (the sale of the
    held player is assumed to free its own price) (R12, KTD4)."""
    out: dict = {}
    for held in squad:
        held_total = held.get("total")
        if held_total is None:
            out[held["id"]] = []
            continue
        rows = []
        for cand in pool:
            if cand["id"] == held["id"] or cand.get("position") != held.get("position"):
                continue
            cand_total = cand.get("total")
            if cand_total is None or cand_total <= held_total:
                continue
            price_delta = round(cand["price"] - held["price"], 1)
            rows.append(
                {
                    "poolPlayerId": cand["id"],
                    "gap": round(cand_total - held_total, 2),
                    "priceDelta": price_delta,
                    "overBudget": price_delta > bank + 1e-6,
                }
            )
        rows.sort(key=lambda r: r["gap"], reverse=True)
        out[held["id"]] = rows
    return out
