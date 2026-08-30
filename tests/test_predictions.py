"""U9 / U10 coverage: the pre-deadline prediction log and the post-gameweek
scoring pass (R14, R15, KD3, KTD7, KTD12; AE4)."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import pytest

import scripts.log_predictions as lp
from engine.history import ColdStart, HasHistory

NOW = datetime(2026, 9, 1, 12, 0, tzinfo=timezone.utc)


def _bootstrap(deadline: datetime, finished_upto: int = 6):
    events = [{"id": i, "finished": i <= finished_upto, "deadline_time": "2026-08-01T00:00:00Z"} for i in range(1, 7)]
    events.append({"id": 7, "finished": False, "deadline_time": deadline.isoformat().replace("+00:00", "Z")})
    return {
        "events": events,
        "elements": [
            {"id": 1, "element_type": 3, "team": 1, "web_name": "A", "now_cost": 50, "status": "a"},
            {"id": 2, "element_type": 4, "team": 2, "web_name": "B", "now_cost": 70, "status": "a"},
            {"id": 999, "element_type": 3, "team": 1, "web_name": "New", "now_cost": 45, "status": "a"},
        ],
        "teams": [{"id": 1, "short_name": "ARS"}, {"id": 2, "short_name": "CHE"}],
    }


@pytest.fixture
def wired(monkeypatch, tmp_path):
    """Point the script at empty loaders + a tmp data dir; players 1 & 2 have
    history, 999 is cold-start."""
    monkeypatch.setattr(lp, "DATA_DIR", tmp_path)
    monkeypatch.setattr(lp.cf, "load_event_live_history", lambda: [])
    monkeypatch.setattr(lp.cf, "load_entity_resolution", lambda: {})
    monkeypatch.setattr(lp.cf, "load_fixtures", lambda: [])
    monkeypatch.setattr(lp.cf, "load_minutes_model", lambda: {})
    monkeypatch.setattr(lp.cf, "load_team_strength_seasons", lambda: {})
    monkeypatch.setattr(lp, "load_history", lambda _d: type("A", (), {"frame": None})())
    monkeypatch.setattr(
        lp,
        "classify",
        lambda pid, *a, **k: ColdStart() if pid == 999 else HasHistory(rows=5),
    )
    return tmp_path


def test_writes_when_the_deadline_is_inside_the_window(wired, monkeypatch):
    monkeypatch.setattr(lp.cf, "load_bootstrap", lambda: _bootstrap(NOW + timedelta(hours=30)))

    assert lp.main(now=NOW) == 0
    out = json.loads((wired / "predictions" / "gw7.json").read_text())
    assert out["gameweek"] == 7
    assert set(out["model"]) == {"1", "2", "999"}
    assert out["model"]["1"] is not None and out["baseline"]["2"] is not None


def test_no_write_when_the_deadline_is_far_away(wired, monkeypatch):
    monkeypatch.setattr(lp.cf, "load_bootstrap", lambda: _bootstrap(NOW + timedelta(days=5)))

    assert lp.main(now=NOW) == 0
    assert not (wired / "predictions" / "gw7.json").exists()


def test_no_write_when_the_deadline_has_passed(wired, monkeypatch):
    # AE4: a gameweek whose deadline is gone can no longer be predicted.
    monkeypatch.setattr(lp.cf, "load_bootstrap", lambda: _bootstrap(NOW - timedelta(hours=2)))

    assert lp.main(now=NOW) == 0
    assert not (wired / "predictions" / "gw7.json").exists()


def test_cold_start_player_is_null_in_both_maps(wired, monkeypatch):
    monkeypatch.setattr(lp.cf, "load_bootstrap", lambda: _bootstrap(NOW + timedelta(hours=10)))

    lp.main(now=NOW)
    out = json.loads((wired / "predictions" / "gw7.json").read_text())
    assert out["model"]["999"] is None
    assert out["baseline"]["999"] is None


def test_second_run_in_the_window_is_a_no_op(wired, monkeypatch):
    monkeypatch.setattr(lp.cf, "load_bootstrap", lambda: _bootstrap(NOW + timedelta(hours=20)))
    assert lp.main(now=NOW) == 0

    path = wired / "predictions" / "gw7.json"
    frozen = path.read_bytes()
    path.write_bytes(frozen[:-1] + b' ')  # tamper, then re-run
    tampered = path.read_bytes()
    assert lp.main(now=NOW + timedelta(hours=1)) == 0
    assert path.read_bytes() == tampered  # untouched


def test_season_over_is_a_clean_exit(wired, monkeypatch):
    boot = _bootstrap(NOW + timedelta(hours=10))
    for e in boot["events"]:
        e["finished"] = True
    monkeypatch.setattr(lp.cf, "load_bootstrap", lambda: boot)

    assert lp.main(now=NOW) == 0
    assert not (wired / "predictions").exists()
