"""Best-XI selection over projected points, and squad-vs-pool upgrade
detection. Pure -- no I/O. ``best_xi`` / ``VALID_FORMATIONS`` are lifted
verbatim from ``scripts/compute_forecast.py`` (U1); ``window_points`` is U7
(R12, R13, KD8, KTD5, KTD11); ``pool_upgrades`` is U3/U6 (R12, R13, KTD4,
KTD8) -- the sole squad-vs-pool upgrade surface, at any price. ``floor_ceiling``
/ ``xi_floor_ceiling`` are UA2 of the 2026-09-03 safety-score plan (Part A)."""

from __future__ import annotations

import math
import statistics
from collections.abc import Callable, Mapping

from engine.config import (
    ROLLING_WINDOW,
    SAFETY_BAND_PROVISIONAL_STDEV,
    SAFETY_BAND_Z,
    SAFETY_MIN_SAMPLE_PER_POSITION,
)
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


def _stdev_for_position(element_type, residuals_by_position: Mapping | None) -> tuple[float, bool]:
    """The realised spread for one position -- ``(stdev, provisional)``. Below
    ``SAFETY_MIN_SAMPLE_PER_POSITION`` scored residuals the position falls back
    to ``SAFETY_BAND_PROVISIONAL_STDEV`` and is flagged provisional, the same
    shape ``engine.config.PAR_MARGIN_MIN_GAMEWEEKS`` uses for the par margin."""
    residuals = (residuals_by_position or {}).get(str(element_type)) or []
    if len(residuals) < SAFETY_MIN_SAMPLE_PER_POSITION:
        return SAFETY_BAND_PROVISIONAL_STDEV, True
    return statistics.pstdev(residuals), False


def floor_ceiling(
    projected_points: float | None,
    element_type,
    residuals_by_position: Mapping | None,
) -> dict | None:
    """A projection's floor/ceiling band: the point estimate plus or minus
    ``SAFETY_BAND_Z`` standard deviations of realised ``actual - projected``
    error for that position (KDA1 -- realised residuals, not the model's own
    minutes-risk terms, which already feed the point estimate). ``None`` for a
    player with no projection to band."""
    if projected_points is None:
        return None
    stdev, provisional = _stdev_for_position(element_type, residuals_by_position)
    band = SAFETY_BAND_Z * stdev
    return {
        "floor": round(max(0.0, projected_points - band), 2),
        "ceiling": round(projected_points + band, 2),
        "bandProvisional": provisional,
    }


def xi_floor_ceiling(xi: list[dict], residuals_by_position: Mapping | None) -> dict:
    """The XI-level band: each row is ``{"projected", "elementType"}`` plus an
    optional ``multiplier`` (2 for the captain, whose points and variance both
    double). Aggregates via ``sqrt(sum of variance)`` -- the independence
    approximation (KDA3): fifteen players don't all bust at once, so summing
    each player's range directly would overstate the band."""
    total = 0.0
    variance_sum = 0.0
    any_provisional = False
    for p in xi:
        multiplier = p.get("multiplier", 1)
        total += multiplier * p["projected"]
        stdev, provisional = _stdev_for_position(p["elementType"], residuals_by_position)
        variance_sum += (multiplier * stdev) ** 2
        any_provisional = any_provisional or provisional
    band = SAFETY_BAND_Z * math.sqrt(variance_sum)
    return {
        "floor": round(max(0.0, total - band), 2),
        "ceiling": round(total + band, 2),
        "bandProvisional": any_provisional,
    }
