"""scripts/snapshot.py: a finished gameweek's live points are re-fetched until
FPL data-checks it, then frozen."""

from __future__ import annotations

import json

import scripts.snapshot as snap


def _setup(tmp_path, monkeypatch, points):
    calls = []

    def fake_fetch(url):
        calls.append(url)
        return {"elements": [{"id": 1, "stats": {"total_points": points[0]}}]}

    monkeypatch.setattr(snap, "DATA_DIR", tmp_path)
    monkeypatch.setattr(snap, "fetch", fake_fetch)
    return calls


def _boot(checked):
    return {"events": [{"id": 3, "finished": True, "data_checked": checked}]}


def _saved(tmp_path):
    return json.loads((tmp_path / "event-live" / "gw3.json").read_text())


def test_unchecked_gameweek_is_refetched_until_checked_then_frozen(tmp_path, monkeypatch):
    points = [5]
    calls = _setup(tmp_path, monkeypatch, points)

    snap.snapshot_event_live_history(_boot(False))
    assert _saved(tmp_path)["elements"][0]["stats"]["total_points"] == 5
    assert not _saved(tmp_path).get(snap.FROZEN_KEY)

    points[0] = 7  # bonus added after "finished"
    snap.snapshot_event_live_history(_boot(False))
    assert _saved(tmp_path)["elements"][0]["stats"]["total_points"] == 7

    points[0] = 8
    snap.snapshot_event_live_history(_boot(True))
    assert _saved(tmp_path)["elements"][0]["stats"]["total_points"] == 8
    assert _saved(tmp_path)[snap.FROZEN_KEY] is True

    points[0] = 99
    snap.snapshot_event_live_history(_boot(True))
    assert _saved(tmp_path)["elements"][0]["stats"]["total_points"] == 8
    assert len(calls) == 3


def test_file_from_before_the_freeze_rule_is_refetched_once(tmp_path, monkeypatch):
    calls = _setup(tmp_path, monkeypatch, [4])
    out = tmp_path / "event-live" / "gw3.json"
    out.parent.mkdir(parents=True)
    out.write_text(json.dumps({"elements": [{"id": 1, "stats": {"total_points": 2}}]}))
    snap.snapshot_event_live_history(_boot(True))
    snap.snapshot_event_live_history(_boot(True))
    assert len(calls) == 1
    assert _saved(tmp_path)["elements"][0]["stats"]["total_points"] == 4


def test_a_failed_refresh_keeps_the_copy_we_have(tmp_path, monkeypatch):
    _setup(tmp_path, monkeypatch, [5])
    snap.snapshot_event_live_history(_boot(False))  # provisional copy on disk

    def broken(url):
        raise OSError("FPL is down")

    monkeypatch.setattr(snap, "fetch", broken)
    snap.snapshot_event_live_history(_boot(False))  # must not raise
    assert _saved(tmp_path)["elements"][0]["stats"]["total_points"] == 5

    monkeypatch.setattr(snap, "fetch", lambda url: {"elements": []})
    snap.snapshot_event_live_history(_boot(True))  # empty reply: keep, don't freeze
    assert not _saved(tmp_path).get(snap.FROZEN_KEY)


def test_a_first_fetch_that_fails_still_fails_loudly(tmp_path, monkeypatch):
    _setup(tmp_path, monkeypatch, [5])
    monkeypatch.setattr(snap, "fetch", lambda url: {"elements": []})
    import pytest

    with pytest.raises(RuntimeError):
        snap.snapshot_event_live_history(_boot(True))


def test_live_picks_are_saved_for_the_week_in_play_and_cleared_after(tmp_path, monkeypatch):
    monkeypatch.setattr(snap, "DATA_DIR", tmp_path)
    monkeypatch.setattr(snap, "TEAM_ID", "42")
    monkeypatch.setattr(snap, "fetch", lambda url: {"picks": [{"element": 1}], "url": url})
    boot = {"events": [{"id": 10, "is_current": False, "finished": True}, {"id": 11, "is_current": True, "finished": False}]}
    snap.snapshot_live_picks(boot)
    live = tmp_path / "picks-42" / "live" / "gw11.json"
    assert json.loads(live.read_text())["url"].endswith("/entry/42/event/11/picks/")
    boot["events"][1]["finished"] = True
    snap.snapshot_live_picks(boot)
    assert not live.exists()


def test_a_live_picks_timeout_or_bad_reply_is_not_fatal(tmp_path, monkeypatch):
    """It runs every night mid-gameweek; a timeout must not fail the snapshot
    (which would skip the day's commit)."""
    monkeypatch.setattr(snap, "DATA_DIR", tmp_path)
    monkeypatch.setattr(snap, "TEAM_ID", "42")
    boot = {"events": [{"id": 11, "is_current": True, "finished": False}]}
    for exc in (TimeoutError("read timed out"), json.JSONDecodeError("x", "", 0)):
        def boom(url, exc=exc):
            raise exc
        monkeypatch.setattr(snap, "fetch", boom)
        snap.snapshot_live_picks(boot)  # must not raise
