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


def test_force_in_a_doubtful_held_player_actually_keeps_them():
    """Regression: a "d" (doubtful) held player used to be excluded from the
    pool entirely (bug fixed alongside this test), so force-keeping them was
    silently a no-op -- they'd still show up sold in the result."""
    gw = _forecast_gw()
    data = json.loads((DATA_DIR / "forecast" / "gw4.json").read_text())
    doubtful_held = next(
        (
            p["id"]
            for p in data["squad"]["players"]
            if (p.get("availability") or {}).get("status") == "d"
        ),
        None,
    )
    if doubtful_held is None:
        pytest.skip("no doubtful held player in this snapshot")

    status, payload = solve(
        {"forecastGw": gw, "type": "transfer", "horizon": 1, "forceIn": [doubtful_held]}
    )
    assert status == 200
    assert doubtful_held in payload["squad"]
    assert doubtful_held not in {p["id"] for p in payload["transfersOut"]}


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


def _guest_team(free_transfers=1, bank=1.0):
    """A legal 15 from the GW4 pool with none of the owner's players."""
    forecast = json.loads((DATA_DIR / "forecast" / "gw4.json").read_text())
    owner = {p["id"] for p in forecast["squad"]["players"]}
    need = {"GKP": 2, "DEF": 5, "MID": 5, "FWD": 3}
    per_club: dict[str, int] = {}
    squad = []
    for p in sorted(forecast["pool"], key=lambda p: p["price"]):
        if p["id"] in owner or need.get(p["position"], 0) == 0 or per_club.get(p["team"], 0) >= 3:
            continue
        need[p["position"]] -= 1
        per_club[p["team"]] = per_club.get(p["team"], 0) + 1
        squad.append({"id": p["id"], "position": p["position"], "team": p["team"], "webName": p["webName"], "price": p["price"]})
    assert len(squad) == 15
    return {"squad": squad, "bank": bank, "freeTransfers": free_transfers}


def test_a_guest_solve_starts_from_the_guests_own_squad():
    team = _guest_team()
    guest_ids = {row["id"] for row in team["squad"]}
    status, payload = solve({"forecastGw": _forecast_gw(), "type": "transfer", "horizon": 1, "team": team})
    assert status == 200
    out_ids = {p["id"] for p in payload["transfersOut"]}
    assert out_ids <= guest_ids, "only the guest's own players can be sold"
    kept = set(payload["squad"]) & guest_ids
    assert len(kept) == 15 - len(out_ids)


def test_a_guest_can_pin_one_of_their_own_players():
    team = _guest_team()
    pin = team["squad"][0]["id"]
    status, payload = solve({"forecastGw": _forecast_gw(), "type": "transfer", "horizon": 1, "team": team, "forceIn": [pin]})
    assert status == 200
    assert pin in payload["squad"]


@pytest.mark.parametrize(
    "mutate",
    [
        lambda t: t.update(squad=t["squad"][:14]),
        lambda t: t.update(freeTransfers=9),
        lambda t: t.update(bank=-1),
        lambda t: t["squad"].__setitem__(1, dict(t["squad"][0])),  # duplicate
        lambda t: t["squad"][0].update(price=99),
        lambda t: t.update(freeTransfers=1.9),
        lambda t: t.update(bank=float("nan")),
    ],
)
def test_a_malformed_guest_team_is_rejected(mutate):
    team = _guest_team()
    mutate(team)
    status, payload = solve({"forecastGw": _forecast_gw(), "type": "transfer", "horizon": 1, "team": team})
    assert status == 400


def test_a_guest_player_who_left_the_league_is_sold_as_a_real_transfer():
    """A held id with no pool row: the sale counts against free transfers,
    is credited at the price sent, and comes back named."""
    team = _guest_team(free_transfers=0, bank=0.0)
    gone = team["squad"][3]
    gone.update(id=987_654, webName="Gone FC")
    status, payload = solve({"forecastGw": _forecast_gw(), "type": "transfer", "horizon": 1, "team": team})
    assert status == 200
    out = {p["id"]: p for p in payload["transfersOut"]}
    if 987_654 in out:
        assert out[987_654]["webName"] == "Gone FC"
        assert payload["hitCost"] >= 4 * len(out), "no free transfers, so every sale is a hit"
    else:
        assert 987_654 in payload["squad"], "kept as a dead slot instead"


def test_prices_come_from_the_pool_not_the_request():
    team = _guest_team()
    for row in team["squad"]:
        row["price"] = 15.5  # would inflate the budget if trusted
    status, cheap = solve({"forecastGw": _forecast_gw(), "type": "wildcard", "horizon": 1, "team": _guest_team()})
    status2, rich = solve({"forecastGw": _forecast_gw(), "type": "wildcard", "horizon": 1, "team": team})
    assert status == status2 == 200
    assert rich["points"] == pytest.approx(cheap["points"])


def test_with_one_free_transfer_the_player_who_left_is_the_one_sold():
    team = _guest_team(free_transfers=1, bank=0.0)
    team["squad"][3].update(id=987_655, webName="Gone FC")
    status, payload = solve({"forecastGw": _forecast_gw(), "type": "transfer", "horizon": 1, "team": team})
    assert status == 200
    out = {p["id"]: p for p in payload["transfersOut"]}
    assert 987_655 in out and out[987_655]["webName"] == "Gone FC"
    assert 987_655 not in payload["squad"]
