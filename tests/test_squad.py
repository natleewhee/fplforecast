"""U7 coverage: squad-vs-pool gap ranking over the rolling window (R12, R13, KD8, KTD5, KTD11)."""

from __future__ import annotations

import pandas as pd
import pytest

from engine.config import (
    ROLLING_WINDOW,
    SAFETY_BAND_PROVISIONAL_STDEV,
    SAFETY_BAND_Z,
    SAFETY_MIN_SAMPLE_PER_POSITION,
)
from engine.history import ColdStart
from engine.squad import floor_ceiling, pool_upgrades, window_points, window_points_by_gw, xi_floor_ceiling


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


# --- UA2: safety-score floor/ceiling (Part A) -----------------------------------


def test_floor_ceiling_uses_realised_stdev_once_the_sample_clears_the_minimum():
    residuals = [2.0, -2.0, 4.0, -4.0] * (SAFETY_MIN_SAMPLE_PER_POSITION // 4 + 1)
    by_position = {"3": residuals}
    import statistics as _stats

    stdev = _stats.pstdev(residuals)

    band = floor_ceiling(10.0, 3, by_position)

    assert band["bandProvisional"] is False
    assert band["floor"] == pytest.approx(10.0 - SAFETY_BAND_Z * stdev, abs=0.01)
    assert band["ceiling"] == pytest.approx(10.0 + SAFETY_BAND_Z * stdev, abs=0.01)


def test_floor_ceiling_falls_back_to_the_provisional_band_below_the_minimum_sample():
    by_position = {"1": [1.0, -1.0]}  # far fewer than SAFETY_MIN_SAMPLE_PER_POSITION

    band = floor_ceiling(5.0, 1, by_position)

    assert band["bandProvisional"] is True
    assert band["floor"] == pytest.approx(5.0 - SAFETY_BAND_Z * SAFETY_BAND_PROVISIONAL_STDEV)
    assert band["ceiling"] == pytest.approx(5.0 + SAFETY_BAND_Z * SAFETY_BAND_PROVISIONAL_STDEV)


def test_floor_ceiling_with_no_residual_history_is_provisional():
    band = floor_ceiling(5.0, 2, {})
    assert band["bandProvisional"] is True


def test_floor_never_goes_negative():
    band = floor_ceiling(1.0, 1, {"1": [1.0, -1.0]})  # provisional stdev far exceeds the projection
    assert band["floor"] == 0.0


def test_floor_ceiling_is_none_without_a_projection():
    assert floor_ceiling(None, 3, {}) is None


def test_xi_floor_ceiling_aggregates_via_sqrt_of_summed_variance_not_summed_range():
    # Two positions, each with enough history that its band is not provisional.
    by_position = {
        "1": [1.0, -1.0] * (SAFETY_MIN_SAMPLE_PER_POSITION // 2 + 1),  # stdev 1.0
        "2": [2.0, -2.0] * (SAFETY_MIN_SAMPLE_PER_POSITION // 2 + 1),  # stdev 2.0
    }
    xi = [
        {"projected": 5.0, "elementType": 1},
        {"projected": 6.0, "elementType": 2},
    ]

    band = xi_floor_ceiling(xi, by_position)

    expected_band = SAFETY_BAND_Z * (1.0**2 + 2.0**2) ** 0.5  # sqrt(sum of variance)
    naive_sum_of_ranges = SAFETY_BAND_Z * (1.0 + 2.0)
    assert expected_band < naive_sum_of_ranges  # the whole point of KDA3
    assert band["floor"] == pytest.approx(11.0 - expected_band, abs=0.01)
    assert band["ceiling"] == pytest.approx(11.0 + expected_band, abs=0.01)
    assert band["bandProvisional"] is False


def test_xi_floor_ceiling_doubles_the_captains_contribution_and_variance():
    by_position = {"1": [1.0, -1.0] * (SAFETY_MIN_SAMPLE_PER_POSITION // 2 + 1)}  # stdev 1.0
    xi = [{"projected": 5.0, "elementType": 1, "multiplier": 2}]

    band = xi_floor_ceiling(xi, by_position)

    assert band["floor"] == pytest.approx(10.0 - SAFETY_BAND_Z * 2.0, abs=0.01)  # 2x stdev, not 1x
    assert band["ceiling"] == pytest.approx(10.0 + SAFETY_BAND_Z * 2.0, abs=0.01)


def test_xi_floor_ceiling_is_provisional_if_any_player_is():
    by_position = {"1": [1.0, -1.0] * (SAFETY_MIN_SAMPLE_PER_POSITION // 2 + 1)}  # not provisional
    xi = [
        {"projected": 5.0, "elementType": 1},  # position 1 has enough history
        {"projected": 5.0, "elementType": 4},  # position 4 has none -> provisional
    ]

    assert xi_floor_ceiling(xi, by_position)["bandProvisional"] is True


