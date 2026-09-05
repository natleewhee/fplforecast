"""Regression coverage for the small-sample per-90 rate blow-up (the Mundle
bug): a one-minute cameo's FPL-extrapolated per-90 rate must not carry full
blend weight against a much larger, sane archive sample."""

from __future__ import annotations

from engine.features import _rate_features


def _established_mid(pid: int) -> dict:
    return {
        "id": pid,
        "element_type": 3,
        "minutes": 900,
        "expected_goals_per_90": 0.3,
        "expected_assists_per_90": 0.2,
        "defensive_contribution_per_90": 5.0,
        "goals_conceded_per_90": 0.0,
        "saves_per_90": 0.0,
        "bonus": 5,
        "yellow_cards": 1,
    }


def _cameo_player(pid: int, minutes: int, xg_per_90: float) -> dict:
    return {
        "id": pid,
        "element_type": 3,
        "minutes": minutes,
        "expected_goals_per_90": xg_per_90,
        "expected_assists_per_90": 0.0,
        "defensive_contribution_per_90": 0.0,
        "goals_conceded_per_90": 0.0,
        "saves_per_90": 0.0,
        "bonus": 0,
        "yellow_cards": 0,
    }


def _recent_payload(pid: int, minutes: int, expected_goals: float) -> dict:
    return {
        "elements": [
            {
                "id": pid,
                "stats": {
                    "minutes": minutes,
                    "expected_goals": expected_goals,
                    "expected_assists": 0.0,
                    "defensive_contribution": 0.0,
                    "goals_conceded": 0.0,
                    "saves": 0.0,
                    "bonus": 0,
                    "yellow_cards": 0,
                },
            },
            {
                "id": 2,
                "stats": {
                    "minutes": 90,
                    "expected_goals": 0.3,
                    "expected_assists": 0.2,
                    "defensive_contribution": 5.0,
                    "goals_conceded": 0.0,
                    "saves": 0.0,
                    "bonus": 1,
                    "yellow_cards": 0,
                },
            },
        ]
    }


def test_a_one_minute_cameo_does_not_swamp_a_sane_archive_rate():
    # A single involvement in one minute extrapolates to an absurd 15.3
    # xG/90 in both FPL's season-to-date field and this gameweek's live
    # stats; the player's real archive rate is a sane 0.19.
    players = [_cameo_player(547, minutes=1, xg_per_90=15.3), _established_mid(2)]
    archive_rates = {547: {"xg90": 0.19, "xa90": 0.05, "dc90": 3.0}}
    recent_payloads = [_recent_payload(547, minutes=1, expected_goals=0.17)]

    out = _rate_features(players, recent_payloads, archive_rates, {})

    # Should land close to the archive rate, nowhere near the season/recent
    # extrapolation or the RATE_CLAMP ceiling (1.4) it used to hit.
    assert out[547]["xg90"] < 0.5


def test_a_full_season_sample_is_unaffected_by_the_reliability_scaling():
    players = [_established_mid(1), _established_mid(2)]
    recent_payloads = [_recent_payload(1, minutes=90, expected_goals=0.3)]

    out = _rate_features(players, recent_payloads, {}, {})

    # An established player's own rate should stay close to their real 0.3
    # xg90, not get pulled toward some fraction of it by the new scaling.
    assert out[1]["xg90"] > 0.25
