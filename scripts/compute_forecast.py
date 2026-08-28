"""Best XI + captain, from projected points per player in the squad.

Phase 1 has started replacing the dumb slice one component at a time (see
the plan doc). Projection per player, in order of preference:

  1. minutes model (scripts/minutes_model.py): expected_minutes/90 x per_90_points
  2. last-ROLLING_WINDOW-GW flat average total points (the original dumb slice,
     used as a fallback — e.g. for a player the minutes model hasn't seen yet)

Both are scaled by a hard availability multiplier (injury/suspension veto,
or the partial chance_of_playing_next_round) applied *after* the projection,
per the plan's "availability is a veto, not a feature" principle.
"""

from __future__ import annotations

import itertools
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
TEAM_ID = "1168513"
ROLLING_WINDOW = 5
UNAVAILABLE_STATUSES = {"i", "s", "u", "n"}  # injured, suspended, unavailable, not in squad

POSITIONS = {1: "GKP", 2: "DEF", 3: "MID", 4: "FWD"}

# (GKP, DEF, MID, FWD) counts for every legal starting XI shape.
VALID_FORMATIONS = [
    (g, d, m, f)
    for g in (1,)
    for d in range(3, 6)
    for m in range(2, 6)
    for f in range(1, 4)
    if g + d + m + f == 11
]


def latest_file(subdir: str) -> Path | None:
    d = DATA_DIR / subdir
    if not d.exists():
        return None
    files = sorted(d.glob("*.json"))
    return files[-1] if files else None


def load_json(path: Path) -> dict:
    return json.loads(path.read_text())


def load_bootstrap() -> dict | None:
    path = latest_file("bootstrap-static")
    return load_json(path) if path else None


def load_rolling_averages() -> dict[int, float]:
    """Mean total points over the last ROLLING_WINDOW finished gameweeks, per player id."""
    event_live_dir = DATA_DIR / "event-live"
    if not event_live_dir.exists():
        return {}
    gw_files = sorted(
        event_live_dir.glob("gw*.json"),
        key=lambda p: int(p.stem.removeprefix("gw")),
    )
    recent = gw_files[-ROLLING_WINDOW:]

    points_by_player: dict[int, list[int]] = {}
    for f in recent:
        data = load_json(f)
        for el in data.get("elements", []):
            pid = el["id"]
            total = el.get("stats", {}).get("total_points", 0)
            points_by_player.setdefault(pid, []).append(total)

    return {pid: sum(vals) / len(vals) for pid, vals in points_by_player.items()}


def load_minutes_model() -> dict[str, dict]:
    d = DATA_DIR / "minutes-model"
    if not d.exists():
        return {}
    files = sorted(d.glob("*.json"))
    if not files:
        return {}
    return load_json(files[-1]).get("predictions", {})


def load_latest_picks() -> tuple[int, list[dict]] | None:
    picks_dir = DATA_DIR / f"picks-{TEAM_ID}"
    if not picks_dir.exists():
        return None
    gw_files = sorted(
        picks_dir.glob("gw*.json"),
        key=lambda p: int(p.stem.removeprefix("gw")),
    )
    if not gw_files:
        return None
    latest = gw_files[-1]
    gw = int(latest.stem.removeprefix("gw"))
    data = load_json(latest)
    return gw, data.get("picks", [])


def availability_multiplier(el: dict) -> float:
    if el.get("status") in UNAVAILABLE_STATUSES:
        return 0.0
    chance = el.get("chance_of_playing_next_round")
    if chance is None:
        return 1.0
    return chance / 100.0


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


def main() -> int:
    bootstrap = load_bootstrap()
    if bootstrap is None:
        print("No bootstrap-static snapshot yet — run scripts/snapshot.py first", file=sys.stderr)
        return 1

    rolling = load_rolling_averages()
    minutes_model = load_minutes_model()
    elements_by_id = {el["id"]: el for el in bootstrap["elements"]}
    teams_by_id = {t["id"]: t["short_name"] for t in bootstrap["teams"]}

    picks_result = load_latest_picks()
    if picks_result is None:
        print("No squad picks snapshot yet (no finished gameweek) — nothing to forecast", file=sys.stderr)
        return 0

    gw, picks = picks_result
    squad = []
    for pick in picks:
        el = elements_by_id.get(pick["element"])
        if el is None:
            continue

        mm = minutes_model.get(str(el["id"]))
        if mm:
            base = (mm["expectedMinutes"] / 90) * mm["per90Points"]
            component = "minutes-model"
        else:
            base = rolling.get(el["id"], 0.0)
            component = "rolling-average"

        projected = base * availability_multiplier(el)
        squad.append(
            {
                "id": el["id"],
                "webName": el["web_name"],
                "team": teams_by_id.get(el["team"], "???"),
                "position": POSITIONS[el["element_type"]],
                "element_type": el["element_type"],
                "projected": round(projected, 2),
                "component": component,
                "expectedMinutes": mm["expectedMinutes"] if mm else None,
            }
        )

    starting, bench = best_xi(squad)
    captain = max(starting, key=lambda p: p["projected"]) if starting else None
    vice = max(
        (p for p in starting if p is not captain),
        key=lambda p: p["projected"],
        default=None,
    )

    out = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "basedOnGameweek": gw,
        "rollingWindow": ROLLING_WINDOW,
        "startingXI": starting,
        "bench": bench,
        "captain": captain["webName"] if captain else None,
        "captainId": captain["id"] if captain else None,
        "viceCaptain": vice["webName"] if vice else None,
        "viceCaptainId": vice["id"] if vice else None,
    }

    out_dir = DATA_DIR / "forecast"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"gw{gw + 1}.json"
    out_path.write_text(json.dumps(out, indent=2, sort_keys=True))
    print(f"forecast for GW{gw + 1} (based on GW{gw} squad): -> {out_path}")
    print(f"captain: {out['captain']}, vice: {out['viceCaptain']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
