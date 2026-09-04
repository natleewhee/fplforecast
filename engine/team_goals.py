"""Real per-match team attack/defence strength (Phase 2 of the 2026-09-04
team-strength plan).

``engine.strength.team_strength_table`` derives attack/defence from FPL's own
admin-set ``strength_*`` ratings -- a coarse, compressed proxy that barely
separates elite and weak teams (an elite defence reads only ~5-10% above
average against the archive) and never updates from a team's actual
in-season results; the rating a promoted side gets in August is the rating
it keeps in January regardless of what actually happens on the pitch.

This module replaces that proxy with real goals-for/against, aggregated from
every *finished* fixture in the archive (``data/history/<season>/
fixtures.json``, ``scripts/ingest_history.py``) across all seasons --
including the in-progress one. Because the current season's own fixtures
file is re-ingested daily, a team's rating here moves as real results
accumulate through the season, not just once a year at most.

Pure: every function takes already-loaded dicts and returns plain data.
Produces the same ``engine.strength.TeamStrength`` shape so
``engine.strength.expected_goals`` and ``opponent_multiplier`` consume either
source identically -- only the table-building call site differs."""

from __future__ import annotations

from engine.config import LEAGUE_AVG_GOALS_PER_TEAM, TEAM_GOALS_SHRINKAGE_MATCHES
from engine.strength import TeamStrength


def team_goal_rate_table(
    fixtures_by_season: dict[str, list[dict]],
    teams_by_season: dict[str, list[dict]],
    *,
    shrinkage: float = TEAM_GOALS_SHRINKAGE_MATCHES,
) -> dict[str, TeamStrength]:
    """One ``TeamStrength`` per team, keyed by short name, from real
    per-match goals across every finished fixture in ``fixtures_by_season``.

    ``attack`` = the team's own goals-for rate over the league-wide average.
    ``defence`` = the league-wide average goals-against rate over the team's
    own goals-against rate, so a stronger defence (which concedes fewer)
    still reads > 1 -- matching ``engine.strength``'s convention, where the
    consumer divides by ``defence``. Both shrunk toward 1.0 by matches played
    (``shrinkage``): a team with few finished fixtures (a promoted side early
    in its first season back, or any team early in a season) reads close to
    neutral rather than a wild extrapolation from a handful of results.

    ``teams_by_season`` supplies each season's numeric team id -> short name
    mapping (fixtures key teams by id, which is not stable across seasons;
    short name is) -- the same payload ``engine.strength.team_strength_table``
    already takes, so one loader call feeds both tables.

    The ``seasons`` field on the result is a **match count** here, not a
    season count -- carried over from ``TeamStrength`` for shape parity with
    the admin-rating table, not season-equivalence."""
    goals_for: dict[str, list[float]] = {}
    goals_against: dict[str, list[float]] = {}

    for season, fixtures in fixtures_by_season.items():
        teams = teams_by_season.get(season) or []
        name_by_id = {
            t["id"]: (t.get("short_name") or t.get("name"))
            for t in teams
            if t.get("id") is not None
        }
        for f in fixtures:
            if not f.get("finished"):
                continue
            h_score, a_score = f.get("team_h_score"), f.get("team_a_score")
            if h_score is None or a_score is None:
                continue
            h_name = name_by_id.get(f.get("team_h"))
            a_name = name_by_id.get(f.get("team_a"))
            if h_name:
                goals_for.setdefault(h_name, []).append(float(h_score))
                goals_against.setdefault(h_name, []).append(float(a_score))
            if a_name:
                goals_for.setdefault(a_name, []).append(float(a_score))
                goals_against.setdefault(a_name, []).append(float(h_score))

    all_for = [g for vals in goals_for.values() for g in vals]
    league_avg_for = sum(all_for) / len(all_for) if all_for else LEAGUE_AVG_GOALS_PER_TEAM
    all_against = [g for vals in goals_against.values() for g in vals]
    league_avg_against = sum(all_against) / len(all_against) if all_against else LEAGUE_AVG_GOALS_PER_TEAM

    table: dict[str, TeamStrength] = {}
    for name in set(goals_for) | set(goals_against):
        gf = goals_for.get(name, [])
        ga = goals_against.get(name, [])
        n = len(gf)  # goals_for/against always populated together, one entry per match

        if n == 0:
            table[name] = TeamStrength(attack=1.0, defence=1.0, seasons=0)
            continue

        attack_raw = (sum(gf) / n) / league_avg_for if league_avg_for else 1.0
        attack = (n * attack_raw + shrinkage * 1.0) / (n + shrinkage)

        own_against_rate = sum(ga) / n
        # a shutout-so-far team (own_against_rate == 0) would divide by zero.
        # Floor it at a tenth of a goal/match rather than snapping to 1.0
        # (neutral) or leaving it undefined -- a real shutout streak should
        # still read as a strong (bounded) defensive signal pre-shrink, not
        # get thrown away as "no information".
        defence_raw = league_avg_against / max(own_against_rate, 0.1)
        defence = (n * defence_raw + shrinkage * 1.0) / (n + shrinkage)

        table[name] = TeamStrength(attack=attack, defence=defence, seasons=n)
    return table
