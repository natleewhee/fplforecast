"""Characterization coverage for the U1 extraction.

The projection math moved out of ``scripts/compute_forecast.py`` into
``engine/`` with no change to the written forecast.
``tests/golden/forecast_gw2.json`` is the pre-refactor output; the wrapper
must still reproduce it byte-for-byte apart from the volatile ``generatedAt``
timestamp.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

import scripts.compute_forecast as cf
from engine.features import project_squad
from engine.squad import best_xi

ROOT = Path(__file__).resolve().parent.parent
GOLDEN = ROOT / "tests" / "golden" / "forecast_gw2.json"
FORECAST_GW2 = ROOT / "data" / "forecast" / "gw2.json"


def _golden_players() -> dict[int, dict]:
    data = json.loads(GOLDEN.read_text())
    return {p["id"]: p for p in [*data["startingXI"], *data["bench"]]}


@pytest.fixture
def inputs() -> dict:
    """The exact inputs ``scripts/compute_forecast.py`` feeds the projection,
    loaded through the script's own ``load_*`` helpers so the test tracks the
    real call path."""
    bootstrap = cf.load_bootstrap()
    gw, picks = cf.load_latest_picks()
    return {
        "picks": picks,
        "target_gw": gw + 1,
        "elements_by_id": {el["id"]: el for el in bootstrap["elements"]},
        "teams_by_id": {t["id"]: t["short_name"] for t in bootstrap["teams"]},
        "minutes_model": cf.load_minutes_model(),
        "rolling_averages": cf.load_rolling_averages(),
        "fixtures": cf.load_fixtures(),
    }


def test_project_squad_matches_pre_refactor_output(inputs):
    """Every projection dict — projected value and all metadata — matches the
    committed golden for every player in the squad."""
    squad = project_squad(**inputs)
    golden = _golden_players()

    assert {p["id"] for p in squad} == set(golden)
    for player in squad:
        assert player == golden[player["id"]]


def test_best_xi_matches_pre_refactor_selection(inputs):
    """The starting XI and bench (ids, in order) match the golden."""
    starting, bench = best_xi(project_squad(**inputs))
    golden = json.loads(GOLDEN.read_text())

    assert [p["id"] for p in starting] == [p["id"] for p in golden["startingXI"]]
    assert [p["id"] for p in bench] == [p["id"] for p in golden["bench"]]


def test_best_xi_picks_top_projections_within_a_legal_formation():
    """Hand-built 15: the four cheap 0.0 players are benched, the XI is the
    highest-scoring legal (1 GKP, 3-5 DEF, 2-5 MID, 1-3 FWD) shape."""
    def player(pid, etype, projected):
        return {"id": pid, "element_type": etype, "projected": projected}

    squad = [
        player(1, 1, 5.0), player(2, 1, 0.0),                       # GKP
        player(3, 2, 6.0), player(4, 2, 5.5), player(5, 2, 5.0),
        player(6, 2, 1.0), player(7, 2, 0.0),                       # DEF
        player(8, 3, 9.0), player(9, 3, 7.0), player(10, 3, 6.5),
        player(11, 3, 6.0), player(12, 3, 0.0),                     # MID
        player(13, 4, 8.0), player(14, 4, 7.5), player(15, 4, 0.0),  # FWD
    ]
    starting, bench = best_xi(squad)

    assert {p["id"] for p in bench} == {2, 7, 12, 15}
    assert len(starting) == 11
    # 1-4-4-2: GKP 5.0 + DEF (6+5.5+5+1) + MID (9+7+6.5+6) + FWD (8+7.5)
    assert sum(p["projected"] for p in starting) == pytest.approx(66.5)


def test_unknown_pick_element_id_is_skipped(inputs):
    inputs["picks"] = [*inputs["picks"], {"element": 9_999_999}]
    squad = project_squad(**inputs)

    assert 9_999_999 not in {p["id"] for p in squad}
    assert len(squad) == len(_golden_players())


def test_missing_minutes_model_entry_falls_back_to_rolling_average(inputs):
    target_id = next(iter(_golden_players()))
    inputs["minutes_model"] = {
        k: v for k, v in inputs["minutes_model"].items() if k != str(target_id)
    }
    inputs["rolling_averages"] = {**inputs["rolling_averages"], target_id: 7.0}

    row = next(p for p in project_squad(**inputs) if p["id"] == target_id)

    assert row["component"] == "rolling-average"
    assert row["expectedMinutes"] is None
    assert row["projected"] == round(7.0 * row["fdrMultiplier"], 2)


def test_blank_gameweek_zeroes_every_projection(inputs):
    inputs["target_gw"] = 999  # no fixtures scheduled for this gameweek
    squad = project_squad(**inputs)

    assert squad, "expected the squad to still be built"
    assert all(p["fdrMultiplier"] == 0.0 for p in squad)
    assert all(p["projected"] == 0.0 for p in squad)


def test_script_end_to_end_reproduces_the_golden():
    """Running the wrapper against the committed fixtures rewrites
    data/forecast/gw2.json identically to the golden, save for generatedAt."""
    original = FORECAST_GW2.read_bytes()
    try:
        result = subprocess.run(
            [sys.executable, str(ROOT / "scripts" / "compute_forecast.py")],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0, result.stderr

        produced = json.loads(FORECAST_GW2.read_text())
        golden = json.loads(GOLDEN.read_text())
        produced.pop("generatedAt", None)
        golden.pop("generatedAt", None)
        assert produced == golden
    finally:
        FORECAST_GW2.write_bytes(original)
