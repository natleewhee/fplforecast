"""Scoped team attack / defence strength (a bounded extension of KTD10).

FDR rates the opponent as one number. This adds the *shape* of that opponent:
a team with a weak defence lets a strong attacker score more; a team with a
weak attack lets a defender or keeper keep more clean sheets. The signal is
FPL's own ``strength_attack_*`` / ``strength_defence_*`` ratings, aggregated
across the archived seasons (``data/history/<season>/teams.json``, U3) by team
*short name* (``ARS``, ``LIV`` -- stable across seasons) and normalised to the
league average.

One rating per team per side (attack / defence), not split by venue: the
2026-09-04 home-advantage fix found the home/away split in FPL's own ratings
carries no reliable directional signal (checked across all 25 archived
teams, the split is mostly under 3% and inconsistently signed -- several
teams' away rating reads higher than their home rating). ``HOME_GOALS_FACTOR``
is the sole home-advantage mechanism; folding a noisy second one on top of it
only added unexplained variance to fixtures like an elite defence away at a
promoted side.

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

# Each side blends both the home- and away-context ratings FPL publishes into
# one number -- see the module docstring for why the venue split isn't kept.
_ATTACK_FIELDS = ("strength_attack_home", "strength_attack_away")
_DEFENCE_FIELDS = ("strength_defence_home", "strength_defence_away")

# element_type -> which side of the opponent matters
_ATTACKING_TYPES = {3, 4}  # MID, FWD gain against a weak opponent defence
_DEFENSIVE_TYPES = {1, 2}  # GKP, DEF gain against a weak opponent attack


@dataclass(frozen=True)
class TeamStrength:
    """Per-team multipliers around 1.0. ``attack > 1`` = scores more than the
    league average; ``defence > 1`` = concedes less than average (a stronger
    defence). One rating per side -- home advantage lives solely in
    ``HOME_GOALS_FACTOR``, not here."""

    attack: float
    defence: float
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
    team name. Each side's rating is that team's mean over its home- and
    away-context readings across all archived seasons, divided by the league
    mean, then shrunk toward 1.0 for teams with little data (few seasons, or
    seasons with early-season all-zero ratings -- see ``_RATINGS`` filtering
    below)."""
    league_totals = {"attack": [], "defence": []}
    per_team: dict[str, dict[str, list[float]]] = {}

    for teams in teams_by_season.values():
        for team in teams:
            # keyed by short_name ("ARS", "LIV", ...) -- stable across seasons
            # and what the weekly view shows, unlike the per-season team id.
            name = team.get("short_name") or team.get("name")
            if not name:
                continue
            bucket = per_team.setdefault(name, {"attack": [], "defence": []})
            for side, fields in (("attack", _ATTACK_FIELDS), ("defence", _DEFENCE_FIELDS)):
                for field in fields:
                    value = team.get(field)
                    if isinstance(value, (int, float)) and value > 0:
                        bucket[side].append(float(value))
                        league_totals[side].append(float(value))

    league_mean = {
        side: (sum(vals) / len(vals) if vals else 1.0) for side, vals in league_totals.items()
    }

    table: dict[str, TeamStrength] = {}
    for name, bucket in per_team.items():
        # a season contributes up to 2 readings per side (home + away context).
        seasons = max((len(v) for v in bucket.values()), default=0) // 2
        ratios = {}
        for side in ("attack", "defence"):
            vals = bucket[side]
            if not vals:
                ratios[side] = 1.0
                continue
            raw_ratio = (sum(vals) / len(vals)) / league_mean[side]
            # season-equivalents, not raw reading count (each season con-
            # tributes up to 2 readings/side) -- keeps TEAM_STRENGTH_SHRINKAGE_
            # SEASONS' units meaning what its name says, same as before this
            # side collapsed the home/away split into one bucket per side.
            n = len(vals) / 2
            ratios[side] = (n * raw_ratio + shrinkage * 1.0) / (n + shrinkage)
        table[name] = TeamStrength(attack=ratios["attack"], defence=ratios["defence"], seasons=seasons)
    return table


def opponent_multiplier(
    table: dict[str, TeamStrength],
    opponent_name: str | None,
    *,
    player_element_type: int,
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
        opp = strength.defence
    elif player_element_type in _DEFENSIVE_TYPES:
        opp = strength.attack
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
    neutral ratio of 1.0. Clamped to a sane band.

    ``attacker_home`` only gates ``home_factor`` now -- it no longer selects
    between a home- and away-context rating (see the module docstring)."""
    atk = table.get(attacking_team) if attacking_team else None
    dfn = table.get(defending_team) if defending_team else None
    atk_ratio = atk.attack if atk else 1.0
    def_ratio = dfn.defence if dfn else 1.0

    lam = base * atk_ratio / (def_ratio or 1.0)
    if attacker_home:
        lam *= home_factor
    lo, hi = TEAM_LAMBDA_CLAMP
    return max(lo, min(hi, lam))
