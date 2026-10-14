from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path

import scripts.prune_snapshots as prune


def _make(directory: Path, first: date, days: int, extra: tuple[str, ...] = ()) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    for i in range(days):
        (directory / f"{first + timedelta(days=i)}.json").write_text("{}")
    for name in extra:
        (directory / name).write_text("{}")


def test_keeps_a_window_of_days_ending_at_the_newest_file(tmp_path):
    folder = tmp_path / "bootstrap-static"
    _make(folder, date(2026, 9, 1), 30)  # 1 Sep .. 30 Sep

    doomed = prune.files_to_prune(folder, days=14)

    kept = sorted(p.stem for p in folder.glob("*.json") if p not in doomed)
    assert kept[0] == "2026-09-17" and kept[-1] == "2026-09-30"  # 14 days inclusive
    assert len(kept) == 14
    assert len(doomed) == 16


def test_never_deletes_the_newest_file_even_when_it_is_old(tmp_path):
    folder = tmp_path / "fixtures"
    _make(folder, date(2026, 1, 1), 1)  # a single, very old file
    assert prune.files_to_prune(folder, days=14) == []


def test_ignores_files_that_are_not_dated_snapshots(tmp_path):
    folder = tmp_path / "minutes-model"
    _make(folder, date(2026, 9, 1), 30, extra=("README.json", "latest.json", "notes.txt"))
    names = {p.name for p in prune.files_to_prune(folder, days=14)}
    assert "README.json" not in names and "latest.json" not in names and "notes.txt" not in names


def test_main_prunes_only_the_listed_folders_and_dry_run_deletes_nothing(tmp_path, capsys):
    _make(tmp_path / "bootstrap-static", date(2026, 9, 1), 30)
    _make(tmp_path / "forecast", date(2026, 9, 1), 30)  # not a daily-snapshot folder

    assert prune.main(["--data-dir", str(tmp_path), "--dry-run"]) == 0
    assert len(list((tmp_path / "bootstrap-static").glob("*.json"))) == 30

    assert prune.main(["--data-dir", str(tmp_path)]) == 0
    assert len(list((tmp_path / "bootstrap-static").glob("*.json"))) == 14
    assert len(list((tmp_path / "forecast").glob("*.json"))) == 30
    assert "removed 16 file(s)" in capsys.readouterr().out
