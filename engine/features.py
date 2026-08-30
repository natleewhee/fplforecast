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
    ``games_recent``, ``cold_start``. A window shorter than ``rolling_window``
    averages over what is available rather than dividing by the full window.
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

    rows: list[dict] = []
    for player in players:
        pid = player["id"]
        games = games_by_id.get(pid, [])
        appearances = [tp for tp, mn, _ in games if (mn or 0) > 0 and tp is not None]
        points = [tp for tp, _, _ in games if tp is not None]
        icts = [ict for _, _, ict in games if ict is not None]
        rows.append(
            {
                "player_id": pid,
                "element_type": player["element_type"],
                "team": player["team"],
                "price": player.get("now_cost", 0) / 10,
                "hist_scoring_avg": sum(appearances) / len(appearances) if appearances else 0.0,
                "ict_recent": sum(icts) / len(icts) if icts else 0.0,
                "form_recent": sum(points) / len(points) if points else 0.0,
                "games_recent": len(games),
                "cold_start": bool(is_cold_start(pid)),
            }
        )

    frame = pd.DataFrame.from_records(rows)
    if not frame.empty:
        frame = frame.set_index("player_id", drop=False)
    return frame

