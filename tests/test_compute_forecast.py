"""U8 coverage: the three-column ``data/forecast/gwNN.json`` contract.

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
def written_forecast():
    """Run ``main()`` once against the committed data, hand back the parsed
    output, and put the committed file back afterwards."""
    original = FORECAST.read_bytes()
    try:
        assert cf.main() == 0
        yield json.loads(FORECAST.read_text())
    finally:
        FORECAST.write_bytes(original)


def test_three_column_shape(written_forecast):
    columns = written_forecast["columns"]
    assert isinstance(columns["model"], list)
    assert isinstance(columns["baseline"], list)

    current = columns["currentSquad"]
    assert isinstance(current["windowPoints"], (int, float))
    assert len(current["players"]) == 15


def test_target_and_based_on_gameweek(written_forecast):
    assert written_forecast["targetGameweek"] == written_forecast["basedOnGameweek"] + 1


def test_captain_is_a_model_column_starter(written_forecast):
    captain = written_forecast["captain"]
    assert captain["column"] == "model"
    squad_ids = {p["id"] for p in written_forecast["columns"]["currentSquad"]["players"]}
    assert captain["id"] in squad_ids


def test_gap_rows_carry_a_breakdown_and_opponents(written_forecast):
    rows = written_forecast["columns"]["model"] + written_forecast["columns"]["baseline"]
    for row in rows:
        for role in ("squadPlayer", "bestAlternative"):
            card = row[role]
            if card is None:
                continue
            assert {"id", "webName", "team", "position", "breakdown", "opponents"} <= set(card)
            assert "fdrRating" in card["breakdown"]["opponents"][0] or card["opponents"] == []


def test_running_record_is_null_when_absent(written_forecast):
    # The committed repo has no data/record/running.json.
    assert written_forecast["runningRecord"] is None


def test_all_three_columns_render_with_no_backtest_artifact(written_forecast):
    # AE3: nothing about the columns depends on data/backtest/ existing.
    assert not (ROOT / "data" / "backtest").exists()
    assert "model" in written_forecast["columns"]
    assert "baseline" in written_forecast["columns"]
    assert "currentSquad" in written_forecast["columns"]


def test_empty_column_serialises_as_a_list(monkeypatch):
    original = FORECAST.read_bytes()
    monkeypatch.setattr(cf, "top_gap_rows", lambda rows, *a, **k: [])
    try:
        assert cf.main() == 0
        out = json.loads(FORECAST.read_text())
        assert out["columns"]["model"] == []
        assert out["columns"]["baseline"] == []
        assert len(out["columns"]["currentSquad"]["players"]) == 15
    finally:
        FORECAST.write_bytes(original)


def test_cold_start_squad_players_show_no_projection(monkeypatch):
    original = FORECAST.read_bytes()
    monkeypatch.setattr(cf, "load_entity_resolution", lambda: {})
    monkeypatch.setattr(
        cf,
        "load_history",
        lambda _data_dir: HistoryArchive(frame=pd.DataFrame(), coverage={}),
    )
    try:
        assert cf.main() == 0
        out = json.loads(FORECAST.read_text())
        players = out["columns"]["currentSquad"]["players"]
        assert all(p["coldStart"] for p in players)
        assert all(p["projectedPoints"] is None for p in players)
    finally:
        FORECAST.write_bytes(original)


def test_apply_overrides_swaps_ids():
    assert cf.apply_overrides([1, 2, 3], [{"out": 2, "in": 99}]) == [1, 99, 3]
    # an 'out' id not in the squad is skipped, not fatal
    assert cf.apply_overrides([1, 2], [{"out": 7, "in": 8}]) == [1, 2]


def test_team_id_comes_from_the_environment(monkeypatch):
    import importlib

    monkeypatch.setenv("FPL_TEAM_ID", "42")
    reloaded = importlib.reload(cf)
    try:
        assert reloaded.TEAM_ID == "42"
    finally:
        monkeypatch.delenv("FPL_TEAM_ID", raising=False)
        importlib.reload(cf)
