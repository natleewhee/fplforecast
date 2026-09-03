"""UB1 coverage: the retrospective par-vs-rank calibration check (Part B of
the 2026-09-03 safety-score and calibration plan)."""

from __future__ import annotations

import json

import pytest

import scripts.score_par_calibration as pc
from scripts import compute_forecast as cf

# avg_entry_score per finished gameweek.
EVENTS = [
    {"id": 1, "finished": True, "data_checked": True, "average_entry_score": 40},
    {"id": 2, "finished": True, "data_checked": True, "average_entry_score": 45},
    {"id": 3, "finished": True, "data_checked": True, "average_entry_score": 50},
    {"id": 4, "finished": True, "data_checked": True, "average_entry_score": 42},
    {"id": 5, "finished": True, "data_checked": True, "average_entry_score": 44},
]

# points, overall_rank per gameweek. Deltas (points - avg) for GW1-3:
# +10, -5, +10 -> median 10 (feeds GW4's leave-one-out margin).
CURRENT = [
    {"event": 1, "points": 50, "overall_rank": 100_000},
    {"event": 2, "points": 40, "overall_rank": 90_000},  # rank held vs GW1
    {"event": 3, "points": 60, "overall_rank": 95_000},  # rank dropped vs GW2
    {"event": 4, "points": 45, "overall_rank": 80_000},  # rank held vs GW3
    {"event": 5, "points": 53, "overall_rank": 70_000},  # rank held vs GW4
]


def _bootstrap():
    return {"events": EVENTS}


@pytest.fixture
def wired(monkeypatch, tmp_path):
    monkeypatch.setattr(pc, "DATA_DIR", tmp_path)
    monkeypatch.setattr(cf, "load_bootstrap", lambda: _bootstrap())
    monkeypatch.setattr(cf, "load_entry_history", lambda: {"current": CURRENT})
    return tmp_path


def test_verdict_boundaries():
    assert pc.verdict_for(score=58, par=47, buffer=6) == "green"  # 11 > 6
    assert pc.verdict_for(score=50, par=47, buffer=6) == "amber"  # 0 <= 3 <= 6
    assert pc.verdict_for(score=47, par=47, buffer=6) == "amber"  # exactly at par
    assert pc.verdict_for(score=44, par=47, buffer=6) == "red"  # below par


def test_gw4_calibration_matches_a_hand_computed_leave_one_out_margin(wired):
    # Leave-one-out margin for GW4 uses only GW1-3: deltas +10, -5, +10 ->
    # sorted [-5, 10, 10], median (odd count) = 10. Three prior gameweeks
    # clears PAR_MARGIN_MIN_GAMEWEEKS (3) -> not provisional.
    row = pc.score_gameweek(4, CURRENT, EVENTS)
    assert row["marginProvisional"] is False
    # par = avg(GW4) 42 + margin 10 = 52; points(GW4) 45 -> diff -7 -> red.
    assert row["verdict"] == "red"
    # overall_rank improved (80,000 < 95,000) -> held, but red predicted a
    # drop -> a miss.
    assert row["rankMovement"] == "held"
    assert row["hit"] is False


def test_gw2_calibration_is_provisional_below_the_minimum_sample(wired):
    # Only GW1 precedes GW2 -- below PAR_MARGIN_MIN_GAMEWEEKS (3).
    row = pc.score_gameweek(2, CURRENT, EVENTS)
    assert row["marginProvisional"] is True
    # par = avg(GW2) 45 + margin 0 = 45; points(GW2) 40 -> diff -5 -> red.
    assert row["verdict"] == "red"
    # overall_rank improved (90,000 < 100,000) -> held, so this is also a miss.
    assert row["rankMovement"] == "held"
    assert row["hit"] is False


def test_gw1_cannot_be_scored_no_predecessor():
    assert pc.score_gameweek(1, CURRENT, EVENTS) is None


def test_main_writes_one_entry_per_data_checked_gameweek_from_gw2(wired):
    assert pc.main() == 0
    record = json.loads((wired / "record" / "par-calibration.json").read_text())
    assert record["gameweeksIncluded"] == [2, 3, 4, 5]
    assert record["summary"]["gameweeksScored"] == 4


def test_a_gameweek_already_in_the_record_is_not_rescored(wired):
    assert pc.main() == 0
    first = (wired / "record" / "par-calibration.json").read_bytes()
    assert pc.main() == 0
    assert (wired / "record" / "par-calibration.json").read_bytes() == first


def test_summary_reports_hit_rate_per_verdict_colour_not_only_pooled():
    entries = [
        {"gameweek": 1, "verdict": "green", "rankMovement": "held", "hit": True, "marginProvisional": False},
        {"gameweek": 2, "verdict": "green", "rankMovement": "held", "hit": True, "marginProvisional": False},
        {"gameweek": 3, "verdict": "red", "rankMovement": "held", "hit": False, "marginProvisional": False},
    ]
    summary = pc.summarise(entries)
    assert summary["gameweeksScored"] == 3
    assert summary["hitRate"] == pytest.approx(2 / 3, abs=1e-3)
    # Green is a perfect predictor here; red is not -- the pooled rate alone
    # would hide that, which is the whole point of RB3.
    assert summary["hitRateByVerdict"]["green"] == pytest.approx(1.0)
    assert summary["hitRateByVerdict"]["red"] == pytest.approx(0.0)
    assert summary["hitRateByVerdict"]["amber"] is None  # no amber verdicts seen


def test_summarise_with_no_entries_reports_none_rates():
    summary = pc.summarise([])
    assert summary == {
        "gameweeksScored": 0,
        "hitRate": None,
        "hitRateByVerdict": {"green": None, "amber": None, "red": None},
    }
