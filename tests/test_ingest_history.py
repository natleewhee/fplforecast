"""U3 coverage: multi-season gameweek + fixtures archive ingestion.

All unit tests run against mocked CSV text — no network.
"""

from __future__ import annotations

import json
import urllib.error

import pytest

import scripts.ingest_history as ih

GW_CSV = """\
name,position,team,element,kickoff_time,minutes,total_points,ict_index,was_home,opponent_team,expected_goals,expected_assists,GW
Player A,MID,Arsenal,10,2024-08-16T14:00:00Z,90,6,12.3,True,5,0.40,0.10,1
Player B,GK,Chelsea,11,2024-08-16T14:00:00Z,0,1,,False,5,0.00,0.00,1
Player A,MID,Arsenal,10,2024-08-24T14:00:00Z,78,3,4.5,False,8,0.20,0.00,2
"""

GW_CSV_NO_XG = """\
name,element,kickoff_time,minutes,total_points,ict_index,was_home,opponent_team,GW
Player A,10,2023-08-12T14:00:00Z,61,2,3.1,True,7,1
"""

GW_CSV_MISSING_GW = """\
name,element,kickoff_time,minutes,total_points,ict_index,was_home,opponent_team,GW
Player A,10,2024-08-16T14:00:00Z,90,6,12.3,True,5,1
Player B,11,2024-08-16T14:00:00Z,0,1,0.0,False,5,
"""

FIXTURES_CSV = """\
code,event,finished,id,kickoff_time,team_a,team_a_score,team_h,team_h_score,stats,team_h_difficulty,team_a_difficulty,pulse_id
1001,1,True,1,2024-08-16T19:00:00Z,4,2,12,1,[],3,4,99
1002,,False,2,,7,0,15,0,[],2,5,100
"""

TEAMS_CSV = """\
code,draw,form,id,loss,name,played,points,position,short_name,strength,team_division,unavailable,win,strength_overall_home,strength_overall_away,strength_attack_home,strength_attack_away,strength_defence_home,strength_defence_away,pulse_id
3,0,,1,0,Arsenal,0,0,2,ARS,5,,False,0,1350,1350,1390,1400,1310,1300,1
7,0,,2,0,Aston Villa,0,0,6,AVL,3,,False,0,1145,1240,1130,1180,1160,1300,2
"""


def test_normalise_gw_rows_keys_by_gameweek_off_the_element_column():
    rows_by_gw, fields, rows_read = ih.normalise_gw_rows(GW_CSV, "2024-25")

    assert rows_read == 3
    assert set(rows_by_gw) == {1, 2}
    assert len(rows_by_gw[1]) == 2 and len(rows_by_gw[2]) == 1
    assert [r["historical_id"] for r in rows_by_gw[1]] == [10, 11]
    row_a = rows_by_gw[1][0]
    assert row_a["season"] == "2024-25"
    assert row_a["gw"] == 1
    assert row_a["minutes"] == 90 and row_a["total_points"] == 6
    assert row_a["was_home"] is True
    assert row_a["expected_goals"] == 0.40
    assert row_a["element_type"] == 3 and row_a["team"] == "Arsenal"  # MID
    assert rows_by_gw[1][1]["element_type"] == 1  # GK -> 1


def test_empty_ict_index_cell_is_null_not_zero():
    rows_by_gw, _, _ = ih.normalise_gw_rows(GW_CSV, "2024-25")
    player_b = rows_by_gw[1][1]

    assert player_b["historical_id"] == 11
    assert player_b["ict_index"] is None


def test_fields_present_reflects_the_seasons_columns():
    _, with_xg, _ = ih.normalise_gw_rows(GW_CSV, "2024-25")
    _, without_xg, _ = ih.normalise_gw_rows(GW_CSV_NO_XG, "2023-24")

    assert "expected_goals" in with_xg and "expected_assists" in with_xg
    assert "expected_goals" not in without_xg
    for always in ("minutes", "total_points", "ict_index"):
        assert always in with_xg and always in without_xg


def test_a_missing_base_column_is_absent_from_coverage_and_rows():
    csv_no_ict = """\
name,element,kickoff_time,minutes,total_points,was_home,opponent_team,GW
Player A,10,2024-08-16T14:00:00Z,90,6,True,5,1
"""
    rows_by_gw, fields, _ = ih.normalise_gw_rows(csv_no_ict, "2024-25")

    assert "ict_index" not in fields
    assert "ict_index" not in rows_by_gw[1][0]
    assert "minutes" in fields


