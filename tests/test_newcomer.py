"""Coverage for engine/newcomer.py -- provisional rates for players with no
Premier League history."""

from __future__ import annotations

import pytest

from engine.config import LEAGUE_DISCOUNT
from engine.newcomer import (
    match_understat,
    newcomer_rates,
    normalize_name,
    price_curve,
    understat_index,
)


def established(pid, et, cost, xg90=0.0, xa90=0.0, dc90=0.0):
    return {
        "id": pid,
        "element_type": et,
        "now_cost": cost,
        "minutes": 900,  # established
        "expected_goals_per_90": xg90,
        "expected_assists_per_90": xa90,
        "defensive_contribution_per_90": dc90,
        "goals_conceded_per_90": 1.0,
        "saves_per_90": 0.0,
        "bonus": 5,
        "yellow_cards": 1,
    }


def test_normalize_name_strips_accents_and_case():
    assert normalize_name("Martin", "Ødegaard") == "martin odegaard"
    assert normalize_name("  Bruno   Fernandes ") == "bruno fernandes"


def test_understat_index_flattens_and_tags_league_season():
    idx = understat_index(
        {
            "Serie_A": {"2025": [{"name": "Player One", "xg": 5, "minutes": 2000}]},
            "La_liga": {"2024": [{"name": "Player One", "xg": 3, "minutes": 1000}]},
        }
    )
    recs = idx["player one"]
    assert {r["league"] for r in recs} == {"Serie_A", "La_liga"}
    assert {r["season"] for r in recs} == {"2025", "2024"}


def test_match_prefers_recent_season_then_minutes_and_needs_enough_minutes():
    idx = understat_index(
        {
            "Serie_A": {
                "2025": [{"name": "Sam Signing", "xg": 8, "xa": 4, "minutes": 2200}],
                "2024": [{"name": "Sam Signing", "xg": 12, "xa": 6, "minutes": 2800}],
            }
        }
    )
    el = {"first_name": "Sam", "second_name": "Signing", "web_name": "Signing"}
    match = match_understat(el, idx)
    assert match["season"] == "2025"  # recent wins even with fewer minutes

    thin = understat_index({"Ligue_1": {"2025": [{"name": "Sam Signing", "xg": 5, "minutes": 200}]}})
    assert match_understat(el, thin) is None  # below the minutes floor


def test_price_curve_returns_position_and_price_binned_means():
    elements = [
        established(1, 4, 60, xg90=0.6),
        established(2, 4, 60, xg90=0.4),
        established(3, 4, 45, xg90=0.1),
        established(4, 2, 50, dc90=8.0),
    ]
    curve = price_curve(elements)
    # £6.0m forwards average 0.5 xg90
    assert curve["bins"][(4, 6.0)]["xg90"] == pytest.approx(0.5)
    assert curve["position"][2]["dc90"] == pytest.approx(8.0)


def test_newcomer_rates_uses_discounted_cross_league_xg_when_matched():
    elements = [
        established(1, 3, 65, xg90=0.3, xa90=0.2, dc90=6.0),  # midfield price reference
        {
            "id": 99,
            "element_type": 3,
            "now_cost": 65,
            "first_name": "Nico",
            "second_name": "Newcomer",
            "web_name": "Newcomer",
        },
    ]
    idx = understat_index(
        {"Bundesliga": {"2025": [{"name": "Nico Newcomer", "xg": 10.0, "xa": 5.0, "minutes": 1800}]}}
    )
    rates = newcomer_rates(elements, {99}, idx, price_curve(elements))[99]

    per90 = 1800 / 90
    assert rates["xg90"] == pytest.approx(10.0 / per90 * LEAGUE_DISCOUNT["Bundesliga"])
    assert rates["xa90"] == pytest.approx(5.0 / per90 * LEAGUE_DISCOUNT["Bundesliga"])
    assert rates["dc90"] == pytest.approx(6.0)  # defensive rate still from the price prior
    assert rates["source"] == "understat:Bundesliga"


def test_newcomer_rates_falls_back_to_price_prior_without_a_match():
    elements = [
        established(1, 4, 50, xg90=0.25, xa90=0.05),
        {"id": 77, "element_type": 4, "now_cost": 50, "first_name": "Champ", "second_name": "Player", "web_name": "Player"},
    ]
    rates = newcomer_rates(elements, {77}, understat_index({}), price_curve(elements))[77]
    assert rates["xg90"] == pytest.approx(0.25)
    assert rates["source"] == "price"
