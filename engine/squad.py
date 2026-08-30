"""Best-XI selection over projected points. Pure — no I/O. ``best_xi`` and
``VALID_FORMATIONS`` are lifted verbatim from ``scripts/compute_forecast.py``
(U1)."""

from __future__ import annotations

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
