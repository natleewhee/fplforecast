"""Scoped team attack / defence strength (a bounded extension of KTD10).

FDR rates the opponent as one number. This adds the *shape* of that opponent:
a team with a weak defence lets a strong attacker score more; a team with a
weak attack lets a defender or keeper keep more clean sheets. The signal is
FPL's own ``strength_attack_*`` / ``strength_defence_*`` ratings, aggregated
across the archived seasons (``data/history/<season>/teams.json``, U3) by team
*short name* (``ARS``, ``LIV`` -- stable across seasons) and normalised to the
league average.

Pure: every function takes already-loaded dicts and returns plain data. The
full expected-goals λ model stays Deferred to Follow-Up Work; this is the
interim upgrade the user asked for.
"""

from __future__ import annotations

from dataclasses import dataclass

from engine.config import (
    HOME_GOALS_FACTOR,
    LEAGUE_AVG_GOALS_PER_TEAM,
    TEAM_LAMBDA_CLAMP,
    TEAM_STRENGTH_CLAMP,
    TEAM_STRENGTH_SHRINKAGE_SEASONS,
    TEAM_STRENGTH_WEIGHT,
)

_RATINGS = (
    "strength_attack_home",
    "strength_attack_away",
    "strength_defence_home",
    "strength_defence_away",
)

# element_type -> which side of the opponent matters
_ATTACKING_TYPES = {3, 4}  # MID, FWD gain against a weak opponent defence
_DEFENSIVE_TYPES = {1, 2}  # GKP, DEF gain against a weak opponent attack


@dataclass(frozen=True)
class TeamStrength:
    """Per-team multipliers around 1.0. ``attack_* > 1`` = scores more than the
    league average; ``defence_* > 1`` = concedes less than average (a stronger
    defence). Split home / away."""

    attack_home: float
    attack_away: float
    defence_home: float
    defence_away: float
    seasons: int


def _clamp(value: float) -> float:
    lo, hi = TEAM_STRENGTH_CLAMP
    return max(lo, min(hi, value))


def team_strength_table(
    teams_by_season: dict[str, list[dict]],
    *,
    shrinkage: float = TEAM_STRENGTH_SHRINKAGE_SEASONS,
) -> dict[str, TeamStrength]:
    """Aggregate ``teams.json`` payloads across seasons into one table keyed by
    team name. Each rating is that team's mean over its seasons divided by the
    league mean, then shrunk toward 1.0 for teams with few seasons of data."""
    league_totals: dict[str, list[float]] = {r: [] for r in _RATINGS}
    per_team: dict[str, dict[str, list[float]]] = {}

    for teams in teams_by_season.values():
        for team in teams:
            # keyed by short_name ("ARS", "LIV", ...) -- stable across seasons
            # and what the weekly view shows, unlike the per-season team id.
            name = team.get("short_name") or team.get("name")
            if not name:
                continue
            bucket = per_team.setdefault(name, {r: [] for r in _RATINGS})
            for rating in _RATINGS:
                value = team.get(rating)
                if isinstance(value, (int, float)) and value > 0:
                    bucket[rating].append(float(value))
                    league_totals[rating].append(float(value))

    league_mean = {
        rating: (sum(vals) / len(vals) if vals else 1.0)
        for rating, vals in league_totals.items()
    }

    table: dict[str, TeamStrength] = {}
    for name, bucket in per_team.items():
        seasons = max((len(v) for v in bucket.values()), default=0)
        ratios = {}
        for rating in _RATINGS:
            vals = bucket[rating]
            if not vals:
                ratios[rating] = 1.0
                continue
            raw_ratio = (sum(vals) / len(vals)) / league_mean[rating]
            n = len(vals)
            ratios[rating] = (n * raw_ratio + shrinkage * 1.0) / (n + shrinkage)
        table[name] = TeamStrength(
            attack_home=ratios["strength_attack_home"],
            attack_away=ratios["strength_attack_away"],
            defence_home=ratios["strength_defence_home"],
            defence_away=ratios["strength_defence_away"],
            seasons=seasons,
        )
    return table


def opponent_multiplier(
    table: dict[str, TeamStrength],
    opponent_name: str | None,
    *,
    player_element_type: int,
    player_is_home: bool,
) -> float:
    """Projection multiplier (around 1.0, clamped) from the opponent's strength.

    Attackers gain against a weak opponent defence; defenders/keepers gain
    against a weak opponent attack. An unknown opponent (promoted team not in
    the archive, or no table) is neutral -> 1.0.
    """
    strength = table.get(opponent_name) if opponent_name else None
    if strength is None:
        return 1.0

    if player_element_type in _ATTACKING_TYPES:
        opp = strength.defence_away if player_is_home else strength.defence_home
    elif player_element_type in _DEFENSIVE_TYPES:
        opp = strength.attack_away if player_is_home else strength.attack_home
    else:
        return 1.0

    if not opp:
        return 1.0
    # opp > 1 means the opponent is strong on that side -> suppress the player.
    return _clamp(1.0 / opp)


def blend_with_fdr(
    fdr_multiplier: float,
    strength_multiplier: float,
    *,
    weight: float = TEAM_STRENGTH_WEIGHT,
) -> float:
    """Fold the strength multiplier into the FDR multiplier at ``weight``.
    ``weight = 0`` leaves FDR untouched; ``weight = 1`` applies strength fully."""
    return fdr_multiplier * (1.0 + weight * (strength_multiplier - 1.0))


def expected_goals(
    table: dict[str, TeamStrength],
    attacking_team: str | None,
    defending_team: str | None,
    *,
    attacker_home: bool,
    base: float = LEAGUE_AVG_GOALS_PER_TEAM,
    home_factor: float = HOME_GOALS_FACTOR,
) -> float:
    """Expected goals the ``attacking_team`` scores against ``defending_team``
    in one fixture: ``base * attack_ratio / opponent_defence_ratio``, times the
    home factor when the attacker is at home. An unknown team contributes a
    neutral ratio of 1.0. Clamped to a sane band."""
    atk = table.get(attacking_team) if attacking_team else None
    dfn = table.get(defending_team) if defending_team else None
    atk_ratio = (atk.attack_home if attacker_home else atk.attack_away) if atk else 1.0
    # the defender plays the opposite venue to the attacker
    def_ratio = (dfn.defence_away if attacker_home else dfn.defence_home) if dfn else 1.0

    lam = base * atk_ratio / (def_ratio or 1.0)
    if attacker_home:
        lam *= home_factor
    lo, hi = TEAM_LAMBDA_CLAMP
    return max(lo, min(hi, lam))
