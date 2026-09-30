"""Per-player residual analysis over the backtest replay.

``scripts/backtest.py`` scores whole squads (model XI vs baseline XI). This
scores every player-gameweek instead -- ``actual - projected`` with the full
component breakdown -- to show where the model's error lives: by position,
season, component, and fixture attacking outlook. Uses
``engine.backtest.replay_gameweeks`` so it measures exactly what the backtest
replays. Run before and after a model change and compare.

    python -m scripts.residual_analysis [--seasons a,b] [--out path.json]
"""

from __future__ import annotations

import argparse
import json
import statistics as st
import sys
from collections import defaultdict
from pathlib import Path

from engine import model
from engine.backtest import replay_gameweeks
from engine.config import ARCHIVE_SEASONS
from engine.history import ColdStart, load_history
from scripts.backtest import DATA_DIR, load_seasons

POSITIONS = {1: "GKP", 2: "DEF", 3: "MID", 4: "FWD"}


def player_records(
    season: str, frame, fixtures: list[dict], teams: list[dict], other_seasons: dict | None = None
) -> list[dict]:
    records = []
    for rg in replay_gameweeks(season, frame, fixtures, teams, other_seasons=other_seasons):
        actual_pts = dict(zip(rg.rows["historical_id"], rg.rows["total_points"]))
        actual_min = dict(zip(rg.rows["historical_id"], rg.rows["minutes"]))
        for pid, row in rg.frame.iterrows():
            actual = actual_pts.get(pid)
            if actual is None:
                continue
            detail = model.project_detail(row, rg.gw, rg.ctx)
            if isinstance(detail, ColdStart):
                continue
            opponents = detail["opponents"]
            records.append(
                {
                    "season": season,
                    "gw": rg.gw,
                    "position": POSITIONS.get(int(row["element_type"]), "?"),
                    "projected": detail["points"],
                    "actual": float(actual),
                    "residual": float(actual) - detail["points"],
                    "played": (actual_min.get(pid) or 0) > 0,
                    "lambdaFor": (
                        sum(o["lambdaFor"] for o in opponents) / len(opponents) if opponents else None
                    ),
                    "components": detail["components"],
                }
            )
    return records


def _stats(values: list[float]) -> dict:
    if not values:
        return {"n": 0}
    return {
        "n": len(values),
        "bias": round(st.mean(values), 3),
        "median": round(st.median(values), 3),
        "mae": round(st.mean(abs(v) for v in values), 3),
    }


def summarise(records: list[dict]) -> dict:
    by_pos: dict[str, list[dict]] = defaultdict(list)
    by_season: dict[str, list[dict]] = defaultdict(list)
    for r in records:
        by_pos[r["position"]].append(r)
        by_season[r["season"]].append(r)

    components_when_played = {}
    for pos, rs in by_pos.items():
        played = [r for r in rs if r["played"]]
        if not played:
            continue
        names = played[0]["components"].keys()
        components_when_played[pos] = {
            "n": len(played),
            "avgActual": round(st.mean(r["actual"] for r in played), 3),
            "avgProjected": round(st.mean(r["projected"] for r in played), 3),
            **{n: round(st.mean(r["components"][n] for r in played), 3) for n in names},
        }

    # attackers split by how many goals their team was projected to score:
    # a well-calibrated opponent-strength signal leaves no trend across terciles.
    attackers = sorted(
        (r for r in records if r["position"] in ("MID", "FWD") and r["played"] and r["lambdaFor"] is not None),
        key=lambda r: r["lambdaFor"],
    )
    third = len(attackers) // 3
    terciles = {
        "low": attackers[:third],
        "mid": attackers[third : 2 * third],
        "high": attackers[2 * third :],
    }

    return {
        "overall": _stats([r["residual"] for r in records]),
        "byPosition": {p: _stats([r["residual"] for r in rs]) for p, rs in sorted(by_pos.items())},
        "bySeason": {s: _stats([r["residual"] for r in rs]) for s, rs in sorted(by_season.items())},
        "componentsWhenPlayed": components_when_played,
        "attackersByLambdaFor": {
            k: {**_stats([r["residual"] for r in rs]), "avgLambdaFor": round(st.mean(r["lambdaFor"] for r in rs), 3)}
            for k, rs in terciles.items()
            if rs
        },
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=Path, help="write the summary JSON here")
    parser.add_argument("--seasons", help="comma-separated seasons to replay (default: all)")
    args = parser.parse_args(argv)

    archive = load_history(DATA_DIR, include_prior_only=True)
    if archive.frame.empty:
        print("No data/history/ archive — run scripts/ingest_history.py first", file=sys.stderr)
        return 0

    all_seasons = load_seasons()
    records: list[dict] = []
    for season in args.seasons.split(",") if args.seasons else ARCHIVE_SEASONS:
        records += player_records(
            season,
            archive.frame,
            all_seasons[season]["fixtures"],
            all_seasons[season]["teams"],
            all_seasons,
        )

    summary = summarise(records)
    text = json.dumps(summary, indent=2, sort_keys=True)
    print(text)
    if args.out:
        args.out.write_text(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
