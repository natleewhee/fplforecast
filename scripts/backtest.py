"""U11 CLI: run the leakage-guarded backtest over the archived seasons and
write ``data/backtest/<run-id>.json``. Always exits 0 -- a model that loses to
the baseline is a result to report, not a failure (KD4, AE3).
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from engine.backtest import replay
from engine.config import ARCHIVE_SEASONS, MEANINGFUL_EDGE_PER_GW
from engine.history import load_history

DATA_DIR = Path(__file__).resolve().parent.parent / "data"


def _season_payload(season: str, name: str) -> dict:
    path = DATA_DIR / "history" / season / name
    return json.loads(path.read_text()) if path.exists() else {}


def main() -> int:
    archive = load_history(DATA_DIR)
    if archive.frame.empty:
        print("No data/history/ archive — run scripts/ingest_history.py first", file=sys.stderr)
        return 0

    run_id = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H%M%SZ")
    seasons: dict[str, dict] = {}
    model_total = baseline_total = 0.0
    gameweeks = 0

    for season in ARCHIVE_SEASONS:
        result = replay(
            season,
            archive.frame,
            _season_payload(season, "fixtures.json").get("fixtures", []),
            _season_payload(season, "teams.json").get("teams", []),
        )
        seasons[season] = result
        model_total += result["modelPoints"]
        baseline_total += result["baselinePoints"]
        gameweeks += result["gameweeks"]
        print(
            f"  {season}: model {result['modelPoints']}  baseline {result['baselinePoints']}  "
            f"delta {result['delta']}  ({result['gameweeks']} GW)"
        )

    delta_per_gw = (model_total - baseline_total) / gameweeks if gameweeks else 0.0
    pooled = {
        "modelPoints": round(model_total, 1),
        "baselinePoints": round(baseline_total, 1),
        "deltaPerGw": round(delta_per_gw, 3),
        "meaningful": delta_per_gw >= MEANINGFUL_EDGE_PER_GW,
    }
    report = {
        "runId": run_id,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "seasons": seasons,
        "pooled": pooled,
    }

    out_dir = DATA_DIR / "backtest"
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / f"{run_id}.json").write_text(json.dumps(report, indent=2, sort_keys=True))
    print(
        f"backtest {run_id}: pooled deltaPerGw {pooled['deltaPerGw']} "
        f"meaningful={pooled['meaningful']} -> data/backtest/{run_id}.json"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
