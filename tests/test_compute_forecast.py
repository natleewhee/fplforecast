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
    assert forecast["basedOnGameweek"] == 1  # squad still from the last finished GW


def test_recommended_xi_and_bench(forecast):
    squad = forecast["squad"]
    assert len(squad["startingXi"]) == 11
    assert len(squad["bench"]) == 4
    assert set(squad["startingXi"]) | set(squad["bench"]) == {p["id"] for p in squad["players"]}
    for p in squad["players"]:
        assert p["role"] in ("start", "bench")


def test_each_player_carries_alternatives_and_both_suggestions(forecast):
    for p in forecast["squad"]["players"]:
        assert isinstance(p["alternatives"], list)
        for a in p["alternatives"]:
            assert a["position"] == p["position"]  # like-for-like
            assert "breakdown" in a and "opponents" in a
        for key in ("modelUpgrade", "baselineUpgrade"):
            if p[key] is not None:
                assert p[key]["gapPoints"] > 0


def test_exactly_one_captain_in_the_squad(forecast):
    captains = [p for p in forecast["squad"]["players"] if p["isCaptain"]]
    assert len(captains) == 1
    assert forecast["captain"]["id"] == captains[0]["id"]


def test_running_record_is_null_until_a_gameweek_is_scored(forecast):
    assert forecast["runningRecord"] is None


def test_cold_start_alternatives_have_no_gap_number(forecast):
    # a cold-start held player has no baseline to measure a gain against
    for p in forecast["squad"]["players"]:
        if p["coldStart"]:
            assert all(a["gapPoints"] is None for a in p["alternatives"])


def test_cold_start_squad_players_show_no_projection(monkeypatch):
    path = _target_path()
    original = path.read_bytes() if path.exists() else None
    monkeypatch.setattr(cf, "load_entity_resolution", lambda: {})
    monkeypatch.setattr(cf, "load_history", lambda _d: HistoryArchive(frame=pd.DataFrame(), coverage={}))
    try:
        assert cf.main(now=NOW) == 0
        players = json.loads(path.read_text())["squad"]["players"]
        assert all(p["coldStart"] for p in players)
        assert all(p["projectedPoints"] is None for p in players)
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
