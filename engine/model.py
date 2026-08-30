"""U6: the projection model -- the baseline's inputs plus fixture difficulty,
opponent strength, and minutes risk (R8, R13, KTD9, KTD10 + the scoped
team-strength extension).

    points = baseline
           * fixture_multiplier      (FDR per leg, blended with opponent strength)
           * minutes_multiplier      (expectedMinutes / 90, or 1.0 with no model)
           * availability_multiplier  (injury / suspension veto, applied last)

A blank gameweek has no legs -> 0.0. A double gameweek sums both legs. With
``team_strength`` absent (the backtest path, KTD6) the strength term is 1.0
and the model reduces to baseline x FDR x minutes. A cold-start player is a
marker, never a number (KTD11).

``project_detail`` returns the same number plus the full calculation, for the
weekly view's hover-to-explain (user request).
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field

from engine import baseline
from engine.config import MINUTES_RISK_PSTART
from engine.features import availability_multiplier, fdr_multiplier, team_fixtures
from engine.history import ColdStart
from engine.strength import blend_with_fdr, opponent_multiplier


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


def _fixture_multiplier(feature_row: Mapping, target_gw: int, ctx: ModelContext) -> tuple[float, list[dict]]:
    """Summed per-leg (FDR blended with opponent strength), plus one opponent
    breakdown row per leg. Empty legs -> (0.0, []) for a blank gameweek."""
    element_type = int(feature_row["element_type"])
    legs = team_fixtures(feature_row["team"], target_gw, ctx.fixtures)

    total = 0.0
    opponents: list[dict] = []
    for leg in legs:
        difficulty = leg["difficulty"]
        leg_fdr = fdr_multiplier(difficulty) if difficulty is not None else 1.0
        opponent_name = ctx.teams_by_id.get(leg["opponent"]) if ctx.teams_by_id else None
        strength_mult = (
            opponent_multiplier(
                ctx.team_strength,
                opponent_name,
                player_element_type=element_type,
                player_is_home=leg["was_home"],
            )
            if ctx.team_strength is not None
            else 1.0
        )
        total += blend_with_fdr(leg_fdr, strength_mult)
        opponents.append(
            {
                "team": opponent_name,
                "wasHome": leg["was_home"],
                "fdrRating": difficulty,
                "fdrMultiplier": round(leg_fdr, 3),
                "strengthMultiplier": round(strength_mult, 3),
            }
        )
    return total, opponents


def project_detail(feature_row: Mapping, target_gw: int, ctx: ModelContext) -> dict:
    """The projected points and every factor behind them."""
    base = baseline.project(feature_row)
    fixture_mult, opponents = _fixture_multiplier(feature_row, target_gw, ctx)

    if isinstance(base, ColdStart):
        return {"points": None, "coldStart": True, "opponents": opponents}

    entry = _minutes_entry(feature_row, ctx)
    # A player contributes at most one match's worth of minutes per fixture leg;
    # doubles are already handled by summing legs in the fixture multiplier. The
    # reused minutes model can shrink to > 90 on thin data, so cap here.
    minutes_mult = (min(entry["expectedMinutes"], 90) / 90) if entry else 1.0
    element = (ctx.elements_by_id or {}).get(int(feature_row["player_id"]), {})
    availability_mult = availability_multiplier(element)

    points = base * fixture_mult * minutes_mult * availability_mult
    return {
        "points": round(points, 2),
        "coldStart": False,
        "base": round(float(base), 2),
        "fixtureMultiplier": round(fixture_mult, 3),
        "minutesMultiplier": round(minutes_mult, 3),
        "availabilityMultiplier": round(availability_mult, 3),
        "expectedMinutes": entry["expectedMinutes"] if entry else None,
        "minutesRisk": minutes_risk_flag(feature_row, ctx),
        "opponents": opponents,
    }


def project(feature_row: Mapping, target_gw: int, ctx: ModelContext) -> float | ColdStart:
    """Projected points, or ``ColdStart`` when the player has no history (KTD11)."""
    detail = project_detail(feature_row, target_gw, ctx)
    if detail["coldStart"]:
        return ColdStart()
    return detail["points"]


def minutes_risk_flag(feature_row: Mapping, ctx: ModelContext) -> bool:
    """R13 flag: the minutes model's start probability is below the configured
    threshold. Separate from the ``expectedMinutes / 90`` scaling that is the
    R8 input. False when there is no minutes model (the backtest path)."""
    entry = _minutes_entry(feature_row, ctx)
    if not entry or entry.get("pStart") is None:
        return False
    return entry["pStart"] < MINUTES_RISK_PSTART
