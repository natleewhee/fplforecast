"""U9: freeze this gameweek's model and baseline projections before the
deadline, so they can be scored against reality afterwards (R14, KD3, KTD7).

Writes ``data/predictions/gwNN.json`` exactly once, only inside the
``PREDICTION_WINDOW_HOURS`` window before the upcoming deadline. A later run in
the same window -- or after the file exists -- is a no-op, so the frozen entry
always reflects near-final team news. A gameweek whose deadline has already
passed is never logged (it can no longer be predicted before the fact, AE4).
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from engine import baseline, model
from engine.config import PREDICTION_WINDOW_HOURS, ROLLING_WINDOW
from engine.features import build_feature_frame
from engine.history import ColdStart, classify, load_history
from engine.model import ModelContext
from engine.strength import team_strength_table
from scripts import compute_forecast as cf

DATA_DIR = Path(__file__).resolve().parent.parent / "data"


def upcoming_event(bootstrap: dict) -> dict | None:
    """The first gameweek that is not finished."""
    return next((e for e in bootstrap.get("events", []) if not e.get("finished")), None)


def hours_until(deadline_iso: str, now: datetime) -> float:
    deadline = datetime.fromisoformat(deadline_iso.replace("Z", "+00:00"))
    return (deadline - now).total_seconds() / 3600.0


def main(now: datetime | None = None) -> int:
    now = now or datetime.now(timezone.utc)

    bootstrap = cf.load_bootstrap()
    if bootstrap is None:
        print("No bootstrap-static snapshot yet — run scripts/snapshot.py first", file=sys.stderr)
        return 1

    event = upcoming_event(bootstrap)
    if event is None:
        print("No unfinished gameweek — season over, nothing to log")
        return 0

    gw = event["id"]
    remaining = hours_until(event["deadline_time"], now)
    if not (0 <= remaining <= PREDICTION_WINDOW_HOURS):
        print(f"GW{gw} deadline is {remaining:.0f}h away — outside the {PREDICTION_WINDOW_HOURS}h window")
        return 0

    out_path = DATA_DIR / "predictions" / f"gw{gw}.json"
    if out_path.exists():
        print(f"GW{gw} prediction already frozen — no-op")
        return 0

    resolved_map = cf.load_entity_resolution()
    archive = load_history(DATA_DIR)

    def is_cold_start(pid: int) -> bool:
        return isinstance(classify(pid, resolved_map, archive.frame), ColdStart)

    feature_frame = build_feature_frame(
        bootstrap["elements"], cf.load_event_live_history(), is_cold_start, ROLLING_WINDOW
    )
    ctx = ModelContext(
        fixtures=cf.load_fixtures(),
        minutes_model=cf.load_minutes_model(),
        elements_by_id={el["id"]: el for el in bootstrap["elements"]},
        teams_by_id={t["id"]: t["short_name"] for t in bootstrap["teams"]},
        team_strength=team_strength_table(cf.load_team_strength_seasons()),
    )

    model_map: dict[str, float | None] = {}
    baseline_map: dict[str, float | None] = {}
    for pid, row in feature_frame.iterrows():
        b = baseline.project(row)
        model_map[str(pid)] = model.project(row, gw, ctx)  # always a number now
        baseline_map[str(pid)] = None if isinstance(b, ColdStart) else float(b)

    payload = {
        "gameweek": gw,
        "generatedAt": now.isoformat(),
        "deadline": event["deadline_time"],
        "model": model_map,
        "baseline": baseline_map,
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, indent=2, sort_keys=True))
    print(f"GW{gw} predictions frozen ({len(model_map)} players) -> {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
