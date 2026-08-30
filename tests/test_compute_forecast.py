"""Contract coverage for the squad-anchored ``data/forecast/gwNN.json``.

The integration tests run the wrapper against the committed snapshots and
assert on the file it writes, restoring it afterwards.
"""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd
import pytest

import scripts.compute_forecast as cf
from engine.history import HistoryArchive

ROOT = Path(__file__).resolve().parent.parent
FORECAST = ROOT / "data" / "forecast" / "gw2.json"


@pytest.fixture(scope="module")
def forecast():
    """Run ``main()`` once against the committed data, hand back the parsed
    output, and put the committed file back afterwards."""
    original = FORECAST.read_bytes()
    try:
        assert cf.main() == 0
        yield json.loads(FORECAST.read_text())
    finally:
        FORECAST.write_bytes(original)


def test_squad_is_the_anchor(forecast):
    squad = forecast["squad"]
    assert isinstance(squad["windowPoints"], (int, float))
    assert len(squad["players"]) == 15
    assert "columns" not in forecast  # the three-column shape is gone


def test_target_and_based_on_gameweek(forecast):
    assert forecast["targetGameweek"] == forecast["basedOnGameweek"] + 1


def test_each_player_carries_both_projections_suggestion(forecast):
    for p in forecast["squad"]["players"]:
        for key in ("modelUpgrade", "baselineUpgrade"):
            upgrade = p[key]
            if upgrade is None:
                continue
            assert upgrade["gapPoints"] > 0
            assert isinstance(upgrade["meaningful"], bool)
            alt = upgrade["alternative"]
            assert {"id", "webName", "team", "position", "breakdown", "opponents"} <= set(alt)
            assert alt["position"] == p["position"]  # like-for-like swap


def test_exactly_one_captain_and_it_is_a_squad_member(forecast):
    captains = [p for p in forecast["squad"]["players"] if p["isCaptain"]]
    assert len(captains) == 1
    assert forecast["captain"]["id"] == captains[0]["id"]


def test_upgrade_count_matches_the_players(forecast):
    players = forecast["squad"]["players"]
    uc = forecast["upgradeCount"]
    assert uc["model"] == sum(1 for p in players if p["modelUpgrade"])
    assert uc["baseline"] == sum(1 for p in players if p["baselineUpgrade"])
    assert uc["meaningful"] <= max(uc["model"], uc["baseline"])
    assert uc["agree"] <= min(uc["model"], uc["baseline"])


def test_running_record_is_null_when_absent(forecast):
    assert forecast["runningRecord"] is None
    assert not (ROOT / "data" / "record" / "running.json").exists()


def test_no_backtest_artifact_is_required(forecast):
    # AE3 / KD4: both projections are always computed and the squad always
    # renders -- nothing here consults data/backtest/.
    assert "model" in forecast["upgradeCount"]
    assert "baseline" in forecast["upgradeCount"]
    assert len(forecast["squad"]["players"]) == 15


def test_cold_start_squad_players_show_no_projection(monkeypatch):
    original = FORECAST.read_bytes()
    monkeypatch.setattr(cf, "load_entity_resolution", lambda: {})
    monkeypatch.setattr(
        cf, "load_history", lambda _d: HistoryArchive(frame=pd.DataFrame(), coverage={})
    )
    try:
        assert cf.main() == 0
        players = json.loads(FORECAST.read_text())["squad"]["players"]
        assert all(p["coldStart"] for p in players)
        assert all(p["projectedPoints"] is None for p in players)
    finally:
        FORECAST.write_bytes(original)


def test_apply_overrides_swaps_ids():
    assert cf.apply_overrides([1, 2, 3], [{"out": 2, "in": 99}]) == [1, 99, 3]
    assert cf.apply_overrides([1, 2], [{"out": 7, "in": 8}]) == [1, 2]  # unknown 'out' skipped


def test_team_id_comes_from_the_environment(monkeypatch):
    import importlib

    monkeypatch.setenv("FPL_TEAM_ID", "42")
    reloaded = importlib.reload(cf)
    try:
        assert reloaded.TEAM_ID == "42"
    finally:
        monkeypatch.delenv("FPL_TEAM_ID", raising=False)
        importlib.reload(cf)
