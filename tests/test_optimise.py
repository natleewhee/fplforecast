"""Phase 1 coverage for the ILP squad optimiser (2026-09-05 transfer-scenarios
plan): known-optimal squads by inspection, agreement with the trusted
``best_xi`` oracle, budget/club-limit binding, hit-arithmetic boundary, and
``derive_free_transfers``."""

from __future__ import annotations

import json
import time
from pathlib import Path

import pytest

from engine.config import FT_MAX_BANKED, HIT_COST
from engine.optimise import derive_free_transfers, solve_squad
from engine.squad import best_xi

DATA_DIR = Path(__file__).resolve().parent.parent / "data"


def make_player(pid, elem_type, team, price, xp, sell=None, horizon=5):
    return {
        "id": pid,
        "elementType": elem_type,
        "team": team,
        "price": price,
        "sellPrice": sell if sell is not None else price,
        "perGameweek": [xp] * horizon,
        "total": xp * horizon,
        "webName": f"p{pid}",
    }


def _pool_with_known_optimal():
    """2 GKP / 5 DEF / 5 MID / 3 FWD, spread across enough clubs that the
    club limit never binds here, with a strictly best 15 by xP within a
    generous budget and a set of clearly-worse decoys."""
    players = []
    pid = 1
    # GKP: 2 good (different clubs) + 1 decoy.
    for team, price, xp in [("A", 5.0, 4.0), ("B", 5.0, 3.8), ("C", 4.5, 2.0)]:
        players.append(make_player(pid, 1, team, price, xp))
        pid += 1
    # DEF: 5 good + 2 decoys, spread across 5+ clubs.
    for team, price, xp in [
        ("D", 5.5, 4.5),
        ("E", 5.5, 4.4),
        ("F", 5.0, 4.3),
        ("G", 5.0, 4.2),
        ("H", 4.5, 4.1),
        ("I", 4.5, 1.5),
        ("J", 4.0, 1.2),
    ]:
        players.append(make_player(pid, 2, team, price, xp))
        pid += 1
    # MID: 5 good + 2 decoys.
    for team, price, xp in [
        ("K", 8.0, 6.5),
        ("L", 7.5, 6.2),
        ("M", 7.0, 6.0),
        ("N", 6.5, 5.8),
        ("O", 6.0, 5.5),
        ("P", 6.0, 2.0),
        ("Q", 5.5, 1.8),
    ]:
        players.append(make_player(pid, 3, team, price, xp))
        pid += 1
    # FWD: 3 good + 2 decoys.
    # R is a runaway standout (kept well clear of any hit-boundary test's
    # swap-in value) so it always stays captain regardless of which marginal
    # starter a hit-arithmetic test replaces.
    for team, price, xp in [
        ("R", 8.5, 20.0),
        ("S", 7.5, 6.0),
        ("T", 7.0, 5.7),
        ("U", 6.0, 2.5),
        ("V", 5.5, 2.0),
    ]:
        players.append(make_player(pid, 4, team, price, xp))
        pid += 1
    known_optimal = {1, 2, 4, 5, 6, 7, 8, 11, 12, 13, 14, 15, 18, 19, 20}
    return players, known_optimal


def test_solve_squad_finds_the_known_optimal_xi():
    # The objective only pays for the starting XI (+ captain), so bench slots
    # are filled by whatever's legal and cheapest -- the known-optimal check
    # is against the XI and captain, not the full 15 (verified by inspection:
    # 1 GKP + 3 DEF + 4 MID + 3 FWD is the top-value legal formation here).
    players, known_optimal = _pool_with_known_optimal()
    total_price = sum(p["price"] for p in players if p["id"] in known_optimal)
    result = solve_squad(
        players, held=[], bank=total_price + 10, free_transfers=0, horizon_gws=1, unlimited=True
    )
    assert result.feasible
    assert set(result.xi_by_gw[0]) == {1, 4, 5, 6, 11, 12, 13, 14, 18, 19, 20}
    assert result.captain_by_gw[0] == 18


def test_ilp_xi_and_captain_agree_with_best_xi_oracle():
    players, known_optimal = _pool_with_known_optimal()
    squad = [p for p in players if p["id"] in known_optimal]
    ids = [p["id"] for p in squad]
    total_price = sum(p["price"] for p in squad)

    result = solve_squad(
        squad, held=ids, bank=0.0, free_transfers=0, horizon_gws=1, unlimited=False
    )
    assert result.feasible
    assert set(result.squad_ids) == set(ids)

    oracle_squad = [
        {**p, "element_type": p["elementType"], "projected": p["perGameweek"][0]} for p in squad
    ]
    oracle_xi, _ = best_xi(oracle_squad)
    oracle_ids = {p["id"] for p in oracle_xi}
    oracle_captain = max(oracle_xi, key=lambda p: p["projected"])["id"]

    assert set(result.xi_by_gw[0]) == oracle_ids
    assert result.captain_by_gw[0] == oracle_captain


def test_budget_binds_excludes_unaffordable_player():
    players, known_optimal = _pool_with_known_optimal()
    # An outstanding forward, unaffordably expensive.
    players.append(make_player(999, 4, "Z", 20.0, 100.0))
    total_price = sum(p["price"] for p in players if p["id"] in known_optimal)
    result = solve_squad(
        players, held=[], bank=total_price, free_transfers=0, horizon_gws=1, unlimited=True
    )
    assert result.feasible
    assert 999 not in result.squad_ids


