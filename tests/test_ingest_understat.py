"""Coverage for the Understat cross-league ingest (mocked; no network)."""

from __future__ import annotations

import json
from datetime import date

import pytest

import scripts.ingest_understat as iu

SAMPLE = [
    {
        "player_name": "Florian Wirtz",
        "team_title": "Bayer Leverkusen",
        "position": "M S",
        "games": "31",
        "time": "2450",
        "goals": "10",
        "assists": "12",
        "xG": "7.4",
        "xA": "10.1",
        "npxG": "6.2",
        "shots": "70",
        "key_passes": "90",
    },
    {"player_name": "No Stats", "team_title": "X", "position": "D", "time": None, "xG": "bad"},
]


def test_understat_seasons_labels_by_start_year():
    assert iu.understat_seasons(date(2026, 8, 30)) == ["2026", "2025"]
    assert iu.understat_seasons(date(2026, 3, 1)) == ["2025", "2024"]  # spring -> last season


def test_normalise_parses_numbers_and_keeps_identity():
    rows = iu.normalise(SAMPLE)
    assert rows[0]["name"] == "Florian Wirtz"
    assert rows[0]["minutes"] == 2450.0 and rows[0]["xg"] == 7.4 and rows[0]["xa"] == 10.1
    assert rows[1]["minutes"] == 0.0 and rows[1]["xg"] == 0.0  # missing / unparseable -> 0


def test_write_creates_the_league_season_file(tmp_path, monkeypatch):
    monkeypatch.setattr(iu, "UNDERSTAT_DIR", tmp_path)
    path = iu.write("Bundesliga", "2024", iu.normalise(SAMPLE))
    data = json.loads(path.read_text())
    assert data["league"] == "Bundesliga" and data["season"] == "2024"
    assert data["players"][0]["name"] == "Florian Wirtz"


def test_main_writes_every_league_and_season_and_skips_failures(tmp_path, monkeypatch):
    monkeypatch.setattr(iu, "UNDERSTAT_DIR", tmp_path)
    monkeypatch.setattr(iu, "UNDERSTAT_LEAGUES", ["EPL", "La_liga"])

    def fake_fetch(league, season):
        if league == "La_liga":
            raise ValueError("boom")
        return SAMPLE

    monkeypatch.setattr(iu, "fetch_players", fake_fetch)
    assert iu.main(seasons=["2025", "2024"], sleep=lambda _s: None) == 0

    assert (tmp_path / "EPL" / "2025.json").exists()
    assert (tmp_path / "EPL" / "2024.json").exists()
    assert not (tmp_path / "La_liga").exists()


def test_main_returns_1_when_nothing_ingested(tmp_path, monkeypatch):
    monkeypatch.setattr(iu, "UNDERSTAT_DIR", tmp_path)
    monkeypatch.setattr(iu, "UNDERSTAT_LEAGUES", ["EPL"])
    monkeypatch.setattr(iu, "fetch_players", lambda *_a: (_ for _ in ()).throw(ValueError("down")))
    assert iu.main(seasons=["2025"], sleep=lambda _s: None) == 1
