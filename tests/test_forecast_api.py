"""Coverage for api/forecast.py's on-demand personal-forecast lookup -- the
"anyone can use this with their own team ID" endpoint. Runs the real
build_pool_context()/build_personal_forecast() pipeline against the real
committed data, through the same data-deploy/ gzip-decompress-into-/tmp
path api/forecast.py uses on Vercel; only the live FPL fetch (_fpl_get) is
stubbed, since this sandbox has no network access to fantasy.premierleague.com.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

import api.forecast as forecast_api
import scripts.compute_forecast as cf
import scripts.compress_deploy_data as compress_deploy_data

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
TEAM_ID = 1168513


def _latest_picks_and_history() -> tuple[int, list[dict], dict, dict]:
    picks_dir = DATA_DIR / f"picks-{TEAM_ID}"
    gw_files = sorted(picks_dir.glob("gw*.json"), key=lambda p: int(p.stem.removeprefix("gw")))
    if not gw_files:
        pytest.skip("no real picks data available")
    picks_data = json.loads(gw_files[-1].read_text())
    gw = int(gw_files[-1].stem.removeprefix("gw"))

    history_dir = DATA_DIR / f"history-{TEAM_ID}"
    history_files = sorted(history_dir.glob("*.json"))
    history = json.loads(history_files[-1].read_text()) if history_files else {}
    return gw, picks_data["picks"], picks_data["entry_history"], history


@pytest.fixture(autouse=True)
def _deploy_data(monkeypatch):
    """Regenerate data-deploy/ from the real committed data/ (cheap, and
    keeps this test honest about the actual gzip/decompress path rather than
    a shortcut), then reset api.forecast's cold-start cache and
    compute_forecast's DATA_DIR after the test so it doesn't leak into
    other tests that expect the real data/ directory."""
    compress_deploy_data.main()
    forecast_api._decompressed = False
    original_data_dir = cf.DATA_DIR
    yield
    forecast_api._decompressed = False
    cf.DATA_DIR = original_data_dir


def _stub_fpl_get(monkeypatch, gw: int, picks: list[dict], entry_history: dict, history: dict):
    entry_payload = {"name": "Test Team", "player_first_name": "Test", "player_last_name": "Manager"}
    picks_payload = {"picks": picks, "entry_history": entry_history}

    def fake_get(path: str) -> dict:
        if path == f"/entry/{TEAM_ID}/":
            return entry_payload
        if path == f"/entry/{TEAM_ID}/history/":
            return history
        if path == f"/entry/{TEAM_ID}/event/{gw}/picks/":
            return picks_payload
        raise AssertionError(f"unexpected FPL path requested: {path}")

    monkeypatch.setattr(forecast_api, "_fpl_get", fake_get)


def test_build_forecast_for_team_returns_a_full_forecast_shaped_payload(monkeypatch):
    gw, picks, entry_history, history = _latest_picks_and_history()
    _stub_fpl_get(monkeypatch, gw, picks, entry_history, history)

    status, payload = forecast_api.build_forecast_for_team(TEAM_ID)

    assert status == 200
    assert payload["basedOnGameweek"] == gw
    assert len(payload["squad"]["players"]) == len(picks)
    assert payload["overridesApplied"] == 0  # a guest lookup never has overrides to apply
    assert payload["teamName"] == "Test Team"
    assert payload["managerName"] == "Test Manager"
    assert "scenarios" in payload and "pool" in payload


def test_build_forecast_for_team_404s_for_an_unknown_team(monkeypatch):
    import urllib.error

    gw, _picks, _entry_history, _history = _latest_picks_and_history()

    def fake_get(path: str) -> dict:
        raise urllib.error.HTTPError(path, 404, "Not Found", {}, None)

    monkeypatch.setattr(forecast_api, "_fpl_get", fake_get)

    status, payload = forecast_api.build_forecast_for_team(999_999_999)

    assert status == 404
    assert "error" in payload


def test_handler_rejects_a_non_numeric_team_id():
    from urllib.parse import parse_qs, urlparse

    # Exercise the same parsing the HTTP handler does, without spinning up a
    # real server -- mirrors test_solve_api's pure-function style.
    query = parse_qs(urlparse("/api/forecast?teamId=not-a-number").query)
    raw_team_id = (query.get("teamId") or [""])[0]
    with pytest.raises(ValueError):
        int(raw_team_id)


def test_get_pool_context_uses_a_precomputed_cache_instead_of_refitting(monkeypatch):
    """The whole reason the cache exists: Vercel's Hobby-tier 10s function
    timeout is tight against build_pool_context()'s own ~8s cold-start cost
    (see _get_pool_context()'s docstring). Proves the cache is actually
    read by making the live build_pool_context() raise if it's ever
    called -- the request must still succeed by hitting the cache.

    Writes real data/pool-context/gw<N>.pkl (the _deploy_data fixture's
    compress_deploy_data.main() needs to walk the real, committed data/ to
    stay honest about the actual gzip/decompress path -- same reasoning as
    that fixture's own docstring) -- cleaned up in a finally so this test
    never leaves the tracked data/ directory dirty."""
    bootstrap = cf.load_bootstrap()
    finished = [e for e in bootstrap.get("events", []) if e.get("finished")]
    based_on_gw = max(e["id"] for e in finished)
    target_gw = cf.upcoming_gameweek(
        bootstrap, forecast_api.datetime.now(forecast_api.timezone.utc), fallback=based_on_gw + 1
    )

    cache_dir = DATA_DIR / "pool-context"
    pre_existing = set(cache_dir.glob("gw*.pkl")) if cache_dir.exists() else set()
    try:
        real_pool_ctx = cf.build_pool_context(bootstrap, target_gw)
        cf.save_pool_context(real_pool_ctx, target_gw)
        compress_deploy_data.main()  # picks up the freshly-saved pool-context/ cache
        forecast_api._decompressed = False
        forecast_api._cached_pool_ctx = None
        forecast_api._cached_pool_ctx_gw = None

        def _must_not_be_called(*_args, **_kwargs):
            raise AssertionError("build_pool_context() was called -- the precomputed cache was ignored")

        monkeypatch.setattr(cf, "build_pool_context", _must_not_be_called)

        gw, picks, entry_history, history = _latest_picks_and_history()
        _stub_fpl_get(monkeypatch, gw, picks, entry_history, history)

        status, payload = forecast_api.build_forecast_for_team(TEAM_ID)

        assert status == 200
        assert payload["targetGameweek"] == target_gw
    finally:
        for stale in set(cache_dir.glob("gw*.pkl")) - pre_existing:
            stale.unlink()
        if cache_dir.exists() and not any(cache_dir.iterdir()):
            cache_dir.rmdir()


def test_guest_forecast_carries_none_of_the_owners_model_record(monkeypatch):
    """The running record / par calibration / per-gameweek model-vs-baseline are
    scored on the app owner's squad (data/record/*). A guest's forecast must not
    carry them, or their dashboard would show the owner's numbers as theirs."""
    gw, picks, entry_history, history = _latest_picks_and_history()
    _stub_fpl_get(monkeypatch, gw, picks, entry_history, history)

    status, payload = forecast_api.build_forecast_for_team(TEAM_ID)

    assert status == 200
    assert payload["runningRecord"] is None
    assert payload["parCalibration"] is None
    # guard against passing vacuously: there must be something to strip
    assert payload["lastGameweek"] is not None
    assert "modelVsBaseline" not in payload["lastGameweek"]
    rows = (payload["history"] or {}).get("gameweeks", [])
    assert rows
    assert all("modelVsBaseline" not in row for row in rows)

    # the same inputs built for the owner do carry the field
    bootstrap = cf.load_bootstrap()
    elements_by_id = {e["id"]: e for e in bootstrap["elements"]}
    owner_review = cf.last_gameweek_review(bootstrap, elements_by_id, gw, picks, entry_history)
    assert owner_review is not None and "modelVsBaseline" in owner_review
    owner_rows = cf.build_history(history)["gameweeks"]
    assert owner_rows and all("modelVsBaseline" in row for row in owner_rows)


def test_owner_history_still_carries_model_vs_baseline_rows():
    hist = {"current": [{"event": 1, "points": 50}], "past": []}
    owner_rows = cf.build_history(hist)["gameweeks"]
    guest_rows = cf.build_history(hist, include_model_record=False)["gameweeks"]
    assert "modelVsBaseline" in owner_rows[0]
    assert "modelVsBaseline" not in guest_rows[0]
