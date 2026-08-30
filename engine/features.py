"""Per-player point projection assembly, lifted verbatim from
``scripts/compute_forecast.py``'s ``main()`` loop (U1). Pure: takes
already-loaded dicts, returns plain dicts.

Projection per player, in order of preference:

  1. minutes model (``scripts/minutes_model.py``): expectedMinutes/90 x per90Points
  2. last-ROLLING_WINDOW-GW flat average total points (the original dumb slice,
     used as a fallback — e.g. for a player the minutes model hasn't seen yet)

Both are scaled by a hard availability multiplier (injury/suspension veto, or
the partial ``chance_of_playing_next_round``) applied *after* the projection,
per the plan's "availability is a veto, not a feature" principle.

Also scaled by FPL's own fixture difficulty rating (FDR) for the target
gameweek — an interim, explicitly crude opponent-strength signal per the plan
doc ("FDR is crude; replace with own λ"). A blank gameweek (no fixture) zeroes
the projection; a double gameweek sums both legs' multipliers, so it naturally
comes out around 2x a single game rather than needing special-casing.
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


def team_fixture_multiplier(team_id: int, target_gw: int, fixtures: list[dict]) -> float:
    total = 0.0
    for fx in fixtures:
        if fx.get("event") != target_gw:
            continue
        if fx.get("team_h") == team_id:
            total += fdr_multiplier(fx["team_h_difficulty"])
        elif fx.get("team_a") == team_id:
            total += fdr_multiplier(fx["team_a_difficulty"])
    return total  # 0.0 for a blank gameweek, ~2x for a double gameweek


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
        frame = frame.set_index("player_id")
    return frame


def project_squad(
    picks: list[dict],
    target_gw: int,
    *,
    elements_by_id: dict[int, dict],
    teams_by_id: dict[int, str],
    minutes_model: dict[str, dict],
    rolling_averages: dict[int, float],
    fixtures: list[dict],
) -> list[dict]:
    """One projection dict per pick whose ``element`` id is known, in the order
    the picks were given. A pick whose id is absent from ``elements_by_id`` is
    skipped, exactly as the pre-U1 script did."""
    squad: list[dict] = []
    for pick in picks:
        el = elements_by_id.get(pick["element"])
        if el is None:
            continue

        mm = minutes_model.get(str(el["id"]))
        if mm:
            base = (mm["expectedMinutes"] / 90) * mm["per90Points"]
            component = "minutes-model"
        else:
            base = rolling_averages.get(el["id"], 0.0)
            component = "rolling-average"

        fdr_mult = team_fixture_multiplier(el["team"], target_gw, fixtures)
        projected = base * availability_multiplier(el) * fdr_mult
        squad.append(
            {
                "id": el["id"],
                "webName": el["web_name"],
                "team": teams_by_id.get(el["team"], "???"),
                "position": POSITIONS[el["element_type"]],
                "element_type": el["element_type"],
                "projected": round(projected, 2),
                "component": component,
                "expectedMinutes": mm["expectedMinutes"] if mm else None,
                "fdrMultiplier": round(fdr_mult, 2),
            }
        )
    return squad
