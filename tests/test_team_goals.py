"""Coverage for the real-goals team-strength table (Phase 2 of the
2026-09-04 team-strength plan, engine/team_goals.py)."""

from __future__ import annotations

import pytest

from engine.config import TEAM_GOALS_SHRINKAGE_MATCHES
from engine.team_goals import team_goal_rate_table


def team(team_id, short_name):
    return {"id": team_id, "short_name": short_name}


def fixture(team_h, team_a, h_score, a_score, *, finished=True):
    return {
        "team_h": team_h,
        "team_a": team_a,
        "team_h_score": h_score,
        "team_a_score": a_score,
        "finished": finished,
    }


def test_unfinished_and_scoreless_fixtures_are_ignored():
    teams = {"s": [team(1, "A"), team(2, "B")]}
    fixtures = {
        "s": [
            fixture(1, 2, None, None, finished=False),  # not played
            fixture(1, 2, 2, 1),  # the only real result
        ]
    }
    table = team_goal_rate_table(fixtures, teams)
    assert table["A"].seasons == 1
    assert table["B"].seasons == 1


def test_a_team_with_no_finished_fixtures_is_neutral():
    teams = {"s": [team(1, "A")]}
    table = team_goal_rate_table({"s": []}, teams)
    assert table.get("A") is None  # never appears -- no fixture data at all


def test_high_scoring_team_reads_above_average_attack():
    teams = {"s": [team(1, "Sharp"), team(2, "Blunt"), team(3, "Mid1"), team(4, "Mid2")]}
    # Sharp scores heavily every match; Blunt scores nothing; Mid teams score
    # at a plain, equal rate against each other.
    fixtures = {
        "s": [
            fixture(1, 3, 4, 1),
            fixture(1, 4, 3, 1),
            fixture(2, 3, 0, 1),
            fixture(2, 4, 0, 1),
            fixture(3, 4, 1, 1),
        ]
    }
    table = team_goal_rate_table(fixtures, teams, shrinkage=0.01)  # near-zero -> mostly raw signal
    assert table["Sharp"].attack > 1.0
    assert table["Blunt"].attack < 1.0


def test_stingy_defence_reads_above_one_leaky_defence_below():
    teams = {"s": [team(1, "Wall"), team(2, "Sieve"), team(3, "Mid1"), team(4, "Mid2")]}
    fixtures = {
        "s": [
            fixture(1, 3, 2, 0),  # Wall (home) concedes 0
            fixture(1, 4, 2, 0),  # Wall (home) concedes 0
            fixture(2, 3, 1, 4),  # Sieve (home) concedes 4
            fixture(2, 4, 1, 5),  # Sieve (home) concedes 5
            fixture(3, 4, 1, 1),
        ]
    }
    table = team_goal_rate_table(fixtures, teams, shrinkage=0.01)
    assert table["Wall"].defence > 1.0
    assert table["Sieve"].defence < 1.0


def test_a_shutout_defence_does_not_divide_by_zero():
    teams = {"s": [team(1, "Wall"), team(2, "Opp")]}
    fixtures = {"s": [fixture(1, 2, 3, 0)]}  # Wall concedes 0 in its only match
    table = team_goal_rate_table(fixtures, teams)
    assert table["Wall"].defence > 1.0  # reads as a real (bounded) strong signal, never crashes


def test_fewer_matches_shrink_harder_toward_one():
    teams = {"s": [team(1, "Sharp"), team(2, "Filler")]}
    one_match = team_goal_rate_table({"s": [fixture(1, 2, 5, 0)]}, teams)
    many_matches = team_goal_rate_table(
        {"s": [fixture(1, 2, 5, 0)] * int(TEAM_GOALS_SHRINKAGE_MATCHES * 4)}, teams
    )
    assert 1.0 < one_match["Sharp"].attack < many_matches["Sharp"].attack


def test_both_teams_in_a_fixture_get_credited_correctly():
    teams = {"s": [team(1, "Home"), team(2, "Away")]}
    table = team_goal_rate_table({"s": [fixture(1, 2, 3, 1)]}, teams)
    # Home scored 3, conceded 1; Away scored 1, conceded 3 -- both read from
    # the single fixture, correctly attributed to each side.
    assert table["Home"].seasons == 1
    assert table["Away"].seasons == 1
    assert table["Home"].attack > table["Away"].attack


def test_team_ids_are_resolved_per_season_not_globally():
    # Team id 1 means different clubs in different seasons (promotion/
    # relegation churn) -- resolution must use that season's own teams list.
    teams = {
        "2023-24": [team(1, "OldClub")],
        "2024-25": [team(1, "NewClub")],
    }
    fixtures = {
        "2023-24": [fixture(1, 1, 2, 2)],  # degenerate but exercises the id 1 -> OldClub path
        "2024-25": [fixture(1, 1, 5, 5)],
    }
    table = team_goal_rate_table(fixtures, teams)
    assert "OldClub" in table and "NewClub" in table
