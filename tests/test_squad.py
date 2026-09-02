"""U7 coverage: squad-vs-pool gap ranking over the rolling window (R12, R13, KD8, KTD5, KTD11)."""

from __future__ import annotations

import pandas as pd
import pytest

from engine.config import DISPLAY_GAP_ROWS, PRICE_BAND_M, ROLLING_WINDOW
from engine.history import ColdStart
from engine.squad import (
    pool_upgrades,
    rank_against_pool,
    top_alternatives,
    top_gap_rows,
    window_points,
    window_points_by_gw,
)


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


PRICE = {sid: 7.0 for sid in range(100)}
POS = {}


def _pos(ids, position):
    for i in ids:
        POS[i] = position


def test_gap_is_alternative_minus_squad_and_bigger_gaps_rank_first():
    _pos([1, 11], "FWD")
    _pos([2, 22], "DEF")
    window_pts = {1: 4.0, 11: 7.0, 2: 5.0, 22: 6.0}
    price = {1: 7.0, 11: 7.0, 2: 5.0, 22: 5.0}
    pos = {1: "FWD", 11: "FWD", 2: "DEF", 22: "DEF"}

    rows = rank_against_pool([1, 2], [11, 22], window_pts, price, pos)

    assert rows[0] == {"squadPlayer": 1, "bestAlternative": 11, "gapPoints": 3.0, "minutesRisk": False}
    assert rows[1]["squadPlayer"] == 2 and rows[1]["gapPoints"] == 1.0


def test_full_ranking_is_one_row_per_squad_player_display_slice_is_top_n_positive():
    squad = list(range(1, 16))
    pool = list(range(101, 116))
    pos = {i: "MID" for i in [*squad, *pool]}
    price = {i: 7.0 for i in [*squad, *pool]}
    # squad players project i/10; their pool twins project a growing amount more.
    window_pts = {i: i / 10 for i in squad}
    window_pts.update({101 + k: (k + 1) / 10 + k for k in range(15)})

    rows = rank_against_pool(squad, pool, window_pts, price, pos)
    display = top_gap_rows(rows)

    assert len(rows) == 15
    assert len(display) == DISPLAY_GAP_ROWS
    assert [r["gapPoints"] for r in display] == sorted((r["gapPoints"] for r in display), reverse=True)


def test_no_positive_gap_anywhere_returns_no_display_rows():
    pos = {1: "GKP", 2: "GKP"}
    price = {1: 5.0, 2: 5.0}
    rows = rank_against_pool([1], [2], {1: 6.0, 2: 4.0}, price, pos)

    assert rows[0]["gapPoints"] == -2.0  # an in-band alternative exists but is worse
    assert top_gap_rows(rows) == []  # nothing with a positive gap to show


def test_pool_player_outside_the_price_band_is_not_considered():
    pos = {1: "MID", 2: "MID", 3: "MID"}
    price = {1: 6.0, 2: 6.0 + PRICE_BAND_M, 3: 6.0 + PRICE_BAND_M + 0.01}
    window_pts = {1: 4.0, 2: 6.0, 3: 99.0}  # 3 is far better but out of band

    rows = rank_against_pool([1], [2, 3], window_pts, price, pos)

    assert rows[0]["bestAlternative"] == 2
    assert rows[0]["gapPoints"] == 2.0


def test_cold_start_pool_player_is_never_the_best_alternative():
    pos = {1: "FWD", 2: "FWD", 3: "FWD"}
    price = {1: 7.0, 2: 7.0, 3: 7.0}
    window_pts = {1: 4.0, 2: 5.0, 3: None}  # 3 is cold-start (None), would rank highest

    rows = rank_against_pool([1], [2, 3], window_pts, price, pos)

    assert rows[0]["bestAlternative"] == 2


def test_minutes_risk_is_attached_to_the_recommended_alternative():
    pos = {1: "DEF", 2: "DEF"}
    price = {1: 5.0, 2: 5.0}
    rows = rank_against_pool([1], [2], {1: 3.0, 2: 6.0}, price, pos, minutes_risk_by_id={2: True})

    assert rows[0]["minutesRisk"] is True


def test_top_alternatives_returns_ranked_slice_within_band():
    pos = {i: "MID" for i in (1, 10, 11, 12, 13)}
    price = {i: 7.0 for i in (1, 10, 11, 12)}
    price[13] = 7.0 + PRICE_BAND_M + 0.1  # out of band
    window_pts = {1: 4.0, 10: 9.0, 11: 7.0, 12: 6.0, 13: 99.0}

    alts = top_alternatives(1, [10, 11, 12, 13], window_pts, price, pos, limit=2)

    assert [a["id"] for a in alts] == [10, 11]  # best two in band, 13 excluded
    assert alts[0]["gapPoints"] == 5.0  # 9.0 - 4.0


def test_top_alternatives_gap_is_none_when_the_held_player_is_cold_start():
    pos = {1: "FWD", 2: "FWD"}
    price = {1: 8.0, 2: 8.0}
    alts = top_alternatives(1, [2], {1: None, 2: 30.0}, price, pos)

    assert alts[0]["id"] == 2
    assert alts[0]["gapPoints"] is None  # no baseline to measure a gain against
