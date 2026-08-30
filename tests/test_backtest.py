"""U11 coverage: backtest replay, select_squad, and the kickoff-time leakage
guard (R16, R17, KD9, KTD6, KTD12; AE2)."""

from __future__ import annotations

import json

import pandas as pd
import pytest

import scripts.backtest as bt_script
from engine.backtest import _frame_before, replay, select_squad
from engine.config import MEANINGFUL_EDGE_PER_GW


def proj(pid, et, team, points):
    return {"id": pid, "element_type": et, "team": team, "points": points}


def test_select_squad_respects_position_quotas():
    pool = (
        [proj(i, 1, f"C{i}", 20 - i) for i in range(5)]
        + [proj(10 + i, 2, f"D{i}", 15 - i) for i in range(8)]
        + [proj(20 + i, 3, f"M{i}", 15 - i) for i in range(8)]
        + [proj(30 + i, 4, f"F{i}", 15 - i) for i in range(6)]
    )
    squad = select_squad(pool)

    assert len(squad) == 15
    by_pos = {et: sum(1 for p in squad if p["element_type"] == et) for et in (1, 2, 3, 4)}
    assert by_pos == {1: 2, 2: 5, 3: 5, 4: 3}


def test_select_squad_caps_players_per_club():
    pool = [proj(i, 3, "Sameclub", 100 - i) for i in range(6)] + [
        proj(50 + i, 3, f"Other{i}", 10 - i) for i in range(6)
    ]
    squad = select_squad(pool, quotas={3: 5}, max_per_club=3)

    assert sum(1 for p in squad if p["team"] == "Sameclub") == 3
    assert len(squad) == 5


def _row(season, gw, hid, kickoff, pts=2, mins=90, et=3):
    return {
        "season": season,
        "gw": gw,
        "historical_id": hid,
        "kickoff_time": kickoff,
        "total_points": pts,
        "minutes": mins,
        "ict_index": 3.0,
        "element_type": et,
        "team": 1,
        "was_home": True,
        "opponent_team": 2,
        "expected_goals": 0.1,
        "expected_assists": 0.1,
        "defensive_contribution": 3.0,
    }


def test_frame_before_excludes_kickoffs_at_or_after_the_deadline():
    rows = pd.DataFrame(
        [
            _row("S", 1, 1, "2024-08-10T14:00:00Z"),
            _row("S", 2, 1, "2024-08-17T14:00:00Z"),
            _row("S", 3, 1, "2024-08-24T14:00:00Z"),
        ]
    )
    before = _frame_before(rows, deadline="2024-08-24T11:30:00Z")  # GW3 deadline

    assert set(before["gw"]) == {1, 2}


def test_frame_before_excludes_a_postponed_match_with_a_late_kickoff():
    # A GW2 fixture postponed and replayed after GW4 kicked off: low label,
    # late kickoff. It must not leak into an earlier target gameweek.
    rows = pd.DataFrame(
        [
            _row("S", 2, 1, "2024-08-17T14:00:00Z"),
            _row("S", 2, 2, "2024-09-30T19:00:00Z"),  # postponed leg
            _row("S", 3, 1, "2024-08-24T14:00:00Z"),
        ]
    )
    before = _frame_before(rows, deadline="2024-08-24T11:30:00Z")  # GW3

    assert list(before["historical_id"]) == [1]  # the postponed GW2 leg is out


def _season_frame(season, n_players=20, n_gw=6):
    rows = []
    for gw in range(1, n_gw + 1):
        day = 9 + gw * 7
        for pid in range(1, n_players + 1):
            et = 1 if pid <= 3 else 2 if pid <= 9 else 3 if pid <= 15 else 4
            rows.append(
                _row(season, gw, pid, f"2024-{'0' if day < 10 else ''}{day % 30 + 1:02d}T14:00:00Z".replace("2024-", "2024-08-" if gw < 4 else "2024-09-"),
                     pts=(pid % 7) + gw % 3, mins=90 if pid % 5 else 0, et=et)
            )
    return pd.DataFrame(rows).set_index(["season", "gw", "historical_id"])


def test_replay_produces_per_season_points_and_gameweek_count():
    frame = _season_frame("2024-25")
    result = replay("2024-25", frame, fixtures=[], teams=[])

    assert result["season"] == "2024-25"
    assert result["gameweeks"] >= 1
    assert isinstance(result["modelPoints"], float)
    assert isinstance(result["baselinePoints"], float)
    assert result["delta"] == pytest.approx(result["modelPoints"] - result["baselinePoints"])


def test_replay_only_sees_its_own_season():
    a = _season_frame("2023-24")
    b = _season_frame("2024-25")
    # blow up 2023-24 scores; replaying 2024-25 must be unaffected.
    a["total_points"] = 999
    combined = pd.concat([a, b])

    isolated = replay("2024-25", b, fixtures=[], teams=[])
    with_other = replay("2024-25", combined, fixtures=[], teams=[])

    assert isolated == with_other


def test_meaningful_threshold_is_the_configured_edge():
    assert (0.31 >= MEANINGFUL_EDGE_PER_GW) is True
    assert (0.29 >= MEANINGFUL_EDGE_PER_GW) is False


def test_backtest_script_writes_a_report_and_exits_zero(tmp_path, monkeypatch):
    monkeypatch.setattr(bt_script, "ARCHIVE_SEASONS", ["S1", "S2"])
    monkeypatch.setattr(bt_script, "DATA_DIR", tmp_path)

    class _Archive:
        frame = pd.DataFrame([{"x": 1}])  # non-empty

    monkeypatch.setattr(bt_script, "load_history", lambda _d: _Archive())
    monkeypatch.setattr(
        bt_script,
        "replay",
        lambda season, *a, **k: {
            "season": season,
            "modelPoints": 100.0,
            "baselinePoints": 80.0,
            "delta": 20.0,
            "gameweeks": 10,
        },
    )

    assert bt_script.main() == 0
    reports = list((tmp_path / "backtest").glob("*.json"))
    assert len(reports) == 1
    report = json.loads(reports[0].read_text())
    assert set(report["seasons"]) == {"S1", "S2"}
    # pooled: (200 - 160) / 20 == 2.0 per GW -> meaningful
    assert report["pooled"]["deltaPerGw"] == pytest.approx(2.0)
    assert report["pooled"]["meaningful"] is True
