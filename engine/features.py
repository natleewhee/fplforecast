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

from engine.config import FEATURE_SHRINKAGE_GAMES

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


def build_feature_frame(
    players: list[dict],
    live_history: list[dict],
    is_cold_start,
    rolling_window: int,
) -> pd.DataFrame:
    """One feature row per player for the composite baseline and the model.

    ``players``      -- bootstrap ``elements`` dicts (id, element_type, team, now_cost).
    ``live_history`` -- current-season ``event-live`` payloads, oldest first;
                        only the last ``rolling_window`` are used (KTD4: current
                        season only for v1).
    ``is_cold_start``-- ``player_id -> bool`` (wired to ``engine.history.classify``).

    Columns (indexed by ``player_id``): element_type, team, price,
    ``hist_scoring_avg`` (mean total_points per appearance), ``ict_recent`` and
    ``form_recent`` (means over the recent window, DNP gameweeks included as 0),
    ``games_recent``, ``cold_start``. Each mean is empirical-Bayes shrunk toward
    its position's average with ``FEATURE_SHRINKAGE_GAMES`` pseudo-observations,
    so one big early-season gameweek does not dominate. A window shorter than
    ``rolling_window`` averages over what is available.
    """
    recent = live_history[-rolling_window:] if rolling_window else list(live_history)

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
            }
        )

    frame = pd.DataFrame.from_records(rows)
    if not frame.empty:
        frame = frame.set_index("player_id", drop=False)
    return frame


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

