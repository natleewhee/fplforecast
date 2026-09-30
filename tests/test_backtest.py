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

    monkeypatch.setattr(bt_script, "load_history", lambda _d, **_k: _Archive())
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

    assert bt_script.main([]) == 0
    reports = list((tmp_path / "backtest").glob("*.json"))
    assert len(reports) == 1
    report = json.loads(reports[0].read_text())
    assert set(report["seasons"]) == {"S1", "S2"}
    # pooled: (200 - 160) / 20 == 2.0 per GW -> meaningful
    assert report["pooled"]["deltaPerGw"] == pytest.approx(2.0)
    assert report["pooled"]["meaningful"] is True


def test_replay_gameweeks_yields_leak_safe_frames_matching_replay():
    from engine.backtest import replay_gameweeks

    frame = _season_frame("2024-25")
    gws = list(replay_gameweeks("2024-25", frame, fixtures=[], teams=[]))

    assert gws, "expected at least one replayable gameweek"
    assert [g.gw for g in gws] == sorted(g.gw for g in gws)
    for g in gws:
        assert set(g.rows["gw"]) == {g.gw}
    assert len(gws) == replay("2024-25", frame, fixtures=[], teams=[])["gameweeks"]


def test_backtest_carries_defensive_contribution_into_the_rates():
    from engine.backtest import replay_gameweeks

    frame = _season_frame("2025-26")
    last = list(replay_gameweeks("2025-26", frame, fixtures=[], teams=[]))[-1]
    outfield_played = last.frame[last.frame["element_type"] != 1]

    assert (outfield_played["dc90"] > 0).any()


def test_backtest_carries_saves_bonus_and_cards_into_the_rates():
    from engine.backtest import replay_gameweeks

    frame = _season_frame("2025-26").assign(saves=4, bonus=1, yellow_cards=1, goals_conceded=1)
    last = list(replay_gameweeks("2025-26", frame, fixtures=[], teams=[]))[-1]
    keepers = last.frame[last.frame["element_type"] == 1]

    assert (keepers["saves90"] > 0).any()
    assert (last.frame["bonus90"] > 0).any()
    assert (last.frame["yellow90"] > 0).any()


def _fx(kickoff, h, a, hs, as_, gw=1):
    return {"gw": gw, "kickoff_time": kickoff, "finished": True, "team_h": h, "team_a": a,
            "team_h_score": hs, "team_a_score": as_, "team_h_difficulty": 3, "team_a_difficulty": 3}


_TEAMS = [{"id": 1, "name": "Alpha", "short_name": "ALP"}, {"id": 2, "name": "Beta", "short_name": "BET"}]


def test_strength_table_ignores_results_after_the_deadline():
    from engine.backtest import _strength_at

    early = [_fx("2024-08-17T14:00:00Z", 1, 2, 1, 1)]
    late = early + [_fx("2024-08-24T14:00:00Z", 1, 2, 9, 0, gw=2)]  # GW2 thrashing

    at_gw2_deadline = "2024-08-24T11:30:00Z"
    assert _strength_at("2024-25", at_gw2_deadline, late, _TEAMS, {}) == _strength_at(
        "2024-25", at_gw2_deadline, early, _TEAMS, {}
    )


def test_strength_table_ignores_later_seasons_but_uses_earlier_ones():
    from engine.backtest import _strength_at

    this = [_fx("2024-08-17T14:00:00Z", 1, 2, 1, 1)]
    deadline = "2024-09-01T00:00:00Z"
    later = {"2025-26": {"fixtures": [_fx("2025-08-16T14:00:00Z", 1, 2, 9, 0)], "teams": _TEAMS}}
    earlier = {"2023-24": {"fixtures": [_fx("2023-08-12T14:00:00Z", 1, 2, 9, 0)], "teams": _TEAMS}}

    alone = _strength_at("2024-25", deadline, this, _TEAMS, {})
    assert _strength_at("2024-25", deadline, this, _TEAMS, later) == alone
    assert _strength_at("2024-25", deadline, this, _TEAMS, earlier)["ALP"].attack > alone["ALP"].attack


def test_replay_uses_the_goal_rate_table_for_opponent_strength():
    from engine.backtest import replay_gameweeks

    frame = _season_frame("2024-25")
    fixtures = [_fx("2024-08-10T14:00:00Z", 1, 2, 3, 0)]
    rg = next(iter(replay_gameweeks("2024-25", frame, fixtures, _TEAMS)))

    assert rg.ctx.team_strength is not None
    assert set(rg.ctx.team_strength) <= {"ALP", "BET"}


def test_compare_pairs_gameweeks_and_splits_the_holdout():
    def report(points_by_season):
        return {"seasons": {s: {"perGw": [{"gw": gw, "model": p, "baseline": 0} for gw, p in pts]}
                            for s, pts in points_by_season.items()}}

    old = report({"2023-24": [(1, 50), (2, 50)], "2024-25": [(1, 50)], "2025-26": [(1, 50), (30, 50)]})
    new = report({"2023-24": [(1, 52), (2, 54)], "2024-25": [(1, 53)], "2025-26": [(1, 49), (30, 55)]})
    out = bt_script.compare(old, new)

    assert out["tune"]["xiPoints"]["n"] == 3 and out["tune"]["xiPoints"]["mean"] == pytest.approx(3.0)
    assert out["holdout"]["xiPoints"]["mean"] == pytest.approx(2.0)
    assert out["holdout GW1-19"]["xiPoints"]["mean"] == pytest.approx(-1.0)
    assert out["holdout GW20+"]["xiPoints"]["mean"] == pytest.approx(5.0)
    assert out["tune"]["mse"]["n"] == 0  # no mse in these reports -> nothing paired


def test_replay_links_players_to_earlier_seasons_by_name_for_prior_rates():
    from engine.backtest import _prior_season_rates

    prior = _season_frame("2023-24").reset_index()
    prior["web_name"] = prior["historical_id"].map(lambda h: f"Player {h}")
    prior["expected_goals"] = 0.9
    current = _season_frame("2024-25").reset_index()
    # same people, ids shuffled -- linking must go by name, not id
    current["web_name"] = current["historical_id"].map(lambda h: f"Player {21 - h}")
    frame = pd.concat([prior, current]).set_index(["season", "gw", "historical_id"])

    rates = _prior_season_rates(frame, "2024-25")

    played_2023 = {h for h, m in zip(prior["historical_id"], prior["minutes"]) if m > 0}
    assert rates, "expected linked prior-season rates"
    assert set(rates) == {21 - h for h in played_2023}
    assert all(r["xg90"] > 0 for r in rates.values())
    assert _prior_season_rates(frame, "2023-24") == {}  # nothing earlier than the first season


def test_ambiguous_names_are_never_linked():
    from engine.history import links_by_name

    rows = [
        {"season": "S1", "gw": 1, "historical_id": 1, "web_name": "Danny Ward"},
        {"season": "S1", "gw": 1, "historical_id": 2, "web_name": "Danny Ward"},
        {"season": "S2", "gw": 1, "historical_id": 9, "web_name": "Danny Ward"},
        {"season": "S1", "gw": 1, "historical_id": 3, "web_name": "Émile Smith Rowe"},
        {"season": "S2", "gw": 1, "historical_id": 7, "web_name": "Emile Smith Rowe"},
    ]
    frame = pd.DataFrame(rows).set_index(["season", "gw", "historical_id"])

    assert links_by_name(frame, "S2") == {7: {"S1": 3}}
