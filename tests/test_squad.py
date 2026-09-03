"""U7 coverage: squad-vs-pool gap ranking over the rolling window (R12, R13, KD8, KTD5, KTD11)."""

from __future__ import annotations

import pandas as pd
import pytest

from engine.config import ROLLING_WINDOW
from engine.history import ColdStart
from engine.squad import pool_upgrades, window_points, window_points_by_gw


def test_pool_upgrades_flags_a_higher_projecting_same_position_player_over_budget():
    squad = [{"id": 1, "position": "MID", "price": 5.5, "total": 18.0}]
    pool = [{"id": 9, "position": "MID", "price": 6.0, "total": 24.0}]
    out = pool_upgrades(squad, pool, bank=0.3)
    assert out[1] == [{"poolPlayerId": 9, "gap": 6.0, "priceDelta": 0.5, "overBudget": True}]


def test_pool_upgrades_within_bank_is_not_over_budget():
    squad = [{"id": 1, "position": "MID", "price": 6.0, "total": 18.0}]
    pool = [{"id": 9, "position": "MID", "price": 5.5, "total": 20.0}]  # cheaper, better
    out = pool_upgrades(squad, pool, bank=0.0)
    assert out[1][0]["overBudget"] is False
    assert out[1][0]["priceDelta"] == -0.5


def test_pool_upgrades_are_same_position_only():
    squad = [{"id": 1, "position": "MID", "price": 6.0, "total": 10.0}]
    pool = [{"id": 9, "position": "FWD", "price": 6.0, "total": 30.0}]
    assert pool_upgrades(squad, pool, bank=5.0)[1] == []


def test_pool_upgrades_empty_when_the_held_player_leads_his_position():
    squad = [{"id": 1, "position": "GKP", "price": 5.0, "total": 20.0}]
    pool = [{"id": 9, "position": "GKP", "price": 5.0, "total": 15.0}]
    assert pool_upgrades(squad, pool, bank=5.0)[1] == []


def frame(*ids: int) -> pd.DataFrame:
    return pd.DataFrame({"player_id": list(ids)}).set_index("player_id", drop=False)


def test_window_points_sums_project_fn_over_the_window():
    pts = window_points(frame(1, 2), lambda row, gw: 2.0, start_gw=3, window=5)
    assert pts == {1: 10.0, 2: 10.0}


def test_window_defaults_to_config_rolling_window():
    assert ROLLING_WINDOW == 5
    pts = window_points(frame(1), lambda row, gw: 1.5, start_gw=1)
    assert pts[1] == pytest.approx(1.5 * ROLLING_WINDOW)


def test_captaincy_score_uses_a_single_gameweek_only():
    project_fn = lambda row, gw: float(gw)  # noqa: E731  -- diverges across the window
    five_gw = window_points(frame(1), project_fn, start_gw=1, window=5)
    one_gw = window_points(frame(1), project_fn, start_gw=1, window=1)

    assert five_gw[1] == 1 + 2 + 3 + 4 + 5
    assert one_gw[1] == 1.0


def test_a_cold_start_gameweek_maps_the_player_to_none():
    def project_fn(row, gw):
        return ColdStart() if row["player_id"] == 2 else 3.0

    pts = window_points(frame(1, 2), project_fn, start_gw=1, window=5)
    assert pts[1] == 15.0
    assert pts[2] is None


def test_window_points_by_gw_keeps_each_gameweek_value():
    by_gw = window_points_by_gw(frame(1, 2), lambda row, gw: float(gw), start_gw=3, window=5)
    assert by_gw == {1: [3.0, 4.0, 5.0, 6.0, 7.0], 2: [3.0, 4.0, 5.0, 6.0, 7.0]}


def test_window_points_by_gw_maps_a_cold_start_player_to_none():
    def project_fn(row, gw):
        return ColdStart() if row["player_id"] == 2 else 2.0

    by_gw = window_points_by_gw(frame(1, 2), project_fn, start_gw=1, window=5)
    assert by_gw[1] == [2.0, 2.0, 2.0, 2.0, 2.0]
    assert by_gw[2] is None