def test_normalise_fixtures_carries_difficulty_and_kickoff():
    fixtures = ih.normalise_fixtures(FIXTURES_CSV)

    assert len(fixtures) == 2
    assert fixtures[0] == {
        "gw": 1,
        "team_h": 12,
        "team_a": 4,
        "team_h_difficulty": 3,
        "team_a_difficulty": 4,
        "kickoff_time": "2024-08-16T19:00:00Z",
    }
    # an unscheduled fixture: no event, no kickoff
    assert fixtures[1]["gw"] is None
    assert fixtures[1]["kickoff_time"] is None
    assert fixtures[1]["team_h_difficulty"] == 2


def test_write_season_writes_one_file_per_gameweek(tmp_path):
    rows_by_gw, _, _ = ih.normalise_gw_rows(GW_CSV, "2024-25")
    written, skipped = ih.write_season("2024-25", rows_by_gw, tmp_path)

    assert (written, skipped) == (2, 0)
    gw1 = json.loads((tmp_path / "2024-25" / "gw1.json").read_text())
    assert gw1["season"] == "2024-25" and gw1["gw"] == 1
    assert len(gw1["rows"]) == 2
    assert json.loads((tmp_path / "2024-25" / "gw2.json").read_text())["gw"] == 2


def test_write_season_never_overwrites_an_existing_gameweek(tmp_path):
    rows_by_gw, _, _ = ih.normalise_gw_rows(GW_CSV, "2024-25")
    ih.write_season("2024-25", rows_by_gw, tmp_path)

    frozen = tmp_path / "2024-25" / "gw1.json"
    frozen.write_text('{"frozen": true}')
    written, skipped = ih.write_season("2024-25", rows_by_gw, tmp_path)

    assert (written, skipped) == (0, 2)
    assert json.loads(frozen.read_text()) == {"frozen": True}


def test_reconcile_row_counts_raises_on_a_dropped_row():
    rows_by_gw, _, rows_read = ih.normalise_gw_rows(GW_CSV_MISSING_GW, "2024-25")
    normalised = sum(len(r) for r in rows_by_gw.values())

    assert rows_read == 2 and normalised == 1
    with pytest.raises(RuntimeError, match="dropped rows"):
        ih.reconcile_row_counts(rows_read, normalised)


def test_main_skips_a_404_season_and_still_writes_the_rest(tmp_path, monkeypatch):
    monkeypatch.setattr(ih, "ARCHIVE_SEASONS", ["S1", "S2"])
    monkeypatch.setattr(ih, "HISTORY_DIR", tmp_path)

    def fake_fetch(url: str) -> str:
        if "S2/gws/merged_gw.csv" in url:
            raise urllib.error.HTTPError(url, 404, "Not Found", hdrs=None, fp=None)
        if url.endswith("fixtures.csv"):
            return FIXTURES_CSV
        if url.endswith("teams.csv"):
            return TEAMS_CSV
        return GW_CSV

    monkeypatch.setattr(ih, "fetch_text", fake_fetch)

    assert ih.main() == 0
    assert (tmp_path / "S1" / "gw1.json").exists()
    assert (tmp_path / "S1" / "teams.json").exists()
    assert not (tmp_path / "S2" / "gw1.json").exists()
    coverage = json.loads((tmp_path / "coverage.json").read_text())
    assert set(coverage) == {"S1"}


def test_normalise_teams_carries_attack_and_defence_strength():
    teams = ih.normalise_teams(TEAMS_CSV)

    assert len(teams) == 2
    assert teams[0] == {
        "id": 1,
        "name": "Arsenal",
        "short_name": "ARS",
        "strength": 5,
        "strength_overall_home": 1350,
        "strength_overall_away": 1350,
        "strength_attack_home": 1390,
        "strength_attack_away": 1400,
        "strength_defence_home": 1310,
        "strength_defence_away": 1300,
    }


def test_main_returns_1_when_no_season_can_be_fetched(tmp_path, monkeypatch):
    monkeypatch.setattr(ih, "ARCHIVE_SEASONS", ["S1"])
    monkeypatch.setattr(ih, "HISTORY_DIR", tmp_path)

    def always_404(url: str) -> str:
        raise urllib.error.HTTPError(url, 404, "Not Found", hdrs=None, fp=None)

    monkeypatch.setattr(ih, "fetch_text", always_404)
    assert ih.main() == 1
