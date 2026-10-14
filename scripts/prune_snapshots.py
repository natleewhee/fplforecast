#!/usr/bin/env python3
"""Keep only the last N days of the daily snapshot folders.

``scripts/snapshot.py`` and its siblings write one dated file per day
(``data/bootstrap-static/2026-10-14.json`` and so on). Everything that reads
them uses only the newest file, so the older copies just make the repo grow
(about 3.4 MB a day). This drops files more than ``--days`` days older than the
newest one in each folder.

The newest file is never deleted, however old it is, so a daily job that stops
for weeks cannot leave a folder empty. Deleted files stay in git history.

Usage:  python scripts/prune_snapshots.py [--days 14] [--dry-run]
"""

from __future__ import annotations

import argparse
from datetime import date, timedelta
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

# The folders that get one full dated file per day and are read latest-only.
DATED_DIRS = ("bootstrap-static", "fixtures", "entity-resolution", "minutes-model")
DEFAULT_DAYS = 14


def file_date(path: Path) -> date | None:
    """The date in a ``YYYY-MM-DD.json`` name, or None for anything else."""
    try:
        return date.fromisoformat(path.stem)
    except ValueError:
        return None


def files_to_prune(directory: Path, days: int = DEFAULT_DAYS) -> list[Path]:
    """Dated files in ``directory`` older than ``days`` days before the newest."""
    dated = sorted(
        ((d, p) for p in directory.glob("*.json") if (d := file_date(p)) is not None),
        key=lambda item: item[0],
    )
    if not dated:
        return []
    newest = dated[-1][0]
    cutoff = newest - timedelta(days=days - 1)  # a 14-day window includes the newest day
    return [p for d, p in dated[:-1] if d < cutoff]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--days", type=int, default=DEFAULT_DAYS)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--data-dir", type=Path, default=DATA_DIR)
    args = parser.parse_args(argv)
    if args.days < 1:
        parser.error("--days must be at least 1")

    total = 0
    for name in DATED_DIRS:
        directory = args.data_dir / name
        if not directory.is_dir():
            continue
        doomed = files_to_prune(directory, args.days)
        freed = sum(p.stat().st_size for p in doomed)
        for path in doomed:
            if not args.dry_run:
                path.unlink()
        total += freed
        verb = "would remove" if args.dry_run else "removed"
        print(f"{name}: {verb} {len(doomed)} file(s), {freed / 1e6:.1f} MB")
    print(f"total {total / 1e6:.1f} MB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
