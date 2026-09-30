"""U11: replay archived seasons gameweek by gameweek under a single
kickoff-time leakage guard, and report model vs baseline squad points
(R16, R17, KD9, KTD3, KTD4, KTD6, KTD12).

Pure. ``scripts/backtest.py`` loads the archive (via ``engine.history``) and
the per-season fixtures / teams, then calls ``replay`` per season.

The only guard against look-ahead is ``_frame_before``: for target gameweek
N it keeps archive rows whose match ``kickoff_time`` is strictly before N's
first kickoff (KTD6) -- never a gameweek-index filter, so a postponed match
carrying a low label but a late kickoff is still excluded. No projection
function is told which gameweek it is replaying or that it is a backtest.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass

import pandas as pd

from engine import baseline, model
from engine.config import ROLLING_WINDOW
from engine.features import build_feature_frame
from engine.history import ColdStart, archive_rates_for, links_by_name, season_rates
from engine.model import ModelContext
from engine.squad import best_xi
from engine.team_goals import team_goal_rate_table

DEFAULT_QUOTAS = {1: 2, 2: 5, 3: 5, 4: 3}  # GKP, DEF, MID, FWD
SQUAD_SIZE = sum(DEFAULT_QUOTAS.values())


def select_squad(
    projections: list[dict],
    quotas: dict[int, int] | None = None,
    max_per_club: int = 3,
) -> list[dict]:
    """The fifteen highest-projected players under the position quotas and a
    per-club cap -- no budget constraint (KTD12). ``projections`` items need
    ``id``, ``element_type``, ``team``, ``points``."""
    quotas = quotas or DEFAULT_QUOTAS
    target = sum(quotas.values())
    picked: list[dict] = []
    pos_count = {et: 0 for et in quotas}
    club_count: dict = {}

    for p in sorted(projections, key=lambda x: x["points"], reverse=True):
        et = p["element_type"]
        club = p.get("team")
        if et not in quotas or pos_count[et] >= quotas[et]:
            continue
        if club is not None and club_count.get(club, 0) >= max_per_club:
            continue
        picked.append(p)
        pos_count[et] += 1
        club_count[club] = club_count.get(club, 0) + 1
        if len(picked) == target:
            break
    return picked


def _adapt_history(rows: pd.DataFrame, name_to_id: dict) -> tuple[list[dict], list[dict]]:
    """Archive rows -> the ``(players, live_history)`` inputs
    ``build_feature_frame`` expects. ``live_history`` is one payload per
    gameweek, oldest first, in the ``event-live`` shape. Each player's ``team``
    is the season team id, so ``engine.model``'s fixture lookup matches."""
    players = []
    for hid, g in rows.groupby("historical_id"):
        et = _first_int(g["element_type"])
        if et not in (1, 2, 3, 4):
            continue  # archive row with no usable position -- can't be squad-selected
        players.append(
            {
                "id": int(hid),
                "element_type": et,
                "team": name_to_id.get(g["team"].iloc[0]),
                "now_cost": 0,
            }
        )
    payloads: list[dict] = []
    for _gw, gw_rows in rows.sort_values("gw").groupby("gw", sort=True):
        payloads.append(
            {
                "elements": [
                    {
                        "id": int(row["historical_id"]),
                        "stats": {
                            "total_points": row.get("total_points"),
                            "minutes": row.get("minutes"),
                            "ict_index": row.get("ict_index"),
                            "expected_goals": row.get("expected_goals"),
                            "expected_assists": row.get("expected_assists"),
                            "defensive_contribution": row.get("defensive_contribution"),
                            "saves": row.get("saves"),
                            "bonus": row.get("bonus"),
                            "yellow_cards": row.get("yellow_cards"),
                            "goals_conceded": row.get("goals_conceded"),
                        },
                    }
                    for _, row in gw_rows.iterrows()
                ]
            }
        )
    return players, payloads


