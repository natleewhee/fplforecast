"""Best-XI selection over projected points, and squad-vs-pool gap ranking.
Pure -- no I/O. ``best_xi`` / ``VALID_FORMATIONS`` are lifted verbatim from
``scripts/compute_forecast.py`` (U1); ``window_points`` / ``rank_against_pool``
are U7 (R12, R13, KD8, KTD5, KTD11)."""

from __future__ import annotations

from collections.abc import Callable, Mapping

from engine.config import DISPLAY_GAP_ROWS, PRICE_BAND_M, ROLLING_WINDOW
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


def rank_against_pool(
    squad_ids: list,
    pool_ids: list,
    window_pts: dict,
    price_by_id: dict,
    position_by_id: dict,
    minutes_risk_by_id: dict | None = None,
) -> list[dict]:
    """One row per squad player: the best same-position pool alternative within
    ``engine.config.PRICE_BAND_M`` of their price, and the window-points gap to
    it. Cold-start pool players (``window_pts`` is ``None``) are never offered
    as an alternative (KTD11). Rows are sorted by gap, largest first; the caller
    slices the top ``DISPLAY_GAP_ROWS`` with a positive gap."""
    minutes_risk_by_id = minutes_risk_by_id or {}
    rows: list[dict] = []

    for squad_id in squad_ids:
        squad_pts = window_pts.get(squad_id)
        squad_price = price_by_id.get(squad_id)
        squad_pos = position_by_id.get(squad_id)

        best_id = None
        best_pts = None
        for cand_id in pool_ids:
            if cand_id == squad_id or position_by_id.get(cand_id) != squad_pos:
                continue
            cand_pts = window_pts.get(cand_id)
            if cand_pts is None:  # cold-start pool player
                continue
            cand_price = price_by_id.get(cand_id)
            if cand_price is None or squad_price is None:
                continue
            if abs(cand_price - squad_price) > PRICE_BAND_M:
                continue
            if best_pts is None or cand_pts > best_pts:
                best_id, best_pts = cand_id, cand_pts

        if best_id is None or squad_pts is None:
            gap = 0.0
        else:
            gap = best_pts - squad_pts

        rows.append(
            {
                "squadPlayer": squad_id,
                "bestAlternative": best_id,
                "gapPoints": round(gap, 2),
                "minutesRisk": bool(minutes_risk_by_id.get(best_id, False)),
            }
        )

    rows.sort(key=lambda r: r["gapPoints"], reverse=True)
    return rows


def top_gap_rows(rows: list[dict], limit: int = DISPLAY_GAP_ROWS) -> list[dict]:
    """The display slice: the ``limit`` largest positive-gap rows (R12)."""
    return [row for row in rows if row["gapPoints"] > 0][:limit]


def top_alternatives(
    squad_id,
    pool_ids: list,
    window_pts: dict,
    price_by_id: dict,
    position_by_id: dict,
    limit: int = 3,
) -> list[dict]:
    """The ``limit`` best same-position, in-price-band alternatives to one squad
    player, ordered by window points (largest gain first). Cold-start pool
    players are excluded (KTD11). Each row: ``id``, ``gapPoints`` (``None`` when
    the held player is himself cold-start -- no baseline to measure a gain
    against)."""
    squad_pts = window_pts.get(squad_id)  # None when the held player is cold-start
    squad_price = price_by_id.get(squad_id)
    squad_pos = position_by_id.get(squad_id)
    if squad_price is None:
        return []

    candidates = []
    for cand_id in pool_ids:
        if cand_id == squad_id or position_by_id.get(cand_id) != squad_pos:
            continue
        cand_pts = window_pts.get(cand_id)
        cand_price = price_by_id.get(cand_id)
        if cand_pts is None or cand_price is None:
            continue
        if abs(cand_price - squad_price) > PRICE_BAND_M:
            continue
        candidates.append((cand_id, cand_pts))

    candidates.sort(key=lambda c: c[1], reverse=True)
    return [
        {
            "id": cand_id,
            "gapPoints": None if squad_pts is None else round(cand_pts - squad_pts, 2),
        }
        for cand_id, cand_pts in candidates[:limit]
    ]
