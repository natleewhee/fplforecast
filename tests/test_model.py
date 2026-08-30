"""U6 coverage: projection model + scoped team strength + hover breakdown."""

from __future__ import annotations

import pytest

from engine.history import ColdStart
from engine.model import ModelContext, minutes_risk_flag, project, project_detail
from engine.strength import team_strength_table


def feature_row(pid=1, element_type=4, team=10, cold_start=False, hist=5.0, ict=5.0, form=5.0):
    return {
        "player_id": pid,
        "element_type": element_type,
        "team": team,
        "cold_start": cold_start,
        "hist_scoring_avg": hist,
        "ict_recent": ict,
        "form_recent": form,
    }


def fixture(event, team_h, team_a, dh, da):
    return {"event": event, "team_h": team_h, "team_a": team_a, "team_h_difficulty": dh, "team_a_difficulty": da}


def ctx(**over):
    base = {
        "fixtures": [fixture(2, 10, 20, 1, 5)],  # team 10 at home, difficulty 1 -> fdr 1.2
        "minutes_model": {"1": {"expectedMinutes": 81, "per90Points": 5.0, "pStart": 0.9}},
        "elements_by_id": {1: {"status": "a", "chance_of_playing_next_round": None}},
    }
    base.update(over)
    return ModelContext(**base)


def test_happy_path_baseline_times_fdr_times_minutes():
    assert project(feature_row(), 2, ctx()) == pytest.approx(5.4)  # 5.0 * 1.2 * (81/90)


def test_no_minutes_model_leaves_the_minutes_term_at_one():
    assert project(feature_row(), 2, ctx(minutes_model={})) == pytest.approx(6.0)  # 5.0 * 1.2


def test_minutes_multiplier_is_capped_at_one_match():
    # The reused minutes model can shrink to > 90 on thin data; a leg is still
    # worth at most one match.
    blown = ctx(minutes_model={"1": {"expectedMinutes": 284.0, "per90Points": 5.0, "pStart": 1.0}})
    assert project(feature_row(), 2, blown) == pytest.approx(6.0)  # 5.0 * 1.2 * min(284,90)/90


def test_minutes_risk_flag_reads_pstart_against_the_threshold():
    risky = ctx(minutes_model={"1": {"expectedMinutes": 60, "per90Points": 4.0, "pStart": 0.4}})
    safe = ctx(minutes_model={"1": {"expectedMinutes": 88, "per90Points": 5.0, "pStart": 0.9}})

    assert minutes_risk_flag(feature_row(), risky) is True
    assert minutes_risk_flag(feature_row(), safe) is False
    assert minutes_risk_flag(feature_row(), ctx(minutes_model={})) is False


def test_blank_gameweek_zeroes_the_projection():
    assert project(feature_row(), 999, ctx()) == 0.0


def test_double_gameweek_sums_both_legs():
    two_legs = ctx(fixtures=[fixture(2, 10, 20, 3, 3), fixture(2, 30, 10, 3, 3)])
    single = project(feature_row(), 2, ctx(fixtures=[fixture(2, 10, 20, 3, 3)]))
    double = project(feature_row(), 2, two_legs)

    assert double == pytest.approx(2 * single)


def test_availability_veto_zeroes_an_injured_player():
    injured = ctx(elements_by_id={1: {"status": "i", "chance_of_playing_next_round": 0}})
    assert project(feature_row(), 2, injured) == 0.0


def test_cold_start_row_returns_a_marker_with_no_points():
    result = project(feature_row(cold_start=True), 2, ctx())
    assert isinstance(result, ColdStart)

    detail = project_detail(feature_row(cold_start=True), 2, ctx())
    assert detail["coldStart"] is True
    assert "points" not in detail or detail["points"] is None


def test_model_differs_from_baseline_only_by_fixture_and_minutes_terms():
    from engine.baseline import project as baseline_project

    row = feature_row()
    model_points = project(row, 2, ctx())
    base = baseline_project(row)

    assert model_points / base == pytest.approx(1.2 * (81 / 90))


def test_team_strength_lifts_an_attacker_against_a_weak_defence():
    league = [
        {"name": "LeakyD", "strength_attack_home": 1100, "strength_attack_away": 1100,
         "strength_defence_home": 800, "strength_defence_away": 800},
        {"name": "WallD", "strength_attack_home": 1100, "strength_attack_away": 1100,
         "strength_defence_home": 1500, "strength_defence_away": 1500},
        {"name": "Mid", "strength_attack_home": 1100, "strength_attack_away": 1100,
         "strength_defence_home": 1150, "strength_defence_away": 1150},
    ]
    strength = team_strength_table({"2024-25": league, "2023-24": league})
    teams_by_id = {20: "LeakyD", 30: "WallD"}

    vs_leaky = project(
        feature_row(element_type=4), 2,
        ctx(fixtures=[fixture(2, 10, 20, 3, 3)], teams_by_id=teams_by_id, team_strength=strength),
    )
    vs_wall = project(
        feature_row(element_type=4), 2,
        ctx(fixtures=[fixture(2, 10, 30, 3, 3)], teams_by_id=teams_by_id, team_strength=strength),
    )

    assert vs_leaky > vs_wall


def test_project_detail_exposes_the_full_calculation_for_the_hover():
    detail = project_detail(feature_row(), 2, ctx(teams_by_id={20: "Foe"}))

    assert set(detail) >= {
        "points", "base", "fixtureMultiplier", "minutesMultiplier",
        "availabilityMultiplier", "expectedMinutes", "minutesRisk", "opponents",
    }
    assert detail["base"] == pytest.approx(5.0)
    assert detail["opponents"][0]["team"] == "Foe"
    assert detail["opponents"][0]["wasHome"] is True
    assert detail["opponents"][0]["fdrRating"] == 1
