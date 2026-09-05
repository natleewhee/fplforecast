"""Coverage for api/solve.py's pure ``solve(body)`` request handler -- the
live "force keep / force remove a player" endpoint. Runs against the
real committed data/forecast/gw4.json pool, same as
test_optimise.py::test_real_pool_fourteen_solve_set_completes_within_budget.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from api.solve import solve

DATA_DIR = Path(__file__).resolve().parent.parent / "data"


def _forecast_gw() -> int:
    forecast_path = DATA_DIR / "forecast" / "gw4.json"
    if not forecast_path.exists():
        pytest.skip("no real forecast data available")
    return json.loads(forecast_path.read_text())["targetGameweek"]


def test_solve_transfer_scenario_returns_a_scenario_shaped_payload():
    status, payload = solve({"forecastGw": _forecast_gw(), "type": "transfer", "horizon": 1})
    assert status == 200
    assert "squad" in payload and "netPoints" in payload and "weeks" in payload
    assert len(payload["squad"]) == 15


def test_force_in_pins_a_specific_player():
    gw = _forecast_gw()
    data = json.loads((DATA_DIR / "forecast" / "gw4.json").read_text())
    # A cheap available pool player who's not already in the squad.
    squad_ids = {p["id"] for p in data["squad"]["players"]}
    candidate = next(p for p in data["pool"] if p["id"] not in squad_ids)

    status, payload = solve(
        {"forecastGw": gw, "type": "transfer", "horizon": 1, "forceIn": [candidate["id"]]}
    )
    assert status == 200
    assert candidate["id"] in payload["squad"]


def test_force_out_drops_a_specific_held_player():
    gw = _forecast_gw()
    data = json.loads((DATA_DIR / "forecast" / "gw4.json").read_text())
    held_id = data["squad"]["players"][0]["id"]

    status, payload = solve(
        {"forecastGw": gw, "type": "transfer", "horizon": 1, "forceOut": [held_id]}
    )
    assert status == 200
    assert held_id not in payload["squad"]


def test_forcing_the_same_player_in_and_out_is_rejected():
    status, payload = solve(
        {"forecastGw": _forecast_gw(), "type": "transfer", "horizon": 1, "forceIn": [1], "forceOut": [1]}
    )
    assert status == 400
    assert "error" in payload


def test_free_hit_type_ignores_a_non_1_horizon():
    status, payload = solve({"forecastGw": _forecast_gw(), "type": "freeHit", "horizon": 5})
    assert status == 200
    assert payload["horizonGws"] == 1


def test_invalid_horizon_is_rejected():
    status, payload = solve({"forecastGw": _forecast_gw(), "type": "transfer", "horizon": 2})
    assert status == 400


def test_unknown_forecast_gw_is_a_404():
    status, payload = solve({"forecastGw": 999, "type": "transfer", "horizon": 1})
    assert status == 404


def test_too_many_forced_players_is_rejected():
    status, payload = solve(
        {
            "forecastGw": _forecast_gw(),
            "type": "wildcard",
            "horizon": 1,
            "forceIn": list(range(1, 10)),
            "forceOut": list(range(100, 108)),
        }
    )
    assert status == 400
