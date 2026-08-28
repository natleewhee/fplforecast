"""Phase 1, component 1: minutes. Highest leverage — most forecast error is
"he didn't play", per the plan doc.

v1 shrinks towards a within-season, cross-player prior (the position's
average minutes/per-90 rate so far) — always available, but weak early in
a season and identical for every player at a position.

Now that scripts/resolve_entities.py exists, a player resolved to a past
season gets a *personal* prior instead: their own minutes-per-start and
per-90 rate from data/entity-resolution's most recent run, pulled from
vaastav's players_raw.csv for that season. This only covers FPL-to-FPL
history (see resolve_entities.py's docstring on why Understat/FBref
aren't in scope) and only helps players who were in the league last
season — a new signing or promoted-team player still falls back to the
position prior, same as before.

Outputs, per player:
  p_start, p_cameo, p_unused  — categorical from recent minutes buckets
  expected_minutes            — shrunk mean minutes per GW
  per_90_points                — shrunk points-per-90-played rate

Downstream (compute_forecast.py) multiplies expected_minutes/90 x per_90_points
instead of using a flat last-5-GW total-points average — this is the actual
"replace one component" step from the plan's Phase 1.
"""

from __future__ import annotations

import csv
import json
import urllib.error
import urllib.request
from io import StringIO
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
ROLLING_WINDOW = 5  # matches compute_forecast's dumb-slice window for now

# Pseudo-observations for empirical Bayes shrinkage. Small on purpose — this
# is meant to be conservative, not to manufacture confidence from nothing.
START_SHRINKAGE_GAMES = 3
MINUTES_SHRINKAGE_GAMES = 3
PER90_SHRINKAGE_MINUTES = 180  # ~2 full games' worth

# Most recent completed season only — see resolve_entities.py for why this
# isn't derived automatically. A prior two seasons back is weaker signal
# than this season's own within-season data by the time it'd matter.
PRIOR_SEASON = "2025-26"
VAASTAV_BASE = "https://raw.githubusercontent.com/vaastav/Fantasy-Premier-League/master/data"


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


def load_entity_resolution() -> dict[str, dict]:
    d = DATA_DIR / "entity-resolution"
    if not d.exists():
        return {}
    files = sorted(d.glob("*.json"))
    if not files:
        return {}
    return load_json(files[-1]).get("resolved", {})


def fetch_prior_season_stats() -> dict[int, dict]:
    """historical id (in PRIOR_SEASON) -> {minutes, points, starts} for that season."""
    url = f"{VAASTAV_BASE}/{PRIOR_SEASON}/players_raw.csv"
    req = urllib.request.Request(url, headers={"User-Agent": "fplforecast-minutes-model/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            text = resp.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        print(f"prior-season stats: fetch failed ({exc}) — falling back to position prior only")
        return {}

    stats: dict[int, dict] = {}
    for row in csv.DictReader(StringIO(text)):
        try:
            stats[int(row["id"])] = {
                "minutes": int(row["minutes"]),
                "points": int(row["total_points"]),
                "starts": int(row.get("starts", 0)),
            }
        except (KeyError, ValueError):
            continue
    return stats


def personal_prior(
    current_id: int, resolved: dict[str, dict], prior_season_stats: dict[int, dict]
) -> tuple[float | None, float | None]:
    """(prior_minutes_per_appearance, prior_per90_points) from PRIOR_SEASON, or
    (None, None) if this player wasn't resolved to it or never played."""
    entry = resolved.get(str(current_id))
    if not entry:
        return None, None
    hist_id = entry.get("bySeason", {}).get(PRIOR_SEASON)
    if hist_id is None:
        return None, None
    stats = prior_season_stats.get(hist_id)
    if not stats or stats["minutes"] == 0:
        return None, None

    appearances = stats["starts"] if stats["starts"] > 0 else 1
    prior_minutes = stats["minutes"] / appearances
    prior_per90 = stats["points"] / stats["minutes"] * 90
    return prior_minutes, prior_per90


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

    resolved = load_entity_resolution()
    prior_season_stats = fetch_prior_season_stats() if resolved else {}
    personal_prior_hits = 0

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

        personal_minutes, personal_per90 = personal_prior(pid, resolved, prior_season_stats)
        prior_source = "position"
        if personal_minutes is not None:
            prior_minutes, prior_per90 = personal_minutes, personal_per90
            prior_source = f"{PRIOR_SEASON}-personal"
            personal_prior_hits += 1
        else:
            prior_minutes = position_prior_minutes(etype)
            prior_per90 = position_prior_per90(etype)

        shrunk_minutes = (
            sum(minutes_list) + MINUTES_SHRINKAGE_GAMES * prior_minutes
        ) / (n + MINUTES_SHRINKAGE_GAMES)

        total_minutes = sum(minutes_list)
        total_points = sum(p for _, p in games)
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
            "priorSource": prior_source,
        }

    out = {
        "bootstrapDate": bootstrap_date,
        "gameweeksUsed": len(history),
        "rollingWindow": ROLLING_WINDOW,
        "priorSeason": PRIOR_SEASON,
        "personalPriorHits": personal_prior_hits,
        "predictions": predictions,
    }

    out_dir = DATA_DIR / "minutes-model"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{bootstrap_date}.json"
    out_path.write_text(json.dumps(out, indent=2, sort_keys=True))
    print(
        f"minutes model: {len(predictions)} players, {len(history)} GWs, "
        f"{personal_prior_hits} using {PRIOR_SEASON} personal prior -> {out_path}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
