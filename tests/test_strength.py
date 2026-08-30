"""Coverage for the scoped team-strength model (engine/strength.py)."""

from __future__ import annotations

import pytest

from engine.config import LEAGUE_AVG_GOALS_PER_TEAM, TEAM_LAMBDA_CLAMP, TEAM_STRENGTH_CLAMP
from engine.strength import (
    blend_with_fdr,
    expected_goals,
    opponent_multiplier,
    team_strength_table,
)


def team(name, atk_h, atk_a, def_h, def_a):
    return {
        "name": name,
        "strength_attack_home": atk_h,
        "strength_attack_away": atk_a,
        "strength_defence_home": def_h,
        "strength_defence_away": def_a,
    }


def test_strong_and_weak_teams_land_either_side_of_one():
    # League of four: Titans strong both ends, Minnows weak both ends.
    season = [
        team("Titans", 1400, 1400, 1400, 1400),
        team("Minnows", 900, 900, 900, 900),
        team("MidA", 1150, 1150, 1150, 1150),
        team("MidB", 1150, 1150, 1150, 1150),
    ]
    table = team_strength_table({"2024-25": season, "2023-24": season})

    assert table["Titans"].attack_home > 1.05
    assert table["Titans"].defence_home > 1.05
    assert table["Minnows"].attack_home < 0.95
    assert table["Minnows"].defence_home < 0.95


def test_fewer_seasons_shrink_harder_toward_one():
    strong = lambda: team("Strong", 1400, 1400, 1400, 1400)  # noqa: E731
    filler = [team("A", 1000, 1000, 1000, 1000), team("B", 1000, 1000, 1000, 1000)]

    one_season = team_strength_table({"2024-25": [strong(), *filler]})
    three_seasons = team_strength_table(
        {"2024-25": [strong(), *filler], "2023-24": [strong(), *filler], "2022-23": [strong(), *filler]}
    )

    assert 1.0 < one_season["Strong"].attack_home < three_seasons["Strong"].attack_home


def test_attacker_gains_against_a_weak_defence_loses_against_a_strong_one():
    season = [
        team("LeakyD", 1100, 1100, 800, 800),
        team("WallD", 1100, 1100, 1500, 1500),
        team("Mid", 1100, 1100, 1150, 1150),
    ]
    table = team_strength_table({"2024-25": season, "2023-24": season})

    # A home forward (element_type 4) faces the opponent's AWAY defence.
    vs_leaky = opponent_multiplier(table, "LeakyD", player_element_type=4, player_is_home=True)
    vs_wall = opponent_multiplier(table, "WallD", player_element_type=4, player_is_home=True)

    assert vs_leaky > 1.0
    assert vs_wall < 1.0


def test_defender_gains_against_a_weak_attack():
    season = [
        team("Blunt", 800, 800, 1100, 1100),
        team("Sharp", 1500, 1500, 1100, 1100),
        team("Mid", 1150, 1150, 1100, 1100),
    ]
    table = team_strength_table({"2024-25": season, "2023-24": season})

    vs_blunt = opponent_multiplier(table, "Blunt", player_element_type=2, player_is_home=False)
    vs_sharp = opponent_multiplier(table, "Sharp", player_element_type=2, player_is_home=False)

    assert vs_blunt > 1.0 > vs_sharp


def test_home_away_uses_the_right_side_of_the_opponent():
    season = [
        team("Split", 1100, 1100, 700, 1500),  # very weak home defence, very strong away defence
        team("Mid1", 1100, 1100, 1100, 1100),
        team("Mid2", 1100, 1100, 1100, 1100),
    ]
    table = team_strength_table({"2024-25": season, "2023-24": season})

    # Away forward faces the opponent's HOME defence (weak) -> boost.
    away_fwd = opponent_multiplier(table, "Split", player_element_type=4, player_is_home=False)
    # Home forward faces the opponent's AWAY defence (strong) -> suppress.
    home_fwd = opponent_multiplier(table, "Split", player_element_type=4, player_is_home=True)

    assert away_fwd > 1.0 > home_fwd


def test_unknown_opponent_is_neutral():
    table = team_strength_table({"2024-25": [team("Known", 1100, 1100, 1100, 1100)]})

    assert opponent_multiplier(table, "Promoted", player_element_type=4, player_is_home=True) == 1.0
    assert opponent_multiplier(table, None, player_element_type=2, player_is_home=False) == 1.0


def test_multiplier_is_clamped():
    season = [
        team("Absurd", 1100, 1100, 10, 10),  # near-zero defence
        team("Mid1", 1100, 1100, 1100, 1100),
        team("Mid2", 1100, 1100, 1100, 1100),
    ]
    table = team_strength_table({"2024-25": season, "2023-24": season})
    mult = opponent_multiplier(table, "Absurd", player_element_type=4, player_is_home=True)

    assert mult == pytest.approx(TEAM_STRENGTH_CLAMP[1])


def test_blend_with_fdr_scales_by_weight():
    assert blend_with_fdr(1.0, 1.3, weight=0.5) == pytest.approx(1.15)
    assert blend_with_fdr(1.0, 1.3, weight=0.0) == pytest.approx(1.0)
    assert blend_with_fdr(0.9, 0.8, weight=1.0) == pytest.approx(0.9 * 0.8)


def test_expected_goals_uses_attack_over_opponent_defence_and_home_boost():
    season = [
        team("Sharp", 1300, 1300, 1100, 1100),  # strong attack
        team("Leaky", 1100, 1100, 900, 900),  # weak defence
        team("Wall", 1100, 1100, 1400, 1400),  # strong defence
        team("Mid", 1100, 1100, 1100, 1100),
    ]
    table = team_strength_table({"2024-25": season, "2023-24": season})

    vs_leaky = expected_goals(table, "Sharp", "Leaky", attacker_home=True)
    vs_wall = expected_goals(table, "Sharp", "Wall", attacker_home=True)
    away = expected_goals(table, "Sharp", "Leaky", attacker_home=False)

    assert vs_leaky > vs_wall  # weaker opponent defence -> more goals
    assert vs_leaky > away  # home boost
    assert vs_leaky == pytest.approx(away * 1.15, rel=0.01)


def test_expected_goals_neutral_for_unknown_teams_and_clamped():
    table = team_strength_table({"2024-25": [team("Known", 1100, 1100, 1100, 1100)]})

    neutral = expected_goals(table, "Promoted", "AlsoNew", attacker_home=False)
    assert neutral == pytest.approx(LEAGUE_AVG_GOALS_PER_TEAM)

    absurd = [
        team("Cannon", 5000, 5000, 1100, 1100),
        team("Sieve", 1100, 1100, 10, 10),
        team("Mid", 1100, 1100, 1100, 1100),
    ]
    t2 = team_strength_table({"2024-25": absurd, "2023-24": absurd})
    assert expected_goals(t2, "Cannon", "Sieve", attacker_home=True) == pytest.approx(TEAM_LAMBDA_CLAMP[1])


def test_zero_ratings_are_ignored_not_treated_as_data():
    # A team whose file has all-zero strength (live bootstrap early season)
    # contributes nothing and comes out neutral.
    season = [
        team("EarlySeason", 0, 0, 0, 0),
        team("Real", 1200, 1200, 1200, 1200),
        team("Mid", 1000, 1000, 1000, 1000),
    ]
    table = team_strength_table({"2024-25": season})

    assert table["EarlySeason"].attack_home == 1.0
    assert table["EarlySeason"].seasons == 0
