"""Phase 1, component 1: minutes. Highest leverage — most forecast error is
"he didn't play", per the plan doc.

v1 scope, deliberately narrow: uses only FPL's own per-GW data (data/event-live),
which needs no cross-source join. Shrinking towards a *previous-season* prior
needs entity resolution against vaastav/Understat/FBref (no shared key across
sources) — that's flagged in the plan as 2-3 weekends of its own and is NOT
done here. Until enough of the current season has accumulated, predictions
shrink towards a *within-season, cross-player* prior instead: the position's
average start rate and per-90 scoring rate so far. That's weaker than a real
prior-season prior, but doesn't require the join.

Outputs, per player:
  p_start, p_cameo, p_unused  — categorical from recent minutes buckets
  expected_minutes            — shrunk mean minutes per GW
  per_90_points                — shrunk points-per-90-played rate

Downstream (compute_forecast.py) multiplies expected_minutes/90 x per_90_points
instead of using a flat last-5-GW total-points average — this is the actual
"replace one component" step from the plan's Phase 1.
"""

from __future__ import annotations

import json
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
ROLLING_WINDOW = 5  # matches compute_forecast's dumb-slice window for now

# Pseudo-observations for empirical Bayes shrinkage. Small on purpose — this
# is meant to be conservative, not to manufacture confidence from nothing.
START_SHRINKAGE_GAMES = 3
MINUTES_SHRINKAGE_GAMES = 3
PER90_SHRINKAGE_MINUTES = 180  # ~2 full games' worth


def load_json(path: Path) -> dict:
    return json.loads(path.read_text())


def latest_bootstrap() -> tuple[str, dict] | None:
    d = DATA_DIR / "bootstrap-static"
    if not d.exists():
        return None
    files = sorted(d.glob("*.json"))
    if not files:
        return None
    return files[-1].stem, load_json(files[-1])


def load_event_live_history() -> list[dict]:
    d = DATA_DIR / "event-live"
    if not d.exists():
        return []
    files = sorted(d.glob("gw*.json"), key=lambda p: int(p.stem.removeprefix("gw")))
    return [load_json(f) for f in files[-ROLLING_WINDOW:]]


def bucket(minutes: int) -> str:
    if minutes >= 60:
        return "start"
    if minutes >= 1:
        return "cameo"
    return "unused"


def main() -> int:
    bootstrap_result = latest_bootstrap()
    if bootstrap_result is None:
        print("No bootstrap-static snapshot yet — run scripts/snapshot.py first")
        return 1
    bootstrap_date, bootstrap = bootstrap_result

    history = load_event_live_history()
    if not history:
        print("No finished-gameweek data yet (data/event-live is empty) — nothing to fit")
        return 0

    element_type_by_id = {el["id"]: el["element_type"] for el in bootstrap["elements"]}

    # Per-player list of (minutes, points) across the recent finished GWs.
    per_player: dict[int, list[tuple[int, int]]] = {}
    for gw_data in history:
        for el in gw_data.get("elements", []):
            stats = el.get("stats", {})
            per_player.setdefault(el["id"], []).append(
                (stats.get("minutes", 0), stats.get("total_points", 0))
            )

    # Position-level priors: average start rate and per-90 rate across all
    # players observed so far, grouped by element_type. This is the
    # within-season substitute for a real prior-season prior.
    position_minutes: dict[int, list[int]] = {}
    position_points_per_min: dict[int, list[tuple[int, int]]] = {}
    for pid, games in per_player.items():
        etype = element_type_by_id.get(pid)
        if etype is None:
            continue
        for minutes, points in games:
            position_minutes.setdefault(etype, []).append(minutes)
            position_points_per_min.setdefault(etype, []).append((minutes, points))

    def position_prior_minutes(etype: int) -> float:
        vals = position_minutes.get(etype, [0])
        return sum(vals) / len(vals)

    def position_prior_per90(etype: int) -> float:
        pairs = position_points_per_min.get(etype, [])
        total_minutes = sum(m for m, _ in pairs)
        total_points = sum(p for _, p in pairs)
        if total_minutes == 0:
            return 0.0
        return total_points / total_minutes * 90

    predictions: dict[str, dict] = {}
    for pid, games in per_player.items():
        etype = element_type_by_id.get(pid)
        if etype is None:
            continue
        n = len(games)
        minutes_list = [m for m, _ in games]
        buckets = [bucket(m) for m in minutes_list]

        p_start = buckets.count("start") / n
        p_cameo = buckets.count("cameo") / n
        p_unused = buckets.count("unused") / n

        prior_minutes = position_prior_minutes(etype)
        shrunk_minutes = (
            sum(minutes_list) + MINUTES_SHRINKAGE_GAMES * prior_minutes
        ) / (n + MINUTES_SHRINKAGE_GAMES)

        total_minutes = sum(minutes_list)
        total_points = sum(p for _, p in games)
        prior_per90 = position_prior_per90(etype)
        shrunk_per90 = (
            total_points * 90 + PER90_SHRINKAGE_MINUTES * prior_per90
        ) / (total_minutes + PER90_SHRINKAGE_MINUTES)

        predictions[str(pid)] = {
            "gamesObserved": n,
            "pStart": round(p_start, 3),
            "pCameo": round(p_cameo, 3),
            "pUnused": round(p_unused, 3),
            "expectedMinutes": round(shrunk_minutes, 1),
            "per90Points": round(shrunk_per90, 2),
        }

    out = {
        "bootstrapDate": bootstrap_date,
        "gameweeksUsed": len(history),
        "rollingWindow": ROLLING_WINDOW,
        "shrinkage": "within-season, cross-player position prior — no prior-season "
        "join yet, see module docstring",
        "predictions": predictions,
    }

    out_dir = DATA_DIR / "minutes-model"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{bootstrap_date}.json"
    out_path.write_text(json.dumps(out, indent=2, sort_keys=True))
    print(f"minutes model: {len(predictions)} players, {len(history)} GWs -> {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
