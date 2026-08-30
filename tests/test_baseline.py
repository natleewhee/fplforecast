"""U5 coverage: shared feature frame + composite baseline (R7, KD1, KTD4, KTD5, KTD11)."""

from __future__ import annotations

import pandas as pd
import pytest

from engine.baseline import project, project_pool
from engine.config import BASELINE_WEIGHTS
from engine.features import build_feature_frame
from engine.history import ColdStart


def live_gw(*players: tuple[int, int, int, float]) -> dict:
    """(id, total_points, minutes, ict_index) -> one event-live payload."""
    return {
        "elements": [
            {"id": pid, "stats": {"total_points": tp, "minutes": mn, "ict_index": str(ict)}}
            for pid, tp, mn, ict in players
        ]
    }


def player(pid: int, element_type: int = 3, team: str = "ARS", now_cost: int = 50) -> dict:
    return {"id": pid, "element_type": element_type, "team": team, "now_cost": now_cost}


NEVER_COLD = lambda _pid: False  # noqa: E731


def test_equal_weights_average_the_three_terms():
    frame = pd.DataFrame(
        [{"cold_start": False, "hist_scoring_avg": 4.0, "ict_recent": 6.0, "form_recent": 5.0}]
    )
    assert project(frame.iloc[0]) == pytest.approx(5.0)


def test_project_pool_returns_one_row_per_player_none_cold():
    frame = build_feature_frame(
        [player(1), player(2), player(3)],
        [live_gw((1, 6, 90, 6.0), (2, 2, 45, 2.0), (3, 0, 0, 0.0))],
        NEVER_COLD,
        rolling_window=5,
    )
    pool = project_pool(frame)

    assert list(pool.index) == [1, 2, 3]
    assert not pool["cold_start"].any()
    assert pool.loc[1, "points"] > 0  # exact value is shrinkage-dependent


def _el(pid, tp, mn):
    return {"id": pid, "stats": {"total_points": tp, "minutes": mn, "ict_index": "0"}}


def test_hist_ignores_dnp_gameweeks_but_form_counts_them():
    # Players 1 and 2 both scored 8 on their one appearance; player 2 also has a
    # trailing DNP gameweek. Same hist (appearances only), lower form for 2.
    live = [
        {"elements": [_el(1, 8, 90), _el(2, 8, 90)]},
        {"elements": [_el(1, 8, 90), _el(2, 0, 0)]},
    ]
    frame = build_feature_frame([player(1), player(2)], live, NEVER_COLD, rolling_window=5)

    assert frame.loc[1, "hist_scoring_avg"] == pytest.approx(frame.loc[2, "hist_scoring_avg"])
    assert frame.loc[2, "form_recent"] < frame.loc[1, "form_recent"]


def test_shrinkage_pulls_a_thin_sample_toward_the_position_prior():
    fillers = [
        {"elements": [{"id": fid, "stats": {"total_points": 3, "minutes": 90, "ict_index": "0"}}]}
        for fid in (91, 92, 93, 94)
    ]
    hot = {"elements": [{"id": 1, "stats": {"total_points": 15, "minutes": 90, "ict_index": "0"}}]}
    live = [{"elements": hot["elements"] + sum((f["elements"] for f in fillers), [])}]

    frame = build_feature_frame(
        [player(1), *(player(fid) for fid in (91, 92, 93, 94))], live, NEVER_COLD, rolling_window=5
    )
    # 15 on one appearance is pulled well below halfway toward the 3.0 prior.
    assert frame.loc[1, "hist_scoring_avg"] < (15 + 3) / 2


def test_short_history_averages_over_available_gameweeks():
    frame = build_feature_frame(
        [player(1)],
        [live_gw((1, 8, 90, 5.0)), live_gw((1, 4, 90, 3.0))],  # 2 GWs, window 5
        NEVER_COLD,
        rolling_window=5,
    )
    assert frame.loc[1, "form_recent"] == pytest.approx(6.0)  # (8 + 4) / 2, not / 5


def test_missing_ict_cell_contributes_no_term():
    payload = {"elements": [{"id": 1, "stats": {"total_points": 5, "minutes": 90, "ict_index": None}}]}
    frame = build_feature_frame([player(1)], [payload], NEVER_COLD, rolling_window=5)
    assert frame.loc[1, "ict_recent"] == 0.0  # averaged over zero present values


def test_cold_start_feature_row_returns_marker_not_a_number():
    frame = build_feature_frame(
        [player(7)],
        [live_gw((7, 3, 60, 2.0))],
        lambda pid: pid == 7,
        rolling_window=5,
    )
    result = project(frame.loc[7])

    assert isinstance(result, ColdStart)
    assert result.status == "cold_start"

    pool = project_pool(frame)
    assert pool.loc[7, "cold_start"] is True or bool(pool.loc[7, "cold_start"]) is True
    assert pool.loc[7, "points"] is None


def test_baseline_source_names_no_model_only_signal():
    # The plan's verification: `rg "fdr|minutes|expectedMinutes" engine/baseline.py`
    # returns nothing -- the baseline must not reach into the model's inputs.
    from pathlib import Path

    src = (Path(__file__).resolve().parent.parent / "engine" / "baseline.py").read_text().lower()
    for token in ("fdr", "minutes", "expectedminutes"):
        assert token not in src


def test_weights_are_the_documented_equal_split():
    assert sum(BASELINE_WEIGHTS.values()) == pytest.approx(1.0)
    assert len(set(BASELINE_WEIGHTS.values())) == 1
