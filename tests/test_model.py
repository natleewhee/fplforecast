"""U6 (rebuilt): the component expected-points model."""

from __future__ import annotations

import math

import pytest

from engine.config import CLEAN_SHEET_POINTS, DC_THRESHOLD, GOAL_POINTS, LEAGUE_AVG_GOALS_PER_TEAM
from engine.history import ColdStart
from engine.model import ModelContext, minutes_risk_flag, project, project_detail
from engine.strength import team_strength_table

RATES = ("xg90", "xa90", "dc90", "gc90", "saves90", "bonus90", "yellow90")


def feature_row(pid=1, element_type=4, team=10, cold_start=False, **rates):
    row = {"player_id": pid, "element_type": element_type, "team": team, "cold_start": cold_start}
    for r in RATES:
        row[r] = rates.get(r, 0.0)
    return row


def fixture(event, team_h, team_a, dh=3, da=3):
    return {"event": event, "team_h": team_h, "team_a": team_a, "team_h_difficulty": dh, "team_a_difficulty": da}


def ctx(minutes=None, team_strength=None, fixtures=None, element=None, **over):
    mm = {"1": {"expectedMinutes": 90, "per90Points": 5, "pStart": 0.95, "pCameo": 0.03}} if minutes is None else minutes
    return ModelContext(
        fixtures=fixtures if fixtures is not None else [fixture(3, 10, 20)],
        minutes_model=mm,
        elements_by_id={1: element or {"status": "a", "chance_of_playing_next_round": None}},
        teams_by_id={10: "AAA", 20: "BBB", 30: "CCC"},
        team_strength=team_strength,
        **over,
    )


def test_nailed_starter_gets_two_appearance_points():
    d = project_detail(feature_row(), 3, ctx())
    assert d["components"]["appearance"] == pytest.approx(0.95 * 2 + 0.03 * 1)


def test_rotation_risk_gets_fewer_appearance_points():
    mm = {"1": {"expectedMinutes": 55, "pStart": 0.4, "pCameo": 0.35}}
    d = project_detail(feature_row(), 3, ctx(minutes=mm))
    assert d["components"]["appearance"] == pytest.approx(0.4 * 2 + 0.35 * 1)


def test_goal_points_scale_by_position():
    pts = {}
    for et in (1, 2, 3, 4):
        d = project_detail(feature_row(element_type=et, xg90=0.5), 3, ctx())
        pts[et] = d["components"]["goals"]
    # same xG rate, but GKP/DEF worth 6, MID 5, FWD 4
    assert pts[2] > pts[3] > pts[4]
    assert pts[1] == pytest.approx(pts[2])
    assert pts[4] == pytest.approx(0.5 * (90 / 90) * 1.0 * GOAL_POINTS[4])  # no team_strength -> adj 1.0


def test_assist_points_are_three_each():
    d = project_detail(feature_row(xa90=0.4), 3, ctx())
    assert d["components"]["assists"] == pytest.approx(0.4 * 3)


def test_clean_sheet_is_poisson_on_opponent_lambda():
    d = project_detail(feature_row(element_type=2), 3, ctx())  # no team_strength -> lam = league avg
    expected = math.exp(-LEAGUE_AVG_GOALS_PER_TEAM) * CLEAN_SHEET_POINTS[2] * 0.95
    assert d["components"]["cleanSheet"] == pytest.approx(expected, abs=0.01)  # component is 2dp
    assert d["opponents"][0]["cleanSheetProb"] == pytest.approx(math.exp(-LEAGUE_AVG_GOALS_PER_TEAM), abs=0.01)


def test_goals_conceded_penalty_only_for_gk_and_def():
    dep = {e: project_detail(feature_row(element_type=e), 3, ctx())["components"]["goalsConceded"] for e in (1, 2, 3, 4)}
    assert dep[1] < 0 and dep[2] < 0
    assert dep[3] == 0.0 and dep[4] == 0.0


