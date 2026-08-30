"""U4 coverage: cross-season player series + cold-start tagging (R2, R5, KTD11).

Unit tests build tiny synthetic frames; one integration test runs
``load_history`` over the committed ``data/history/`` and ``data/entity-resolution``.
"""

from __future__ import annotations

import glob
import json
from pathlib import Path

import pandas as pd
import pytest

from engine.history import (
    ColdStart,
    HasHistory,
    HistoryArchive,
    assert_match_rate,
    classify,
    load_history,
    player_series,
)

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"


def make_frame(rows: list[dict]) -> pd.DataFrame:
    return pd.DataFrame.from_records(rows).set_index(["season", "gw", "historical_id"]).sort_index()


def row(season: str, gw: int, historical_id: int, **fields) -> dict:
    return {"season": season, "gw": gw, "historical_id": historical_id, "total_points": 2, **fields}


def test_player_series_spans_all_resolved_seasons_oldest_first():
    frame = make_frame(
        [
            row("2025-26", 1, 1), row("2025-26", 2, 1),
            row("2024-25", 5, 15), row("2024-25", 6, 15), row("2024-25", 7, 15),
            row("2023-24", 3, 113),
            row("2024-25", 5, 999),  # another player, must not leak in
        ]
    )
    resolved = {"1": {"webName": "Raya", "bySeason": {"2023-24": 113, "2024-25": 15, "2025-26": 1}}}

    series = player_series(1, resolved, frame)

    assert len(series) == 6
    assert list(series.index.get_level_values("season")) == [
        "2023-24", "2024-25", "2024-25", "2024-25", "2025-26", "2025-26"
    ]


def test_player_series_one_resolved_season_returns_only_that_season():
    frame = make_frame([row("2024-25", 1, 99), row("2024-25", 2, 99), row("2023-24", 1, 42)])
    resolved = {"7": {"bySeason": {"2024-25": 99}}}

    series = player_series(7, resolved, frame)

    assert len(series) == 2
    assert set(series.index.get_level_values("season")) == {"2024-25"}


def test_ambiguous_season_is_excluded_not_guessed():
    # Player 7 was a name-collision in 2024-25, so resolve_entities left no
    # bySeason entry for it. A 2024-25 row keyed on some id must not be pulled.
    frame = make_frame(
        [row("2023-24", 1, 42), row("2025-26", 1, 5), row("2024-25", 1, 500)]
    )
    resolved = {"7": {"bySeason": {"2023-24": 42, "2025-26": 5}}}

    series = player_series(7, resolved, frame)

    assert set(series.index.get_level_values("season")) == {"2023-24", "2025-26"}


def test_classify_cold_start_when_resolved_but_no_archive_rows():
    frame = make_frame([row("2024-25", 1, 111)])
    resolved = {"3": {"bySeason": {"2024-25": 222}}}  # 222 has no rows

    result = classify(3, resolved, frame)

    assert isinstance(result, ColdStart)
    assert result.status == "cold_start"
    assert not hasattr(result, "points")


def test_classify_cold_start_when_absent_from_resolved_map():
    frame = make_frame([row("2024-25", 1, 111)])

    result = classify(9999, {}, frame)

    assert isinstance(result, ColdStart)


def test_classify_has_history_counts_rows():
    frame = make_frame(
        [row("2024-25", g, 15) for g in (1, 2, 3)] + [row("2025-26", 1, 1)]
    )
    resolved = {"1": {"bySeason": {"2024-25": 15, "2025-26": 1}}}

    result = classify(1, resolved, frame)

    assert isinstance(result, HasHistory)
    assert result.rows == 4


def test_available_fields_reflects_per_season_coverage():
    archive = HistoryArchive(
        frame=make_frame([row("2023-24", 1, 1)]),
        coverage={
            "2023-24": ["minutes", "total_points", "ict_index"],
            "2025-26": ["minutes", "total_points", "ict_index", "defensive_contribution"],
        },
    )

    assert "defensive_contribution" not in archive.available_fields("2023-24")
    assert "defensive_contribution" in archive.available_fields("2025-26")
    assert archive.available_fields("2019-20") == []


def test_match_rate_guard_raises_on_a_wrong_column_join():
    # Every resolved id maps to history ids that simply are not in the frame.
    frame = make_frame([row("2024-25", 1, hid) for hid in range(900, 910)])
    resolved = {str(i): {"bySeason": {"2024-25": i}} for i in range(10)}

    with pytest.raises(RuntimeError, match="match rate"):
        assert_match_rate(resolved, frame)


def test_match_rate_guard_passes_when_most_players_match():
    frame = make_frame([row("2024-25", 1, i) for i in range(9)])
    resolved = {str(i): {"bySeason": {"2024-25": i}} for i in range(10)}  # 9/10 match

    rate = assert_match_rate(resolved, frame)

    assert rate == pytest.approx(0.9)


def test_load_history_over_the_committed_archive_classifies_known_players():
    archive = load_history(DATA_DIR)

    assert not archive.frame.empty
    assert list(archive.frame.index.names) == ["season", "gw", "historical_id"]
    assert set(archive.coverage) == {"2023-24", "2024-25", "2025-26"}

    resolved = json.loads(
        Path(sorted(glob.glob(str(DATA_DIR / "entity-resolution" / "*.json")))[-1]).read_text()
    )["resolved"]

    # Raya (current id 1) resolves to all three seasons -> has history.
    assert isinstance(classify(1, resolved, archive.frame), HasHistory)
    # A promoted-in player absent from the resolved map -> cold start (AE1).
    promoted_id = 557  # Tzolis: in this season's bootstrap, no resolved history
    assert promoted_id not in {int(k) for k in resolved}
    assert isinstance(classify(promoted_id, resolved, archive.frame), ColdStart)