def _history_minutes_model(before: pd.DataFrame, window: int = 6) -> dict:
    """A minutes model for a replayed gameweek, built only from rows before its
    deadline: recent mean minutes and the share of recent games started 60+ /
    played as a cameo. Leak-safe -- it is the same shape ``engine.model``
    consumes live, just derived from history instead of team news."""
    mm: dict[str, dict] = {}
    for hist_id, sub in before.groupby("historical_id"):
        mins = sub.sort_values("gw")["minutes"].tail(window).fillna(0.0).tolist()
        if not mins:
            continue
        n = len(mins)
        mm[str(int(hist_id))] = {
            "expectedMinutes": sum(mins) / n,
            "pStart": sum(1 for m in mins if m >= 60) / n,
            "pCameo": sum(1 for m in mins if 0 < m < 60) / n,
        }
    return mm


def _first_int(series: pd.Series) -> int | None:
    for value in series:
        if value is not None and not pd.isna(value):
            return int(value)
    return None


def _frame_before(season_rows: pd.DataFrame, deadline: str) -> pd.DataFrame:
    """Rows whose kickoff is strictly before the target gameweek's first
    kickoff -- the one and only leakage guard (KTD6). ISO-8601 strings sort
    chronologically, so a plain comparison is correct."""
    return season_rows[season_rows["kickoff_time"] < deadline]


@dataclass(frozen=True)
class ReplayedGameweek:
    """One replayed gameweek: the leak-safe feature frame and model context the
    projections are built from, plus that gameweek's actual archive rows."""

    gw: int
    frame: pd.DataFrame
    ctx: ModelContext
    rows: pd.DataFrame
    id_to_short: dict


def fixtures_before(fixtures: list[dict], deadline: str) -> list[dict]:
    """Fixtures kicking off strictly before ``deadline`` -- the same leakage
    rule as ``_frame_before``, for the team-strength table's match results."""
    return [f for f in fixtures if f.get("kickoff_time") and f["kickoff_time"] < deadline]


def _strength_at(
    season: str,
    deadline: str,
    fixtures: list[dict],
    teams: list[dict],
    other_seasons: dict[str, dict],
) -> dict | None:
    """The live team-strength table (real goals for/against) as it stood at
    ``deadline``: every earlier season's fixtures in full, plus this season's
    fixtures that kicked off before the deadline. Later seasons never count,
    whatever order they're passed in."""
    if not teams:
        return None
    fixtures_by_season = {s: d.get("fixtures", []) for s, d in other_seasons.items() if s < season}
    teams_by_season = {s: d.get("teams", []) for s, d in other_seasons.items() if s < season}
    fixtures_by_season[season] = fixtures_before(fixtures, deadline)
    teams_by_season[season] = teams
    return team_goal_rate_table(fixtures_by_season, teams_by_season)


def _prior_season_rates(history_frame: pd.DataFrame, season: str) -> dict[int, dict]:
    """The live model's prior-season rate slice for ``season``'s players: their
    earlier-season rows, linked by name. Earlier seasons are complete before
    ``season`` starts, so no per-gameweek filter is needed."""
    links = links_by_name(history_frame, season)
    if not links:
        return {}
    earlier = history_frame[history_frame.index.get_level_values("season") < season]
    return archive_rates_for(links, season_rates(earlier))


