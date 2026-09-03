"""UB1: retrospective par-vs-rank calibration check (Part B of the
2026-09-03 safety-score and calibration plan).

Fully retrospective (KDB1) -- no new persisted mid-gameweek state. Once a
gameweek is ``data_checked``, recompute what the live tracker's par verdict
(engine.config.PAR_BUFFER_POINTS / KTD2) would have been using only prior
gameweeks -- the same leave-one-out median ``compute_forecast.par_margin``
already computes, just excluding the gameweek being scored -- and check it
against what actually happened to the manager's overall rank that gameweek.
Idempotent: a gameweek already in ``gameweeksIncluded`` is never rescored,
matching ``score_predictions.py``'s guard.

This calibrates the par *threshold* (the margin formula), not the live
mid-gameweek projection math (KTD6) -- it scores against the gameweek's
final actual score, which is the only number available after the fact."""

from __future__ import annotations

import json
from pathlib import Path

from engine.config import PAR_BUFFER_POINTS, PAR_BUFFER_PROVISIONAL_POINTS, PAR_MARGIN_MIN_GAMEWEEKS
from scripts import compute_forecast as cf

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

VERDICTS = ("green", "amber", "red")


def load_calibration() -> dict:
    path = DATA_DIR / "record" / "par-calibration.json"
    data = json.loads(path.read_text()) if path.exists() else {}
    data.setdefault("entries", [])
    data.setdefault("gameweeksIncluded", [])
    return data


def _avg_by_event(events: list[dict]) -> dict[int, float]:
    return {
        e.get("id"): e.get("average_entry_score")
        for e in events
        if e.get("finished") and e.get("average_entry_score") is not None
    }


def verdict_for(score: float, par: float, buffer: float) -> str:
    """green/amber/red per R5: green when clear of par by more than the
    buffer, amber at or above par but within the buffer, red below par."""
    diff = score - par
    if diff > buffer:
        return "green"
    if diff >= 0:
        return "amber"
    return "red"


def score_gameweek(gw: int, current: list[dict], events: list[dict]) -> dict | None:
    """One gameweek's calibration row, or ``None`` if it can't be scored yet
    (no recorded points/rank for this gameweek or its predecessor, or no
    published gameweek average)."""
    avg_by_event = _avg_by_event(events)
    by_event = {e["event"]: e for e in current if e.get("event") is not None}
    this_gw = by_event.get(gw)
    prev_gw = by_event.get(gw - 1)
    if this_gw is None or prev_gw is None:
        return None
    if this_gw.get("points") is None or this_gw.get("overall_rank") is None:
        return None
    if prev_gw.get("overall_rank") is None:
        return None
    if gw not in avg_by_event:
        return None

    # Leave-one-out: the margin the live tracker would have baked *before*
    # this gameweek, from strictly earlier gameweeks only (KDB1) -- never the
    # gameweek being scored, or this would be lookahead.
    prior = [e for e in current if e.get("event") is not None and e["event"] < gw]
    margin, provisional = cf.par_margin(prior, events, min_gameweeks=PAR_MARGIN_MIN_GAMEWEEKS)
    par = avg_by_event[gw] + margin
    buffer = PAR_BUFFER_PROVISIONAL_POINTS if provisional else PAR_BUFFER_POINTS
    verdict = verdict_for(this_gw["points"], par, buffer)
    rank_movement = "held" if this_gw["overall_rank"] <= prev_gw["overall_rank"] else "dropped"
    # green/amber predicts "held", red predicts "dropped" -- a hit is the
    # verdict's predicted direction matching what actually happened.
    hit = (verdict in ("green", "amber")) == (rank_movement == "held")

    return {
        "gameweek": gw,
        "verdict": verdict,
        "rankMovement": rank_movement,
        "hit": hit,
        "marginProvisional": provisional,
    }


def summarise(entries: list[dict]) -> dict:
    """Pooled hit rate and a hit rate per verdict colour (RB3) -- a check
    that only reports one pooled number can't tell "green is always right,
    red is a coin flip" from genuinely balanced accuracy."""

    def _rate(rows: list[dict]) -> float | None:
        return round(sum(1 for r in rows if r["hit"]) / len(rows), 3) if rows else None

    by_verdict = {v: [e for e in entries if e["verdict"] == v] for v in VERDICTS}
    return {
        "gameweeksScored": len(entries),
        "hitRate": _rate(entries),
        "hitRateByVerdict": {v: _rate(rows) for v, rows in by_verdict.items()},
    }


def main() -> int:
    bootstrap = cf.load_bootstrap()
    if bootstrap is None:
        print("No bootstrap-static snapshot yet — run scripts/snapshot.py first")
        return 1

    history = cf.load_entry_history()
    current = history.get("current") or []
    events = bootstrap.get("events") or []

    calibration = load_calibration()
    already = set(calibration["gameweeksIncluded"])

    # GW1 has no predecessor to measure rank movement against, so scoring
    # starts at GW2.
    finished_gws = sorted(e["id"] for e in events if e.get("data_checked") and e["id"] >= 2)
    for gw in finished_gws:
        if gw in already:
            continue
        row = score_gameweek(gw, current, events)
        if row is None:
            continue
        calibration["entries"].append(row)
        calibration["gameweeksIncluded"].append(gw)
        already.add(gw)
        print(f"GW{gw}: par verdict {row['verdict']}, rank {row['rankMovement']}, hit={row['hit']}")

    calibration["entries"].sort(key=lambda e: e["gameweek"])
    calibration["gameweeksIncluded"].sort()
    calibration["summary"] = summarise(calibration["entries"])

    out_path = DATA_DIR / "record" / "par-calibration.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(calibration, indent=2, sort_keys=True))
    print(f"par calibration -> {out_path}: {calibration['summary']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