def test_club_limit_binds():
    players, _ = _pool_with_known_optimal()
    # Five elite midfielders all from the same club -- at most 3 may be picked.
    for i, xp in enumerate([9.0, 8.9, 8.8, 8.7, 8.6]):
        players.append(make_player(2000 + i, 3, "SAME", 9.0, xp))
    result = solve_squad(players, held=[], bank=500.0, free_transfers=0, horizon_gws=1, unlimited=True)
    assert result.feasible
    same_club_count = sum(1 for pid in result.squad_ids if pid >= 2000 and pid < 2005)
    assert same_club_count <= 3
    # Confirm the constraint actually bound (the elites are strictly the best MIDs).
    assert same_club_count == 3


def _hit_boundary_pool(gain_per_gw):
    """A fixed 15-man held squad plus one alternative for the marginal
    (lowest-projecting) *starting* MID, better by ``gain_per_gw`` -- so
    taking the swap changes the objective by exactly ``gain_per_gw``,
    letting the hit-cost boundary be tested precisely."""
    players, known_optimal = _pool_with_known_optimal()
    squad = [{**p, "perGameweek": p["perGameweek"][:1]} for p in players if p["id"] in known_optimal]
    ids = {p["id"] for p in squad}

    baseline = solve_squad(squad, held=list(ids), bank=0.0, free_transfers=0, horizon_gws=1)
    marginal_id = min(baseline.xi_by_gw[0], key=lambda pid: next(p for p in squad if p["id"] == pid)["perGameweek"][0])
    marginal = next(p for p in squad if p["id"] == marginal_id)
    alt = make_player(
        9999, marginal["elementType"], "ALT", marginal["price"], marginal["perGameweek"][0] + gain_per_gw, horizon=1
    )
    pool = squad + [alt]
    return pool, list(ids), marginal_id


def test_hit_rejected_when_gain_is_below_hit_cost():
    pool, held, _ = _hit_boundary_pool(gain_per_gw=3.0)
    result = solve_squad(pool, held=held, bank=0.0, free_transfers=0, horizon_gws=1)
    assert result.feasible
    assert result.hit_cost == 0
    assert 9999 not in result.squad_ids


def test_hit_rejected_at_exactly_hit_cost_boundary():
    pool, held, _ = _hit_boundary_pool(gain_per_gw=float(HIT_COST))
    result = solve_squad(pool, held=held, bank=0.0, free_transfers=0, horizon_gws=1)
    assert result.feasible
    # Net-neutral at exactly HIT_COST -- tie-break rejects (KD1: net-positive only).
    assert result.hit_cost == 0
    assert 9999 not in result.squad_ids


def test_hit_accepted_when_gain_clears_hit_cost():
    pool = [p for p in _hit_boundary_pool(gain_per_gw=0.0)[0] if p["id"] != 9999]
    held = _hit_boundary_pool(gain_per_gw=0.0)[1]
    baseline = solve_squad(pool, held=held, bank=0.0, free_transfers=0, horizon_gws=1)

    pool, held, _ = _hit_boundary_pool(gain_per_gw=float(HIT_COST) + 2.0)
    result = solve_squad(pool, held=held, bank=0.0, free_transfers=0, horizon_gws=1)
    assert result.feasible
    assert result.hit_cost == HIT_COST
    assert 9999 in result.squad_ids
    assert result.net_points > baseline.points - 0.01


def test_xi_extraction_is_eleven_distinct_players_per_gameweek():
    players, known_optimal = _pool_with_known_optimal()
    squad = [p for p in players if p["id"] in known_optimal]
    ids = [p["id"] for p in squad]
    result = solve_squad(squad, held=ids, bank=0.0, free_transfers=0, horizon_gws=3)
    assert result.feasible
    for gw_xi in result.xi_by_gw:
        assert len(gw_xi) == 11
        assert len(set(gw_xi)) == 11


def test_derive_free_transfers_floors_at_one():
    history = [{"event_transfers": 0}]  # GW1 only, target GW2 -> 1 elapsed
    value, derivation = derive_free_transfers(history, [], target_gw=1)
    assert value == 1
    assert "capped at" in derivation


def test_derive_free_transfers_caps_at_max_banked():
    history = [{"event_transfers": 0} for _ in range(20)]
    value, _ = derive_free_transfers(history, [], target_gw=25)
    assert value == FT_MAX_BANKED


def test_derive_free_transfers_subtracts_transfers_used():
    history = [{"event_transfers": 1}, {"event_transfers": 2}]
    value, _ = derive_free_transfers(history, [], target_gw=4)
    # 3 elapsed since GW1, minus 3 used -> floors at 1.
    assert value == 1


@pytest.mark.slow
def test_real_pool_fourteen_solve_set_completes_within_budget():
    forecast_path = DATA_DIR / "forecast" / "gw4.json"
    if not forecast_path.exists():
        pytest.skip("no real forecast data available")
    data = json.loads(forecast_path.read_text())
    pool = data["pool"]
    if not pool or "sellPrice" not in pool[0]:
        pytest.skip("forecast pool predates the sellPrice field (regenerate via compute_forecast)")
    squad_ids = [p["id"] for p in data["squad"]["players"]]
    bank = data["squad"]["bank"]

    start = time.monotonic()
    for horizon in (1, 3, 5):
        for k in range(4):
            solve_squad(pool, held=squad_ids, bank=bank, free_transfers=2, horizon_gws=horizon, max_transfers=k)
    solve_squad(pool, held=[], bank=100.1, free_transfers=0, horizon_gws=1, unlimited=True)
    solve_squad(pool, held=[], bank=100.1, free_transfers=0, horizon_gws=5, unlimited=True)
    elapsed = time.monotonic() - start
    assert elapsed < 60.0
