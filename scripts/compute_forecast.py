"""Best XI + captain, from projected points per player in the squad.

Thin CLI wrapper (U1): this module loads the latest snapshots from ``data/``,
calls the pure ``engine/`` library for the projection math and best-XI
selection, and writes ``data/forecast/gwNN.json``. The per-player projection
logic (minutes model / rolling-average fallback, availability veto, FDR
multiplier) lives in ``engine/features.py``; formation search lives in
``engine/squad.py``.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

# Until U2's pyproject.toml makes `engine` a pip-installable package, put the
# repo root on sys.path so `python scripts/compute_forecast.py` can import it.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from engine.features import project_squad
from engine.squad import best_xi

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
TEAM_ID = "1168513"
ROLLING_WINDOW = 5


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


def load_fixtures() -> list[dict]:
    path = latest_file("fixtures")
    return load_json(path).get("fixtures", []) if path else []


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


def load_overrides(gw: int) -> list[dict]:
    """Manual transfers made since the last auto-pulled picks snapshot, applied
    on top of it. Only valid for the gw they were recorded against — if picks
    have since been re-pulled for a later gw, the auto-pulled squad already
    reflects reality and a stale override would double-apply, so it's dropped."""
    path = DATA_DIR / "overrides" / "transfers.json"
    if not path.exists():
        return []
    data = load_json(path)
    if data.get("basedOnGw") != gw:
        print(f"overrides: ignoring stale overrides (recorded for GW{data.get('basedOnGw')}, picks are GW{gw})")
        return []
    return data.get("transfers", [])


def apply_overrides(picks: list[dict], overrides: list[dict]) -> list[dict]:
    """Swap 'out' player ids for 'in' player ids. Does NOT validate budget or
    selling-price arithmetic — that's an explicitly deferred risk in the plan
    doc (D3/'Selling-price arithmetic'). Treat the resulting squad as
    directionally right, not budget-verified."""
    element_ids = [p["element"] for p in picks]
    for override in overrides:
        if override["out"] in element_ids:
            element_ids[element_ids.index(override["out"])] = override["in"]
        else:
            print(f"overrides: 'out' player {override['out']} not in current squad, skipping")
    return [{"element": eid} for eid in element_ids]


def main() -> int:
    bootstrap = load_bootstrap()
    if bootstrap is None:
        print("No bootstrap-static snapshot yet — run scripts/snapshot.py first", file=sys.stderr)
        return 1

    rolling = load_rolling_averages()
    minutes_model = load_minutes_model()
    fixtures = load_fixtures()
    elements_by_id = {el["id"]: el for el in bootstrap["elements"]}
    teams_by_id = {t["id"]: t["short_name"] for t in bootstrap["teams"]}

    picks_result = load_latest_picks()
    if picks_result is None:
        print("No squad picks snapshot yet (no finished gameweek) — nothing to forecast", file=sys.stderr)
        return 0

    gw, picks = picks_result
    overrides = load_overrides(gw)
    if overrides:
        picks = apply_overrides(picks, overrides)
        print(f"overrides: applied {len(overrides)} manual transfer(s)")

    target_gw = gw + 1
    squad = project_squad(
        picks,
        target_gw,
        elements_by_id=elements_by_id,
        teams_by_id=teams_by_id,
        minutes_model=minutes_model,
        rolling_averages=rolling,
        fixtures=fixtures,
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
        "overridesApplied": len(overrides),
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