def test_saves_only_for_keepers_and_scale_with_a_busy_fixture():
    quiet = team_strength_table(
        {"s": [
            {"short_name": "AAA", "strength_attack_home": 1100, "strength_attack_away": 1100,
             "strength_defence_home": 1100, "strength_defence_away": 1100},
            {"short_name": "BBB", "strength_attack_home": 700, "strength_attack_away": 700,
             "strength_defence_home": 1100, "strength_defence_away": 1100},
            {"short_name": "M", "strength_attack_home": 1100, "strength_attack_away": 1100,
             "strength_defence_home": 1100, "strength_defence_away": 1100},
        ]}
    )
    busy = team_strength_table(
        {"s": [
            {"short_name": "AAA", "strength_attack_home": 1100, "strength_attack_away": 1100,
             "strength_defence_home": 1100, "strength_defence_away": 1100},
            {"short_name": "BBB", "strength_attack_home": 1500, "strength_attack_away": 1500,
             "strength_defence_home": 1100, "strength_defence_away": 1100},
            {"short_name": "M", "strength_attack_home": 1100, "strength_attack_away": 1100,
             "strength_defence_home": 1100, "strength_defence_away": 1100},
        ]}
    )
    row = feature_row(element_type=1, saves90=3.0)
    outfield = project_detail(feature_row(element_type=3, saves90=3.0), 3, ctx(team_strength=busy))
    assert outfield["components"]["saves"] == 0.0

    q = project_detail(row, 3, ctx(team_strength=quiet))["components"]["saves"]
    b = project_detail(row, 3, ctx(team_strength=busy))["components"]["saves"]
    assert b > q > 0


def test_defensive_contribution_uses_the_position_threshold():
    # dc90 exactly at the DEF threshold -> full 2 points; MID needs more actions
    d_def = project_detail(feature_row(element_type=2, dc90=DC_THRESHOLD[2]), 3, ctx())
    d_mid = project_detail(feature_row(element_type=3, dc90=DC_THRESHOLD[2]), 3, ctx())
    assert d_def["components"]["defensiveContribution"] == pytest.approx(2.0)
    assert d_mid["components"]["defensiveContribution"] < 2.0  # 10 / 12 of the way
    assert "defensiveContribution" not in [c for c in d_def if c is None]
    d_gk = project_detail(feature_row(element_type=1, dc90=20), 3, ctx())
    assert d_gk["components"]["defensiveContribution"] == 0.0


def test_blank_gameweek_is_zero():
    d = project_detail(feature_row(xg90=1.0), 999, ctx())
    assert d["points"] == 0.0
    assert all(v == 0.0 for v in d["components"].values())


def test_double_gameweek_roughly_doubles_every_component():
    single = project_detail(feature_row(xg90=0.5, xa90=0.3), 3, ctx(fixtures=[fixture(3, 10, 20)]))
    double = project_detail(
        feature_row(xg90=0.5, xa90=0.3), 3, ctx(fixtures=[fixture(3, 10, 20), fixture(3, 30, 10)])
    )
    assert double["points"] == pytest.approx(2 * single["points"], rel=1e-6)
    assert len(double["opponents"]) == 2


def test_availability_veto_zeroes_an_injured_player():
    injured = ctx(element={"status": "i", "chance_of_playing_next_round": 0})
    assert project(feature_row(xg90=0.8), 3, injured) == 0.0


def test_cold_start_returns_a_marker():
    result = project(feature_row(cold_start=True, xg90=1.0), 3, ctx())
    assert isinstance(result, ColdStart)
    d = project_detail(feature_row(cold_start=True), 3, ctx())
    assert d["coldStart"] is True and "points" not in d or d.get("points") is None


def test_no_minutes_model_assumes_a_full_match():
    d = project_detail(feature_row(element_type=2, xg90=0.1), 3, ctx(minutes={}))
    assert d["components"]["appearance"] == pytest.approx(2.0)  # p_start60 = 1.0
    assert d["expectedMinutes"] is None


def test_stronger_attacking_fixture_lifts_goal_points():
    strong = team_strength_table(
        {"s": [
            {"short_name": "AAA", "strength_attack_home": 1500, "strength_attack_away": 1500,
             "strength_defence_home": 1100, "strength_defence_away": 1100},
            {"short_name": "BBB", "strength_attack_home": 1100, "strength_attack_away": 1100,
             "strength_defence_home": 800, "strength_defence_away": 800},
            {"short_name": "M", "strength_attack_home": 1100, "strength_attack_away": 1100,
             "strength_defence_home": 1100, "strength_defence_away": 1100},
        ]}
    )
    neutral_goals = project_detail(feature_row(xg90=0.5), 3, ctx())["components"]["goals"]
    strong_goals = project_detail(feature_row(xg90=0.5), 3, ctx(team_strength=strong))["components"]["goals"]
    assert strong_goals > neutral_goals


def test_minutes_risk_flag_reads_pstart():
    assert minutes_risk_flag(feature_row(), ctx(minutes={"1": {"pStart": 0.4}})) is True
    assert minutes_risk_flag(feature_row(), ctx(minutes={"1": {"pStart": 0.9}})) is False
    assert minutes_risk_flag(feature_row(), ctx(minutes={})) is False
