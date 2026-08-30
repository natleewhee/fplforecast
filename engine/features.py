"""Shared feature building for the projections. Pure: takes already-loaded
dicts, returns plain data / a pandas frame.

- ``fdr_multiplier`` / ``availability_multiplier`` -- the interim per-leg
  scalers (FDR is crude; the real expected-goals λ model stays deferred).
- ``team_fixtures`` -- opponent id, home/away, and difficulty per leg for a
  target gameweek (blank -> []; double -> two entries).
- ``build_feature_frame`` (U5) -- one row per player: current-season scoring
  average, recent ICT and form, and a cold-start flag.
"""

from __future__ import annotations

import pandas as pd

from engine.config import FEATURE_SHRINKAGE_GAMES, RATE_BLEND, RATE_FORM_WINDOW, RATE_PRIOR_WEIGHT

UNAVAILABLE_STATUSES = {"i", "s", "u", "n"}  # injured, suspended, unavailable, not in squad

POSITIONS = {1: "GKP", 2: "DEF", 3: "MID", 4: "FWD"}


def fdr_multiplier(difficulty: int) -> float:
    """FDR runs 1 (easiest) to 5 (hardest). Linear, symmetric around 3 -> 1.0x.
    Deliberately simple — this is the placeholder the plan wants replaced
    with a real expected-goals λ model, not a tuned formula."""
    return 1.2 - 0.1 * (difficulty - 1)


def team_fixtures(team_id: int, target_gw: int, fixtures: list[dict]) -> list[dict]:
    """Every fixture ``team_id`` plays in ``target_gw`` -- empty for a blank
    gameweek, two entries for a double. Each carries the opponent team id,
    home/away, and that leg's FPL difficulty rating (1 easiest .. 5 hardest)."""
    out: list[dict] = []
    for fx in fixtures:
        if fx.get("event") != target_gw:
            continue
        if fx.get("team_h") == team_id:
            out.append(
                {"opponent": fx.get("team_a"), "was_home": True, "difficulty": fx.get("team_h_difficulty")}
            )
        elif fx.get("team_a") == team_id:
            out.append(
                {"opponent": fx.get("team_h"), "was_home": False, "difficulty": fx.get("team_a_difficulty")}
            )
    return out


def availability_multiplier(el: dict) -> float:
    if el.get("status") in UNAVAILABLE_STATUSES:
        return 0.0
    chance = el.get("chance_of_playing_next_round")
    if chance is None:
        return 1.0
    return chance / 100.0


def _to_number(value) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


# Per-90 rate -> its bootstrap season-to-date field / its per-GW event-live stat.
_SEASON_RATE_FIELDS = {
    "xg90": "expected_goals_per_90",
    "xa90": "expected_assists_per_90",
    "dc90": "defensive_contribution_per_90",
    "gc90": "goals_conceded_per_90",
    "saves90": "saves_per_90",
}
_SEASON_TOTAL_RATES = {"bonus90": "bonus", "yellow90": "yellow_cards"}
_LIVE_RATE_STATS = {
    "xg90": "expected_goals",
    "xa90": "expected_assists",
    "dc90": "defensive_contribution",
    "gc90": "goals_conceded",
    "saves90": "saves",
    "bonus90": "bonus",
    "yellow90": "yellow_cards",
}
_RATE_NAMES = tuple(_LIVE_RATE_STATS)
_ARCHIVE_RATE_NAMES = ("xg90", "xa90", "dc90")


