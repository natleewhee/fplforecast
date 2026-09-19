"""Python mirror of ``scripts/compress-deploy-data.mjs``, the actual Vercel
build step (an npm ``prebuild`` hook -- Vercel's Next.js build container has
no guaranteed Python on PATH, so the deploy itself can't run this file).
This version exists so the Python test suite (``tests/test_forecast_api.py``)
can regenerate ``data-deploy/`` without shelling out to Node. Keep the two in
sync if this logic ever changes.

Gzips the model data that ``api/forecast.py`` (the on-demand
personal-forecast lookup) needs to bundle, into ``data-deploy/`` -- a
separate tree from ``data/``, never committed to git, regenerated on every
deploy (or test run).

Why this exists: ``data/history`` (the multi-season per-gameweek archive)
plus ``data/understat`` and the entity-resolution snapshot run to ~40MB of
mostly-repetitive JSON text. Bundled as-is alongside pandas/numpy (~114MB
just for those two packages), a Vercel Python function gets uncomfortably
close to the platform's 250MB unzipped size limit -- this app's other
Function (api/solve.py) never even tried carrying that data. Gzipping brings
that ~40MB down to a few MB (JSON compresses ~10-15x); ``api/forecast.py``
decompresses it into ``/tmp`` at cold start, so the *model* handling every
forecast is unchanged -- this only shrinks what has to travel to get there.

Only the files build_pool_context() actually reads get bundled: the full
history/understat archives (needed every time, they don't shrink to "just
today's"), and the *latest* snapshot of anything else keyed by date
(bootstrap-static, fixtures, minutes-model, entity-resolution) -- mirroring
each loader's own ``latest_file()`` "sorted, take the last one" logic so the
on-demand function doesn't have to carry every day of the season for those.
"""

from __future__ import annotations

import gzip
import shutil
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
OUT_DIR = Path(__file__).resolve().parent.parent / "data-deploy"

# Full archives: every file matters, none of it is "just take the latest".
FULL_ARCHIVE_DIRS = ["history", "understat"]

# Dated snapshots: only the most recently dated file is ever read
# (scripts/compute_forecast.py's own ``latest_file()``), so only that one
# needs to make the trip.
LATEST_ONLY_DIRS = ["bootstrap-static", "fixtures", "minutes-model", "entity-resolution"]

# Small, and the whole season's worth is read every time (not just latest).
FULL_SMALL_DIRS = ["event-live"]

# Single files read directly, not through latest_file().
EXTRA_FILES = ["record/residuals.json"]


def _gzip_file(src: Path, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    with src.open("rb") as f_in, gzip.open(dst.with_suffix(dst.suffix + ".gz"), "wb") as f_out:
        shutil.copyfileobj(f_in, f_out)


def main() -> int:
    if OUT_DIR.exists():
        shutil.rmtree(OUT_DIR)

    total_files = 0

    for name in FULL_ARCHIVE_DIRS + FULL_SMALL_DIRS:
        src_dir = DATA_DIR / name
        if not src_dir.exists():
            continue
        for path in src_dir.rglob("*.json"):
            _gzip_file(path, OUT_DIR / path.relative_to(DATA_DIR))
            total_files += 1

    for name in LATEST_ONLY_DIRS:
        src_dir = DATA_DIR / name
        if not src_dir.exists():
            continue
        files = sorted(src_dir.glob("*.json"))
        if not files:
            continue
        _gzip_file(files[-1], OUT_DIR / name / files[-1].name)
        total_files += 1

    for rel in EXTRA_FILES:
        path = DATA_DIR / rel
        if path.exists():
            _gzip_file(path, OUT_DIR / rel)
            total_files += 1

    raw_size = sum(f.stat().st_size for f in DATA_DIR.rglob("*.json"))
    deploy_size = sum(f.stat().st_size for f in OUT_DIR.rglob("*.gz")) if OUT_DIR.exists() else 0
    print(
        f"compress_deploy_data: {total_files} files -> {OUT_DIR} "
        f"({deploy_size / 1e6:.1f} MB, vs {raw_size / 1e6:.1f} MB uncompressed in data/)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
