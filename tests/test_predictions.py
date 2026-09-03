"""U9 / U10 coverage: the pre-deadline prediction log and the post-gameweek
scoring pass (R14, R15, KD3, KTD7, KTD12; AE4)."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import pytest

import scripts.log_predictions as lp
import scripts.score_predictions as sp
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


def test_newcomer_has_a_model_prediction_but_no_baseline_one(wired, monkeypatch):
    monkeypatch.setattr(lp.cf, "load_bootstrap", lambda: _bootstrap(NOW + timedelta(hours=10)))

    lp.main(now=NOW)
    out = json.loads((wired / "predictions" / "gw7.json").read_text())
    assert out["model"]["999"] is not None  # provisional projection is still logged
    assert out["baseline"]["999"] is None  # the fixture-blind baseline can't project a newcomer


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


# --- U10: scoring pass ---------------------------------------------------------

ELEMENTS = [
    {"id": i, "element_type": 1 if i <= 4 else 2 if i <= 12 else 3 if i <= 22 else 4, "team": (i % 5) + 1}
    for i in range(1, 31)
]


def _score_bootstrap(data_checked_gws):
    return {
        "events": [
            {"id": gw, "data_checked": gw in data_checked_gws, "finished": True} for gw in range(1, 8)
        ],
        "elements": ELEMENTS,
    }


def _prediction_file(path, gw):
    # model rates low ids high, baseline rates high ids high -> different squads
    model = {str(e["id"]): float(30 - e["id"]) for e in ELEMENTS}
    baseline = {str(e["id"]): float(e["id"]) for e in ELEMENTS}
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"gameweek": gw, "model": model, "baseline": baseline}))


def _live(points_by_id):
    return {"elements": [{"id": i, "stats": {"total_points": p}} for i, p in points_by_id.items()]}


@pytest.fixture
def score_wired(monkeypatch, tmp_path):
    monkeypatch.setattr(sp, "DATA_DIR", tmp_path)
    return tmp_path


def test_scores_a_data_checked_gameweek_with_a_stored_prediction(score_wired, monkeypatch):
    monkeypatch.setattr(sp.cf, "load_bootstrap", lambda: _score_bootstrap({5}))
    _prediction_file(score_wired / "predictions" / "gw5.json", 5)
    live = _live({e["id"]: (2 if e["id"] % 2 else 6) for e in ELEMENTS})

    assert sp.main(fetch=lambda gw: live) == 0
    record = json.loads((score_wired / "record" / "running.json").read_text())
    gw5 = next(e for e in record["entries"] if e["gameweek"] == 5)
    assert {"modelPoints", "baselinePoints", "delta"} <= set(gw5)
    assert record["summary"]["gameweeksScored"] == 1


def test_data_checked_false_gameweek_is_not_scored(score_wired, monkeypatch):
    monkeypatch.setattr(sp.cf, "load_bootstrap", lambda: _score_bootstrap(set()))  # none checked

    assert sp.main(fetch=lambda gw: _live({})) == 0
    record = json.loads((score_wired / "record" / "running.json").read_text())
    assert record["entries"] == []
    assert record["summary"]["gameweeksScored"] == 0


def test_missing_prediction_is_recorded_as_no_prediction(score_wired, monkeypatch):
    monkeypatch.setattr(sp.cf, "load_bootstrap", lambda: _score_bootstrap({6}))  # no gw6.json

    assert sp.main(fetch=lambda gw: _live({})) == 0
    record = json.loads((score_wired / "record" / "running.json").read_text())
    assert record["entries"] == [{"gameweek": 6, "status": "no_prediction"}]
    assert record["summary"]["gameweeksScored"] == 0  # not counted


def test_summary_meaningful_flag_tracks_the_threshold():
    over = sp.summarise([{"gameweek": 1, "modelPoints": 50.0, "baselinePoints": 49.65}])
    under = sp.summarise([{"gameweek": 1, "modelPoints": 50.0, "baselinePoints": 49.8}])
    assert over["pooledDeltaPerGw"] == pytest.approx(0.35) and over["meaningful"] is True
    assert under["pooledDeltaPerGw"] == pytest.approx(0.2) and under["meaningful"] is False


def test_scoring_pass_is_idempotent(score_wired, monkeypatch):
    monkeypatch.setattr(sp.cf, "load_bootstrap", lambda: _score_bootstrap({5}))
    _prediction_file(score_wired / "predictions" / "gw5.json", 5)
    live = _live({e["id"]: e["id"] % 4 for e in ELEMENTS})

    assert sp.main(fetch=lambda gw: live) == 0
    first = (score_wired / "record" / "running.json").read_bytes()
    assert sp.main(fetch=lambda gw: live) == 0
    assert (score_wired / "record" / "running.json").read_bytes() == first


# --- UA1: per-player residuals for the safety-score band -----------------------


def test_scoring_a_gameweek_appends_residuals_by_position(score_wired, monkeypatch):
    monkeypatch.setattr(sp.cf, "load_bootstrap", lambda: _score_bootstrap({5}))
    _prediction_file(score_wired / "predictions" / "gw5.json", 5)  # model[id] = 30 - id
    # element 1 is a GKP (element_type 1), element 5 is a DEF (element_type 2).
    live = _live({1: 12, 5: 20})

    assert sp.main(fetch=lambda gw: live) == 0
    residuals = json.loads((score_wired / "record" / "residuals.json").read_text())
    assert residuals["gameweeksIncluded"] == [5]
    assert residuals["byPosition"]["1"] == [pytest.approx(12 - 29.0)]  # actual - projected
    assert residuals["byPosition"]["2"] == [pytest.approx(20 - 25.0)]
    assert residuals["byPosition"]["3"] == []
    assert residuals["byPosition"]["4"] == []


def test_rescoring_an_already_included_gameweek_does_not_duplicate_residuals(score_wired, monkeypatch):
    monkeypatch.setattr(sp.cf, "load_bootstrap", lambda: _score_bootstrap({5}))
    _prediction_file(score_wired / "predictions" / "gw5.json", 5)
    live = _live({1: 12})

    assert sp.main(fetch=lambda gw: live) == 0
    first = (score_wired / "record" / "residuals.json").read_bytes()
    assert sp.main(fetch=lambda gw: live) == 0
    assert (score_wired / "record" / "residuals.json").read_bytes() == first


def test_a_player_absent_from_live_actuals_is_skipped(score_wired, monkeypatch):
    monkeypatch.setattr(sp.cf, "load_bootstrap", lambda: _score_bootstrap({5}))
    _prediction_file(score_wired / "predictions" / "gw5.json", 5)
    live = _live({})  # no elements at all -- a blank gameweek

    assert sp.main(fetch=lambda gw: live) == 0
    residuals = json.loads((score_wired / "record" / "residuals.json").read_text())
    assert residuals["byPosition"] == {"1": [], "2": [], "3": [], "4": []}
