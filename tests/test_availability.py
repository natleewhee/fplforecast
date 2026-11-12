"""engine.features.availability_multiplier / return_date: FPL's availability
signal applied up to the player's return, not just to the next gameweek."""

from __future__ import annotations

from datetime import date

from engine.config import UNKNOWN_RETURN_WEEKS
from engine.features import availability_multiplier, return_date

# Real deadlines from the 2026/27 bootstrap: GW11..GW14.
DEADLINES = ["2026-11-21T11:00:00Z", "2026-11-27T18:30:00Z", "2026-12-01T18:30:00Z", "2026-12-05T11:00:00Z"]


def _el(status, news="", added="2026-11-08T14:30:09Z", chance=0):
    return {"status": status, "news": news, "news_added": added, "chance_of_playing_next_round": chance}


def _weeks(el):
    return [availability_multiplier(el, w, d) for w, d in enumerate(DEADLINES)]


def test_dated_suspension_is_zero_until_the_return_date():
    thiago = _el("s", "Suspended until 5 Dec")
    assert return_date(thiago) == date(2026, 12, 5)
    # Out GW11-13 (deadlines before 5 Dec), back for GW14 (deadline on 5 Dec).
    assert _weeks(thiago) == [0.0, 0.0, 0.0, 1.0]


def test_dated_injury_uses_expected_back():
    el = _el("i", "Hamstring injury - Expected back 29 Nov")
    assert _weeks(el) == [0.0, 0.0, 1.0, 1.0]


def test_return_date_rolls_into_next_year():
    el = _el("i", "Knee injury - Expected back 3 Jan", added="2026-12-20T10:00:00Z")
    assert return_date(el) == date(2027, 1, 3)


def test_undated_injury_is_held_out_for_the_unknown_return_window():
    saka = _el("i", "Thigh injury - Unknown return date", added="2026-10-21T20:30:09Z")
    assert return_date(saka) is None
    out = [availability_multiplier(saka, w) for w in range(UNKNOWN_RETURN_WEEKS + 2)]
    assert out == [0.0] * UNKNOWN_RETURN_WEEKS + [1.0, 1.0]


def test_doubtful_is_discounted_next_week_only():
    el = _el("d", "Unspecified injury - 75% chance of playing", chance=75)
    assert _weeks(el) == [0.75, 1.0, 1.0, 1.0]


def test_player_who_left_is_zero_every_week():
    el = _el("u", "Has joined Juventus on loan for the rest of the season")
    assert _weeks(el) == [0.0] * 4


def test_fit_player_is_full_every_week():
    el = {"status": "a", "news": "", "chance_of_playing_next_round": None}
    assert _weeks(el) == [1.0] * 4
