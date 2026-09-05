"""Component expected-points model (the deferred KTD10 rebuild).

xP is the sum of the FPL scoring components -- the structure every pundit site
uses (fplform, FantasyFootballPundit, FPL Review, FPL Pulse). Each component is
``P(event) * points(event, position)``, scaled by the minutes model:

    xP = appearance                                   (per leg)
       + xG/90 * mins90 * attack_adj * goal_pts(pos)
       + xA/90 * mins90 * attack_adj * 3
       + P(clean sheet) * cs_pts(pos) * P(60+)
       - 0.5 * lambda_against * mins90                (GKP / DEF)
       + saves/90 * mins90 * busyness / 3            (GKP)
       + P(hit defensive-action threshold) * 2       (DEF / MID / FWD)
       + expected bonus
       - expected yellow-card cost
    all * availability

Team goal expectations (``lambda_for`` / ``lambda_against``) come from
``engine.strength`` -- FPL's league-normalised attack / defence ratings plus a
home factor, not bookmaker odds. With ``team_strength`` absent the model falls
back to the FDR multiplier for the attacking adjustment and league-average
lambdas. Blank gameweek -> 0; double gameweek sums both legs.

A player with no Premier League history still gets a projection -- built from
whatever provisional per-90 rates the feature frame carries (a price-tier
prior, or discounted cross-league form) -- and is flagged ``provisional``.
This supersedes KTD11's marker-not-a-number rule per user direction.
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from dataclasses import dataclass, field

from engine.config import (
    ASSIST_POINTS,
    CLEAN_SHEET_POINTS,
    DC_POINTS,
    DC_THRESHOLD,
    GOAL_POINTS,
    GOALS_CONCEDED_PENALTY_PER_GOAL,
    LEAGUE_AVG_GOALS_PER_TEAM,
    MINUTES_RISK_PSTART,
    SAVE_POINTS_PER_SAVE,
)
from engine.features import availability_multiplier, fdr_multiplier, team_fixtures
from engine.strength import expected_goals

_GK, _DEF = 1, 2
_COMPONENTS = (
    "appearance",
    "goals",
    "assists",
    "cleanSheet",
    "goalsConceded",
    "saves",
    "defensiveContribution",
    "bonus",
    "cards",
)


@dataclass(frozen=True)
class ModelContext:
    """Everything the model needs that is constant across players for one run."""

    fixtures: list[dict]
    minutes_model: dict[str, dict]
    elements_by_id: dict[int, dict]
    teams_by_id: dict[int, str] | None = None
    team_strength: dict | None = field(default=None)


def _minutes_entry(feature_row: Mapping, ctx: ModelContext) -> dict | None:
    return (ctx.minutes_model or {}).get(str(feature_row["player_id"]))


def _minutes_profile(feature_row: Mapping, ctx: ModelContext) -> tuple[float, float, float, float | None]:
    """(mins90, P(plays 60+), P(appears at all), expectedMinutes).

    No minutes model at all (the backtest path) -> assume a full match. A model
    that simply has no row for this player -> a conservative fringe default."""
    if not ctx.minutes_model:
        return 1.0, 1.0, 1.0, None
    entry = _minutes_entry(feature_row, ctx)
    if not entry:
        return 0.5, 0.35, 0.55, None
    expected = entry.get("expectedMinutes")
    mins90 = min(float(expected), 90.0) / 90.0 if expected is not None else 0.7
    p_start = float(entry.get("pStart") or 0.0)
    p_cameo = float(entry.get("pCameo") or 0.0)
    return mins90, p_start, min(1.0, p_start + p_cameo), expected


def _team_name(team_id, ctx: ModelContext) -> str | None:
    return ctx.teams_by_id.get(team_id) if ctx.teams_by_id else None


def _leg_context(feature_row: Mapping, leg: dict, ctx: ModelContext) -> dict:
    """Per-leg fixture terms: both team lambdas, the attacking adjustment, and a
    render-ready opponent row."""
    element_type = int(feature_row["element_type"])
    home = bool(leg["was_home"])
    team = _team_name(feature_row["team"], ctx)
    opponent = _team_name(leg["opponent"], ctx)
    difficulty = leg["difficulty"]

    if ctx.team_strength is not None:
        lam_for = expected_goals(ctx.team_strength, team, opponent, attacker_home=home)
        lam_against = expected_goals(ctx.team_strength, opponent, team, attacker_home=not home)
        # scale a player's own scoring rate by how many goals their team is
        # expected to score this fixture relative to an average one -- the same
        # lambda the clean-sheet term uses, so the two stay coherent.
        attack_adj = lam_for / LEAGUE_AVG_GOALS_PER_TEAM
    else:
        lam_for = lam_against = LEAGUE_AVG_GOALS_PER_TEAM
        attack_adj = fdr_multiplier(difficulty) if difficulty is not None else 1.0

    return {
        "lam_for": lam_for,
        "lam_against": lam_against,
        "attack_adj": attack_adj,
        "opponent": {
            "team": opponent,
            "wasHome": home,
            "fdrRating": difficulty,
            "lambdaFor": round(lam_for, 2),
            "lambdaAgainst": round(lam_against, 2),
            "cleanSheetProb": round(math.exp(-lam_against), 3),
            "attackAdjust": round(attack_adj, 3),
        },
    }


def project_detail(feature_row: Mapping, target_gw: int, ctx: ModelContext) -> dict:
    """The projected points and every component behind them.

    A player with no Premier League history still gets a number -- built from
    the provisional per-90 rates the feature frame supplies (a price-tier prior,
    or discounted cross-league form) -- flagged ``provisional`` so the view can
    show it as an estimate.
    """
    provisional = bool(feature_row.get("provisional") or feature_row.get("cold_start"))
    legs = team_fixtures(feature_row["team"], target_gw, ctx.fixtures)
    opponents = [_leg_context(feature_row, leg, ctx)["opponent"] for leg in legs]

    et = int(feature_row["element_type"])
    mins90, p_start60, p_appear, expected_minutes = _minutes_profile(feature_row, ctx)

    def rate(name: str) -> float:
        try:
            return max(0.0, float(feature_row[name]))
        except (KeyError, TypeError, ValueError):
            return 0.0

    xg90, xa90 = rate("xg90"), rate("xa90")
    dc90, saves90 = rate("dc90"), rate("saves90")
    bonus90, yellow90 = rate("bonus90"), rate("yellow90")

    totals = dict.fromkeys(_COMPONENTS, 0.0)
    for leg in legs:
        lc = _leg_context(feature_row, leg, ctx)
        lam_against, attack_adj = lc["lam_against"], lc["attack_adj"]

        totals["appearance"] += p_start60 * 2 + max(0.0, p_appear - p_start60) * 1
        totals["goals"] += xg90 * mins90 * attack_adj * GOAL_POINTS.get(et, 4)
        totals["assists"] += xa90 * mins90 * attack_adj * ASSIST_POINTS
        totals["cleanSheet"] += math.exp(-lam_against) * CLEAN_SHEET_POINTS.get(et, 0) * p_start60
        if et in (_GK, _DEF):
            totals["goalsConceded"] -= GOALS_CONCEDED_PENALTY_PER_GOAL * lam_against * mins90
        if et == _GK:
            busyness = lam_against / LEAGUE_AVG_GOALS_PER_TEAM
            totals["saves"] += saves90 * mins90 * busyness * SAVE_POINTS_PER_SAVE
        if et in DC_THRESHOLD:
            p_hit = min(1.0, dc90 / DC_THRESHOLD[et])
            totals["defensiveContribution"] += p_hit * mins90 * DC_POINTS
        totals["bonus"] += bonus90 * mins90
        totals["cards"] -= yellow90 * mins90

    element = (ctx.elements_by_id or {}).get(int(feature_row["player_id"]), {})
    availability = availability_multiplier(element)
    points = sum(totals.values()) * availability

    return {
        "points": round(points, 2),
        "provisional": provisional,
        "rateSource": feature_row.get("rate_source", "history"),
        # Scaled by availability so components sum back to `points` -- callers
        # (e.g. the live tracker's per-component breakdown) rely on that invariant.
        "components": {name: round(value * availability, 2) for name, value in totals.items()},
        "availabilityMultiplier": round(availability, 3),
        "expectedMinutes": expected_minutes,
        "minutesRisk": minutes_risk_flag(feature_row, ctx),
        "opponents": opponents,
    }


def project(feature_row: Mapping, target_gw: int, ctx: ModelContext) -> float:
    """Projected points for the upcoming gameweek -- always a number now, even
    for a player with no Premier League history (see ``project_detail``)."""
    return project_detail(feature_row, target_gw, ctx)["points"]


def minutes_risk_flag(feature_row: Mapping, ctx: ModelContext) -> bool:
    """R13 flag: the minutes model's start probability is below the configured
    threshold. False when there is no minutes model (the backtest path)."""
    entry = _minutes_entry(feature_row, ctx)
    if not entry or entry.get("pStart") is None:
        return False
    return entry["pStart"] < MINUTES_RISK_PSTART