def build_feature_frame(
    players: list[dict],
    live_history: list[dict],
    is_cold_start,
    rolling_window: int,
    *,
    archive_rates: dict[int, dict] | None = None,
) -> pd.DataFrame:
    """One feature row per player for the composite baseline and the component
    model.

    ``players``      -- bootstrap ``elements`` dicts (id, element_type, team,
                        now_cost, plus the per-90 rate fields the model reads).
    ``live_history`` -- current-season ``event-live`` payloads, oldest first.
    ``is_cold_start``-- ``player_id -> bool`` (wired to ``engine.history.classify``).
    ``archive_rates``-- optional ``{player_id: {xg90, xa90, dc90}}`` from prior
                        seasons, for the deepest slice of each rate blend.

    Columns (indexed by ``player_id``): element_type, team, price,
    ``hist_scoring_avg`` / ``ict_recent`` / ``form_recent`` (the baseline's
    inputs, unchanged), ``games_recent``, ``cold_start``, and the per-90 rates
    ``xg90 xa90 dc90 gc90 saves90 bonus90 yellow90`` -- each a weighted blend of
    prior seasons / this season / the recent window, shrunk toward its
    position's mean so a thin early-season sample doesn't dominate.
    """
    recent = live_history[-rolling_window:] if rolling_window else list(live_history)
    rate_recent = (
        live_history[-max(rolling_window, RATE_FORM_WINDOW):] if rolling_window else list(live_history)
    )
    rates_by_id = _rate_features(players, rate_recent, archive_rates or {})

    games_by_id: dict[int, list[tuple]] = {}
    for payload in recent:
        for el in payload.get("elements", []):
            stats = el.get("stats", {})
            games_by_id.setdefault(el["id"], []).append(
                (
                    _to_number(stats.get("total_points")),
                    _to_number(stats.get("minutes")),
                    _to_number(stats.get("ict_index")),
                )
            )

    raw: list[dict] = []
    for player in players:
        pid = player["id"]
        games = games_by_id.get(pid, [])
        appearances = [(tp, ict) for tp, mn, ict in games if (mn or 0) > 0 and tp is not None]
        form_pts = [tp for tp, _, _ in games if tp is not None]
        raw.append(
            {
                "player_id": pid,
                "element_type": player["element_type"],
                "team": player["team"],
                "price": player.get("now_cost", 0) / 10,
                "cold_start": bool(is_cold_start(pid)),
                "games_recent": len(games),
                "_app_n": len(appearances),
                "_app_pts": float(sum(tp for tp, _ in appearances)),
                "_app_ict": float(sum(ict for _, ict in appearances if ict is not None)),
                "_app_ict_n": sum(1 for _, ict in appearances if ict is not None),
                "_form_n": len(form_pts),
                "_form_sum": float(sum(form_pts)),
            }
        )

    score_prior, ict_prior = _position_priors(raw)
    k = FEATURE_SHRINKAGE_GAMES

    rows: list[dict] = []
    for r in raw:
        et = r["element_type"]
        score_target = score_prior.get(et, 0.0)  # unknown position (bad archive row) -> no prior
        ict_target = ict_prior.get(et, 0.0)
        rows.append(
            {
                "player_id": r["player_id"],
                "element_type": et,
                "team": r["team"],
                "price": r["price"],
                "cold_start": r["cold_start"],
                "games_recent": r["games_recent"],
                "hist_scoring_avg": (r["_app_pts"] + k * score_target) / (r["_app_n"] + k),
                "form_recent": (r["_form_sum"] + k * score_target) / (r["_form_n"] + k),
                "ict_recent": (r["_app_ict"] + k * ict_target) / (r["_app_ict_n"] + k),
                **rates_by_id.get(r["player_id"], {n: 0.0 for n in _RATE_NAMES}),
            }
        )

    frame = pd.DataFrame.from_records(rows)
    if not frame.empty:
        frame = frame.set_index("player_id", drop=False)
    return frame


