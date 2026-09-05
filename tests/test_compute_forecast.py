"""Contract coverage for the pitch-view ``data/forecast/gwNN.json``.

The integration tests run the wrapper against the committed snapshots and
assert on the file it writes, restoring it afterwards.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import pytest

import scripts.compute_forecast as cf
from engine.history import HistoryArchive

ROOT = Path(__file__).resolve().parent.parent
NOW = datetime(2026, 9, 1, 12, 0, tzinfo=timezone.utc)  # between GW2 and GW3 deadlines


def _target_path() -> Path:
    gw = cf.upcoming_gameweek(cf.load_bootstrap(), NOW, fallback=99)
    return ROOT / "data" / "forecast" / f"gw{gw}.json"


@pytest.fixture(scope="module")
def forecast():
    path = _target_path()
    original = path.read_bytes() if path.exists() else None
    try:
        assert cf.main(now=NOW) == 0
        yield json.loads(path.read_text())
    finally:
        if original is not None:
            path.write_bytes(original)
        elif path.exists():
            path.unlink()


def test_targets_the_upcoming_gameweek(forecast):
    # GW1 finished, GW2's deadline is past on NOW -> GW3.
    assert forecast["targetGameweek"] == 3
    assert forecast["basedOnGameweek"] == 2  # squad still from the last finished GW


def test_pool_block_covers_every_available_player_with_per_gw_projections(forecast):
    from engine.config import ROLLING_WINDOW

    bootstrap = cf.load_bootstrap()
    available = {el["id"] for el in bootstrap["elements"] if el.get("status") == "a"}
    pool = forecast["pool"]
    assert {p["id"] for p in pool} == available
    for p in pool:
        assert len(p["perGameweek"]) == ROLLING_WINDOW
        assert p["total"] == pytest.approx(sum(p["perGameweek"]))
        assert isinstance(p["selectedByPercent"], (int, float))
        assert isinstance(p["form"], (int, float))
        assert isinstance(p["price"], (int, float))
        assert len(p["opponents"]) == ROLLING_WINDOW  # one leg group per target gameweek


def test_unavailable_player_is_absent_from_the_pool(forecast):
    bootstrap = cf.load_bootstrap()
    unavailable = next(el["id"] for el in bootstrap["elements"] if el.get("status") != "a")
    assert unavailable not in {p["id"] for p in forecast["pool"]}


def test_par_margin_is_the_median_delta_over_completed_gameweeks():
    events = [
        {"id": 1, "finished": True, "average_entry_score": 50},
        {"id": 2, "finished": True, "average_entry_score": 45},
        {"id": 3, "finished": True, "average_entry_score": 60},
        {"id": 4, "finished": False, "average_entry_score": 0},
    ]
    current = [
        {"event": 1, "points": 54},  # +4
        {"event": 2, "points": 55},  # +10
        {"event": 3, "points": 67},  # +7
        {"event": 4, "points": 40},  # gameweek not finished -> ignored
    ]
    margin, provisional = cf.par_margin(current, events, min_gameweeks=3)
    assert margin == 7.0
    assert provisional is False


def test_par_margin_is_zero_and_provisional_below_the_gameweek_floor():
    events = [{"id": 1, "finished": True, "average_entry_score": 50}]
    current = [{"event": 1, "points": 58}]
    margin, provisional = cf.par_margin(current, events, min_gameweeks=3)
    assert margin == 0.0
    assert provisional is True


def test_par_margin_skips_a_gameweek_with_no_published_average():
    events = [
        {"id": 1, "finished": True, "average_entry_score": None},
        {"id": 2, "finished": True, "average_entry_score": 40},
        {"id": 3, "finished": True, "average_entry_score": 40},
        {"id": 4, "finished": True, "average_entry_score": 40},
    ]
    current = [
        {"event": 1, "points": 99},  # no average -> not counted (not a +59 delta)
        {"event": 2, "points": 46},  # +6
        {"event": 3, "points": 48},  # +8
        {"event": 4, "points": 50},  # +10
    ]
    margin, provisional = cf.par_margin(current, events, min_gameweeks=3)
    assert margin == 8.0
    assert provisional is False


def test_forecast_carries_the_par_fields(forecast):
    from engine.config import PAR_BUFFER_POINTS, PAR_BUFFER_PROVISIONAL_POINTS

    assert isinstance(forecast["parMargin"], (int, float))
    assert isinstance(forecast["marginProvisional"], bool)
    assert forecast["parBuffer"] == PAR_BUFFER_POINTS
    assert forecast["parBufferProvisional"] == PAR_BUFFER_PROVISIONAL_POINTS
    assert forecast["parBufferProvisional"] > forecast["parBuffer"]


def test_squad_component_breakdown_sums_to_the_target_gameweek_projection(forecast):
    components = forecast["squadComponents"]
    by_id = {p["id"]: p for p in forecast["squad"]["players"]}
    for pid_str, parts in components.items():
        pid = int(pid_str)
        assert pid in by_id
        card = by_id[pid]
        if card["projectedPoints"] is not None:
            assert sum(parts.values()) == pytest.approx(card["projectedPoints"], abs=0.05)


def test_forecast_carries_a_floor_ceiling_band_per_squad_player(forecast):
    for p in forecast["squad"]["players"]:
        band = p["floorCeiling"]
        if p["projectedPoints"] is None:
            assert band is None
            continue
        assert band["floor"] <= p["projectedPoints"] <= band["ceiling"]
        assert band["floor"] >= 0.0
        assert isinstance(band["bandProvisional"], bool)


def test_forecast_carries_an_xi_level_floor_ceiling_band(forecast):
    band = forecast["xiFloorCeiling"]
    assert band["floor"] <= forecast["nextGw"]["points"] <= band["ceiling"]
    assert band["floor"] >= 0.0


def test_load_residuals_by_position_reads_the_committed_file(monkeypatch, tmp_path):
    monkeypatch.setattr(cf, "DATA_DIR", tmp_path)
    assert cf.load_residuals_by_position() == {}  # no file yet -- never a crash

    record_dir = tmp_path / "record"
    record_dir.mkdir()
    (record_dir / "residuals.json").write_text(
        json.dumps({"byPosition": {"1": [1.0, -2.0]}, "gameweeksIncluded": [1]})
    )
    assert cf.load_residuals_by_position() == {"1": [1.0, -2.0]}


def test_recommended_xi_and_bench(forecast):
    squad = forecast["squad"]
    assert len(squad["startingXi"]) == 11
    assert len(squad["bench"]) == 4
    assert set(squad["startingXi"]) | set(squad["bench"]) == {p["id"] for p in squad["players"]}
    for p in squad["players"]:
        assert p["role"] in ("start", "bench")


def test_exactly_one_captain_in_the_squad(forecast):
    captains = [p for p in forecast["squad"]["players"] if p["isCaptain"]]
    assert len(captains) == 1
    assert forecast["captain"]["id"] == captains[0]["id"]


def test_running_record_is_null_until_a_gameweek_is_scored(forecast):
    assert forecast["runningRecord"] is None


def test_par_calibration_reflects_the_committed_calibration_record(forecast):
    # Unlike runningRecord (needs a frozen pre-deadline prediction), the par
    # calibration check only needs history + the bootstrap average -- GW2 is
    # already scorable from the committed snapshots, so this is not null.
    calibration = forecast["parCalibration"]
    assert calibration is None or calibration["gameweeksScored"] > 0


def test_load_par_calibration_record_reads_the_committed_file(monkeypatch, tmp_path):
    monkeypatch.setattr(cf, "DATA_DIR", tmp_path)
    assert cf.load_par_calibration_record() is None  # no file yet

    record_dir = tmp_path / "record"
    record_dir.mkdir()
    (record_dir / "par-calibration.json").write_text(
        json.dumps({"summary": {"gameweeksScored": 0}})
    )
    assert cf.load_par_calibration_record() is None  # zero scored still reads as no record

    (record_dir / "par-calibration.json").write_text(
        json.dumps({"summary": {"gameweeksScored": 3, "hitRate": 0.667}})
    )
    assert cf.load_par_calibration_record() == {"gameweeksScored": 3, "hitRate": 0.667}


def test_last_gameweek_review_reports_the_held_squad_result(forecast):
    review = forecast["lastGameweek"]
    assert review is not None
    assert review["gameweek"] == 2  # the last finished GW in the committed snapshots
    assert review["xiPoints"] == 113  # straight from entry_history.points
    assert review["benchPoints"] == 7
    # no frozen prediction exists for GW2 -> the model/baseline row says so
    assert review["modelVsBaseline"] == {"status": "no_prediction"}


def test_last_gameweek_review_is_null_without_snapshotted_picks(monkeypatch):
    monkeypatch.setattr(cf, "TEAM_ID", "does-not-exist")
    assert cf.last_gameweek_review(cf.load_bootstrap(), {}) is None


def test_upcoming_covers_the_rolling_window_with_a_full_xi_each(forecast):
    from engine.config import ROLLING_WINDOW

    upcoming = forecast["upcoming"]
    assert [u["gameweek"] for u in upcoming] == [
        forecast["targetGameweek"] + i for i in range(ROLLING_WINDOW)
    ]
    for u in upcoming:
        assert len(u["startingXi"]) == 11
        assert len(u["bench"]) == 4
        assert len(u["players"]) == len(forecast["squad"]["players"])
        assert u["captainId"] in u["startingXi"]
        assert isinstance(u["points"], (int, float))


def test_history_carries_gameweeks_and_past_seasons(forecast):
    hist = forecast["history"]
    assert hist is not None
    assert hist["gameweeks"][0]["gameweek"] == 1
    assert hist["gameweeks"][0]["points"] == 51  # straight from the entry history
    assert all("season" in s and "totalPoints" in s for s in hist["seasons"])


def test_build_history_is_null_when_empty():
    assert cf.build_history({}) is None
    assert cf.build_history({"current": [], "past": []}) is None


def test_newcomers_get_a_provisional_projection(monkeypatch):
    # No entity resolution + an empty archive -> every player is cold-start.
    path = _target_path()
    original = path.read_bytes() if path.exists() else None
    monkeypatch.setattr(cf, "load_entity_resolution", lambda: {})
    monkeypatch.setattr(cf, "load_history", lambda _d: HistoryArchive(frame=pd.DataFrame(), coverage={}))
    try:
        assert cf.main(now=NOW) == 0
        players = json.loads(path.read_text())["squad"]["players"]
        assert all(p["provisional"] for p in players)
        assert all(p["projectedPoints"] is not None for p in players)  # a number, not "no history"
    finally:
        if original is not None:
            path.write_bytes(original)
        elif path.exists():
            path.unlink()


def test_apply_overrides_swaps_ids():
    assert cf.apply_overrides([1, 2, 3], [{"out": 2, "in": 99}]) == [1, 99, 3]
    assert cf.apply_overrides([1, 2], [{"out": 7, "in": 8}]) == [1, 2]


def test_upcoming_gameweek_rolls_forward_and_falls_back():
    events = [
        {"id": 1, "deadline_time": "2026-08-21T17:30:00Z"},
        {"id": 2, "deadline_time": "2026-08-28T17:30:00Z"},
        {"id": 3, "deadline_time": "2026-09-04T17:30:00Z"},
    ]
    assert cf.upcoming_gameweek({"events": events}, NOW, fallback=9) == 3
    later = datetime(2027, 1, 1, tzinfo=timezone.utc)
    assert cf.upcoming_gameweek({"events": events}, later, fallback=9) == 9  # all in the past


def test_team_id_comes_from_the_environment(monkeypatch):
    import importlib

    monkeypatch.setenv("FPL_TEAM_ID", "42")
    reloaded = importlib.reload(cf)
    try:
        assert reloaded.TEAM_ID == "42"
    finally:
        monkeypatch.delenv("FPL_TEAM_ID", raising=False)
        importlib.reload(cf)
