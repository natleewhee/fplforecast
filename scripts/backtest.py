"""U11 CLI: run the leakage-guarded backtest over the archived seasons and
write ``data/backtest/<run-id>.json``. Always exits 0 -- a model that loses to
the baseline is a result to report, not a failure (KD4, AE3).

    python -m scripts.backtest [--seasons 2023-24,2024-25] [--out run.json]
    python -m scripts.backtest --compare old.json new.json

``--compare`` pairs two runs gameweek by gameweek (new - old model XI points)
and reports the mean difference and its standard error for the tune seasons,
the holdout season, and the holdout's two halves -- the acceptance rule in
docs/plans/2026-09-30-model-changes-plan.md.
"""

from __future__ import annotations

import argparse
import json
import statistics as st
import sys
from datetime import datetime, timezone
from pathlib import Path

from engine.backtest import replay
from engine.config import ARCHIVE_SEASONS, MEANINGFUL_EDGE_PER_GW, PRIOR_ONLY_SEASONS
from engine.history import load_history

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

TUNE_SEASONS = ("2023-24", "2024-25")
HOLDOUT_SEASON = "2025-26"
# Defensive contribution only scores from 2025-26, so DC changes tune on its
# first half and confirm on its second.
HOLDOUT_SPLIT_GW = 19


def _season_payload(season: str, name: str) -> dict:
    path = DATA_DIR / "history" / season / name
    return json.loads(path.read_text()) if path.exists() else {}


def load_seasons() -> dict[str, dict]:
    """Every archived season's fixtures and teams, including backtest-only
    ones, for ``replay``'s ``other_seasons`` (it only ever uses seasons before
    the one replayed)."""
    return {
        season: {
            "fixtures": _season_payload(season, "fixtures.json").get("fixtures", []),
            "teams": _season_payload(season, "teams.json").get("teams", []),
        }
        for season in [*ARCHIVE_SEASONS, *PRIOR_ONLY_SEASONS]
    }


def paired(old: list[dict], new: list[dict], key: str = "model") -> dict:
    """Mean and standard error of ``new - old`` for ``key`` (model XI points,
    or ``mse``: mean squared projection error per player) over the gameweeks
    both runs scored."""
    old_by_gw = {g["gw"]: g.get(key) for g in old}
    diffs = [
        g[key] - old_by_gw[g["gw"]]
        for g in new
        if g.get(key) is not None and old_by_gw.get(g["gw"]) is not None
    ]
    if not diffs:
        return {"n": 0}
    se = st.stdev(diffs) / len(diffs) ** 0.5 if len(diffs) > 1 else 0.0
    mean = st.mean(diffs)
    return {"n": len(diffs), "mean": round(mean, 3), "se": round(se, 3), "lower2se": round(mean - 2 * se, 3)}


def compare(old_report: dict, new_report: dict) -> dict:
    def per_gw(report: dict, season: str) -> list[dict]:
        return (report["seasons"].get(season) or {}).get("perGw", [])

    tune_old = [g for s in TUNE_SEASONS for g in ({**x, "gw": (s, x["gw"])} for x in per_gw(old_report, s))]
    tune_new = [g for s in TUNE_SEASONS for g in ({**x, "gw": (s, x["gw"])} for x in per_gw(new_report, s))]
    hold_old, hold_new = per_gw(old_report, HOLDOUT_SEASON), per_gw(new_report, HOLDOUT_SEASON)
    first = lambda rows: [g for g in rows if g["gw"] <= HOLDOUT_SPLIT_GW]  # noqa: E731
    second = lambda rows: [g for g in rows if g["gw"] > HOLDOUT_SPLIT_GW]  # noqa: E731
    groups = {
        season: (per_gw(old_report, season), per_gw(new_report, season))
        for season in sorted(set(old_report["seasons"]) & set(new_report["seasons"]))
    }
    groups["tune"] = (tune_old, tune_new)
    groups["holdout"] = (hold_old, hold_new)
    groups[f"holdout GW1-{HOLDOUT_SPLIT_GW}"] = (first(hold_old), first(hold_new))
    groups[f"holdout GW{HOLDOUT_SPLIT_GW + 1}+"] = (second(hold_old), second(hold_new))
    return {
        label: {"xiPoints": paired(o, n), "mse": paired(o, n, "mse")}
        for label, (o, n) in groups.items()
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Leakage-guarded backtest.")
    parser.add_argument("--seasons", help="comma-separated seasons to replay (default: all)")
    parser.add_argument("--out", type=Path, help="write the report here instead of data/backtest/")
    parser.add_argument("--compare", nargs=2, type=Path, metavar=("OLD", "NEW"),
                        help="pair two saved reports gameweek by gameweek")
    args = parser.parse_args(argv)

    if args.compare:
        old, new = (json.loads(p.read_text()) for p in args.compare)
        print("  (xiPoints: higher is better; mse: lower is better)")
        for label, metrics in compare(old, new).items():
            for name, r in metrics.items():
                if r["n"]:
                    print(f"  {label:18s} {name:8s} n={r['n']:3d}  mean {r['mean']:+.4f}  se {r['se']:.4f}")
        return 0

    archive = load_history(DATA_DIR, include_prior_only=True)
    if archive.frame.empty:
        print("No data/history/ archive — run scripts/ingest_history.py first", file=sys.stderr)
        return 0

    run_id = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H%M%SZ")
    seasons: dict[str, dict] = {}
    model_total = baseline_total = 0.0
    gameweeks = 0

    replayed = args.seasons.split(",") if args.seasons else ARCHIVE_SEASONS
    all_seasons = load_seasons()
    for season in replayed:
        result = replay(
            season,
            archive.frame,
            all_seasons[season]["fixtures"],
            all_seasons[season]["teams"],
            other_seasons=all_seasons,
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

    if args.out:
        out_path = args.out
    else:
        out_dir = DATA_DIR / "backtest"
        out_dir.mkdir(parents=True, exist_ok=True)
        out_path = out_dir / f"{run_id}.json"
    out_path.write_text(json.dumps(report, indent=2, sort_keys=True))
    print(
        f"backtest {run_id}: pooled deltaPerGw {pooled['deltaPerGw']} "
        f"meaningful={pooled['meaningful']} -> {out_path}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