def _rate_features(
    players: list[dict], recent_payloads: list[dict], archive_rates: dict[int, dict]
) -> dict[int, dict]:
    """Per player, each per-90 rate as a weighted blend of prior seasons / this
    season / the recent window, then shrunk toward its position's mean."""
    recent_sum: dict[int, dict] = {}
    recent_min: dict[int, float] = {}
    for payload in recent_payloads:
        for el in payload.get("elements", []):
            pid = el["id"]
            stats = el.get("stats", {})
            recent_min[pid] = recent_min.get(pid, 0.0) + (_to_number(stats.get("minutes")) or 0.0)
            bucket = recent_sum.setdefault(pid, dict.fromkeys(_RATE_NAMES, 0.0))
            for name, stat in _LIVE_RATE_STATS.items():
                bucket[name] += _to_number(stats.get(stat)) or 0.0

    # pass 1: blend per player without the position prior
    blended: dict[int, dict] = {}
    for player in players:
        pid = player["id"]
        sources: dict[str, list[tuple[float, float]]] = {n: [] for n in _RATE_NAMES}

        season_min = _to_number(player.get("minutes")) or 0.0
        if season_min > 0:
            per90 = season_min / 90.0
            for name, field in _SEASON_RATE_FIELDS.items():
                value = _to_number(player.get(field))
                if value is not None:
                    sources[name].append((RATE_BLEND["season"], value))
            for name, total_field in _SEASON_TOTAL_RATES.items():
                value = _to_number(player.get(total_field))
                if value is not None:
                    sources[name].append((RATE_BLEND["season"], value / per90))

        rmin = recent_min.get(pid, 0.0)
        if rmin > 0:
            rp90 = rmin / 90.0
            for name in _RATE_NAMES:
                sources[name].append((RATE_BLEND["recent"], recent_sum[pid][name] / rp90))

        arc = archive_rates.get(pid) or {}
        for name in _ARCHIVE_RATE_NAMES:
            value = arc.get(name)
            if value is not None:
                sources[name].append((RATE_BLEND["archive"], float(value)))

        blended[pid] = {}
        for name in _RATE_NAMES:
            srcs = sources[name]
            weight = sum(w for w, _ in srcs)
            blended[pid][name] = (
                (sum(w * v for w, v in srcs) / weight, weight) if weight else (None, 0.0)
            )

    # position means over players who have a blended value
    prior: dict[tuple[int, str], float] = {}
    for et in (1, 2, 3, 4):
        for name in _RATE_NAMES:
            vals = [
                blended[p["id"]][name][0]
                for p in players
                if p["element_type"] == et and blended[p["id"]][name][0] is not None
            ]
            prior[(et, name)] = sum(vals) / len(vals) if vals else 0.0

    # pass 2: shrink toward the prior
    out: dict[int, dict] = {}
    for player in players:
        pid = player["id"]
        et = player["element_type"]
        row = {}
        for name in _RATE_NAMES:
            value, weight = blended[pid][name]
            p = prior.get((et, name), 0.0)
            if value is None:
                row[name] = p
            else:
                row[name] = (weight * value + RATE_PRIOR_WEIGHT * p) / (weight + RATE_PRIOR_WEIGHT)
        out[pid] = row
    return out


def _position_priors(raw: list[dict]) -> tuple[dict[int, float], dict[int, float]]:
    """Per-position mean points-per-appearance and ICT-per-appearance, over
    players who have actually appeared. The shrinkage target: a thin sample is
    pulled toward a stable position baseline, not toward zero. Falls back to the
    overall mean for a position with no appearances yet."""
    score: dict[int, float] = {}
    ict: dict[int, float] = {}
    all_pts = sum(r["_app_pts"] for r in raw)
    all_n = sum(r["_app_n"] for r in raw)
    overall = all_pts / all_n if all_n else 0.0
    for et in (1, 2, 3, 4):
        pts_n = sum(r["_app_n"] for r in raw if r["element_type"] == et)
        ict_n = sum(r["_app_ict_n"] for r in raw if r["element_type"] == et)
        score[et] = (
            sum(r["_app_pts"] for r in raw if r["element_type"] == et) / pts_n if pts_n else overall
        )
        ict[et] = (
            sum(r["_app_ict"] for r in raw if r["element_type"] == et) / ict_n if ict_n else 0.0
        )
    return score, ict

