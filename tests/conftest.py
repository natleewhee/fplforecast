"""Keep the committed data/ tree as the test run found it.

Several tests run the real pipeline (``compute_forecast.main()``,
``save_pool_context()``), which writes into ``data/`` -- the same directory
the nightly job commits. Individual tests restore what they know they touch,
but a re-pickled ``data/pool-context/*.pkl`` used to slip through and get
committed by accident. This session-wide guard snapshots the directories the
pipeline writes and puts them back byte for byte at the end, deleting any
file the run created.
"""

from __future__ import annotations

from pathlib import Path

import pytest

DATA = Path(__file__).resolve().parent.parent / "data"
GUARDED = ["pool-context", "forecast", "record"]


def _snapshot() -> dict[Path, bytes]:
    files: dict[Path, bytes] = {}
    for name in GUARDED:
        root = DATA / name
        if root.exists():
            files.update({p: p.read_bytes() for p in root.rglob("*") if p.is_file()})
    return files


def _restore(before: dict[Path, bytes]) -> None:
    for name in GUARDED:
        root = DATA / name
        if not root.exists():
            continue
        for p in root.rglob("*"):
            if p.is_file() and p not in before:
                p.unlink()
    for p, content in before.items():
        if not p.exists() or p.read_bytes() != content:
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(content)


@pytest.fixture(scope="session", autouse=True)
def _leave_committed_data_untouched():
    before = _snapshot()
    try:
        yield
    finally:
        _restore(before)