def replay_gameweeks(
    season: str,
    history_frame: pd.DataFrame,
    fixtures: list[dict],
    teams: list[dict],
    rolling_window: int = ROLLING_WINDOW,
    *,
    other_seasons: dict[str, dict] | None = None,
) -> Iterator[ReplayedGameweek]:
    """Yield every replayable gameweek of one season under the kickoff-time
    leakage guard. Shared by ``replay`` and ``scripts/residual_analysis.py`` so
    the per-player analysis can never drift from what the backtest scores.

    ``other_seasons`` -- ``{season: {"fixtures": [...], "teams": [...]}}`` for
    the team-strength table's prior-season results; only seasons before
    ``season`` are used."""
    id_to_short = {t["id"]: t.get("short_name") for t in teams}
    name_to_id = {t.get("name"): t["id"] for t in teams}
    ctx_fixtures = [
        {
            "event": f["gw"],
            "team_h": f["team_h"],
            "team_a": f["team_a"],
            "team_h_difficulty": f["team_h_difficulty"],
            "team_a_difficulty": f["team_a_difficulty"],
        }
        for f in fixtures
        if f.get("gw") is not None
    ]

    season_rows = (
        history_frame[history_frame.index.get_level_values("season") == season]
        .reset_index()
        .dropna(subset=["kickoff_time"])
    )
    if season_rows.empty:
        return
    prior_rates = _prior_season_rates(history_frame, season)

    for gw in sorted(season_rows["gw"].unique()):
        deadline = season_rows.loc[season_rows["gw"] == gw, "kickoff_time"].min()
        before = _frame_before(season_rows, deadline)
        if before.empty:
            continue

        players, live_history = _adapt_history(before, name_to_id)
        before_ids = set(before["historical_id"])
        frame = build_feature_frame(
            players,
            live_history,
            lambda hid: hid not in before_ids,
            rolling_window,
            archive_rates=prior_rates,
        )
        if frame.empty:
            continue

        ctx = ModelContext(
            fixtures=ctx_fixtures,
            minutes_model=_history_minutes_model(before),  # from pre-deadline rows only
            elements_by_id={},
            teams_by_id=id_to_short,
            team_strength=_strength_at(season, deadline, fixtures, teams, other_seasons or {}),
        )
        yield ReplayedGameweek(
            gw=int(gw),
            frame=frame,
            ctx=ctx,
            rows=season_rows[season_rows["gw"] == gw],
            id_to_short=id_to_short,
        )


def replay(
    season: str,
    history_frame: pd.DataFrame,
    fixtures: list[dict],
    teams: list[dict],
    rolling_window: int = ROLLING_WINDOW,
    *,
    other_seasons: dict[str, dict] | None = None,
) -> dict:
    """Replay one season. Returns per-season model/baseline XI points, their
    delta, and the number of gameweeks scored."""
    model_total = baseline_total = 0.0
    scored = 0
    per_gw: list[dict] = []

    for rg in replay_gameweeks(
        season, history_frame, fixtures, teams, rolling_window, other_seasons=other_seasons
    ):
        model_proj: list[dict] = []
        base_proj: list[dict] = []
        for pid, row in rg.frame.iterrows():
            b = baseline.project(row)
            m = model.project(row, rg.gw, rg.ctx)
            if isinstance(b, ColdStart) or isinstance(m, ColdStart):
                continue
            meta = {
                "id": int(pid),
                "element_type": int(row["element_type"]),
                "team": rg.id_to_short.get(row["team"], row["team"]),
            }
            model_proj.append({**meta, "points": float(m)})
            base_proj.append({**meta, "points": float(b)})

        actuals = dict(zip(rg.rows["historical_id"], rg.rows["total_points"]))
        model_pts = xi_actual_points(select_squad(model_proj), actuals)
        baseline_pts = xi_actual_points(select_squad(base_proj), actuals)
        # every projected player's squared error: far less noisy than XI points,
        # which hinge on eleven discrete picks
        errors = [
            (actuals[p["id"]] - p["points"]) ** 2
            for p in model_proj
            if actuals.get(p["id"]) is not None
        ]
        per_gw.append(
            {
                "gw": rg.gw,
                "model": model_pts,
                "baseline": baseline_pts,
                "mse": sum(errors) / len(errors) if errors else None,
            }
        )
        model_total += model_pts
        baseline_total += baseline_pts
        scored += 1

    return {
        "season": season,
        "modelPoints": round(model_total, 1),
        "baselinePoints": round(baseline_total, 1),
        "delta": round(model_total - baseline_total, 1),
        "gameweeks": scored,
        "perGw": per_gw,
    }


def xi_actual_points(selected: list[dict], actuals: dict) -> float:
    """Pick the best XI from the fifteen by projection, then score those eleven
    on what they actually did that gameweek."""
    if not selected:
        return 0.0
    xi, _bench = best_xi(
        [{"id": p["id"], "element_type": p["element_type"], "projected": p["points"]} for p in selected]
    )
    return float(sum(actuals.get(p["id"], 0.0) or 0.0 for p in xi))
