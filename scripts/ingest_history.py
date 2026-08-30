"""U3: multi-season gameweek + fixtures archive ingestion.

Pulls vaastav/Fantasy-Premier-League's per-gameweek player rows and per-season
fixture difficulty for ``engine.config.ARCHIVE_SEASONS`` into ``data/history/``,
and records which statistical fields each season's CSV actually carries so
downstream logic can tell a genuine zero from an absent field (R1, R3).

  data/history/<season>/gwNN.json      {"season", "gw", "rows": [...]}, one file
                                       per gameweek, never rewritten once present
  data/history/<season>/fixtures.json  per-fixture team ids, FDR, kickoff_time
  data/history/coverage.json           {"<season>": [normalised fields found]}

Degradation matches ``resolve_entities.py``: a season whose CSV 404s or is
empty is logged and skipped, the rest still run. A mismatch between CSV data
rows read and rows normalised is fatal (``RuntimeError``) -- a silently short
archive poisons every average built on top of it.
"""

from __future__ import annotations

import csv
import json
import sys
import urllib.error
import urllib.request
from io import StringIO
from pathlib import Path

from engine.config import ARCHIVE_SEASONS

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
HISTORY_DIR = DATA_DIR / "history"
VAASTAV_BASE = "https://raw.githubusercontent.com/vaastav/Fantasy-Premier-League/master/data"

# normalised field -> merged_gw.csv column. Always expected.
GW_FIELD_COLUMNS = {
    "web_name": "name",
    "team": "team",
    "kickoff_time": "kickoff_time",
    "minutes": "minutes",
    "total_points": "total_points",
    "ict_index": "ict_index",
    "was_home": "was_home",
    "opponent_team": "opponent_team",
}

# vaastav's per-GW position string -> FPL element_type, so the archive matches
# the live feature frame (U11's select_squad needs position quotas).
POSITION_TO_TYPE = {"GK": 1, "GKP": 1, "DEF": 2, "MID": 3, "FWD": 4}
# Richer fields, kept per row only for seasons whose CSV carries them (R3).
GW_RICH_COLUMNS = {
    "expected_goals": "expected_goals",
    "expected_assists": "expected_assists",
    "defensive_contribution": "defensive_contribution",
}

# FPL's own per-team strength ratings, home/away and attack/defence split
# (populated in vaastav's archived teams.csv even though the live bootstrap
# leaves them 0 until the season is under way). The team-strength model (U6,
# engine/strength.py) reads these; a scoped extension of KTD10.
TEAM_STRENGTH_FIELDS = (
    "strength",
    "strength_overall_home",
    "strength_overall_away",
    "strength_attack_home",
    "strength_attack_away",
    "strength_defence_home",
    "strength_defence_away",
)

_INT_FIELDS = {
    "gw",
    "minutes",
    "total_points",
    "opponent_team",
    "team_h",
    "team_a",
    "team_h_difficulty",
    "team_a_difficulty",
    "id",
    *TEAM_STRENGTH_FIELDS,
}
_FLOAT_FIELDS = {"ict_index", "expected_goals", "expected_assists", "defensive_contribution"}
_BOOL_FIELDS = {"was_home"}


def fetch_text(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "fplforecast-ingest-history/1.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read().decode("utf-8")


def _coerce(field: str, raw: str | None):
    """CSV cell -> typed value. An empty or missing cell is ``None`` (a real
    absence), never ``0`` -- see R3."""
    if raw is None or raw.strip() == "":
        return None
    if field in _INT_FIELDS:
        try:
            return int(float(raw))
        except ValueError:
            return None
    if field in _FLOAT_FIELDS:
        try:
            return float(raw)
        except ValueError:
            return None
    if field in _BOOL_FIELDS:
        return raw.strip() == "True"
    return raw


def normalise_gw_rows(csv_text: str, season: str) -> tuple[dict[int, list[dict]], list[str], int]:
    """(rows keyed by gameweek, sorted normalised fields present, data rows read).

    Every CSV data row that carries a gameweek lands in exactly one bucket. A
    row with no ``GW``/``round`` is left unplaced so the caller's row-count
    reconciliation turns it into a loud failure rather than a silent drop.
    """
    reader = csv.DictReader(StringIO(csv_text))
    header = set(reader.fieldnames or [])
    # Only fields the season's CSV actually carries -- a missing column is
    # recorded as absent (R3), never emitted as a null the reader can't
    # distinguish from a real gap.
    base_present = {f: col for f, col in GW_FIELD_COLUMNS.items() if col in header}
    rich_present = {f: col for f, col in GW_RICH_COLUMNS.items() if col in header}

    rows_by_gw: dict[int, list[dict]] = {}
    rows_read = 0
    for raw in reader:
        rows_read += 1
        gw_raw = (raw.get("GW") or raw.get("round") or "").strip()
        if not gw_raw:
            continue
        gw = int(gw_raw)
        row = {"season": season, "gw": gw, "historical_id": int(raw["element"])}
        for field, col in (*base_present.items(), *rich_present.items()):
            row[field] = _coerce(field, raw.get(col))
        if "position" in header:
            row["element_type"] = POSITION_TO_TYPE.get((raw.get("position") or "").strip())
        rows_by_gw.setdefault(gw, []).append(row)

    extra = ["element_type"] if "position" in header else []
    fields_present = sorted(["historical_id", *extra, *base_present, *rich_present])
    return rows_by_gw, fields_present, rows_read


def normalise_fixtures(csv_text: str) -> list[dict]:
    """Per-fixture ``gw``, both team ids, both difficulty ratings, kickoff_time
    -- the historical FDR the backtest's model consumes (KTD6)."""
    reader = csv.DictReader(StringIO(csv_text))
    fixtures: list[dict] = []
    for raw in reader:
        fixtures.append(
            {
                "gw": _coerce("gw", raw.get("event")) if (raw.get("event") or "").strip() else None,
                "team_h": _coerce("team_h", raw.get("team_h")),
                "team_a": _coerce("team_a", raw.get("team_a")),
                "team_h_difficulty": _coerce("team_h_difficulty", raw.get("team_h_difficulty")),
                "team_a_difficulty": _coerce("team_a_difficulty", raw.get("team_a_difficulty")),
                "kickoff_time": _coerce("kickoff_time", raw.get("kickoff_time")),
            }
        )
    return fixtures


def normalise_teams(csv_text: str) -> list[dict]:
    """Per-team id, name, short_name, and FPL's attack/defence/overall strength
    ratings (home & away) -- the raw signal for engine/strength.py."""
    reader = csv.DictReader(StringIO(csv_text))
    teams: list[dict] = []
    for raw in reader:
        team = {
            "id": _coerce("id", raw.get("id")),
            "name": raw.get("name"),
            "short_name": raw.get("short_name"),
        }
        for field in TEAM_STRENGTH_FIELDS:
            team[field] = _coerce(field, raw.get(field))
        teams.append(team)
    return teams


def reconcile_row_counts(rows_read: int, rows_normalised: int) -> None:
    if rows_normalised != rows_read:
        raise RuntimeError(
            f"history ingest dropped rows: {rows_read} CSV rows read, "
            f"{rows_normalised} normalised"
        )


def _atomic_write(path: Path, text: str) -> None:
    """Write via a temp file + rename so an interrupted run never leaves a
    truncated JSON file -- which, under the never-rewrite rule, would poison
    every later load_history()."""
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(text)
    tmp.replace(path)


def write_season(season: str, rows_by_gw: dict[int, list[dict]], history_dir: Path) -> tuple[int, int]:
    """Write one file per gameweek. A gameweek already on disk is left alone
    (mirrors snapshot.py's finished-gameweek rule). Returns (written, skipped)."""
    season_dir = history_dir / season
    season_dir.mkdir(parents=True, exist_ok=True)
    written = skipped = 0
    for gw, rows in sorted(rows_by_gw.items()):
        path = season_dir / f"gw{gw}.json"
        if path.exists():
            skipped += 1
            continue
        payload = {"season": season, "gw": gw, "rows": rows}
        _atomic_write(path, json.dumps(payload, indent=2, sort_keys=True))
        written += 1
    return written, skipped


def write_fixtures(season: str, fixtures: list[dict], history_dir: Path) -> None:
    path = history_dir / season / "fixtures.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    _atomic_write(path, json.dumps({"season": season, "fixtures": fixtures}, indent=2, sort_keys=True))


def write_teams(season: str, teams: list[dict], history_dir: Path) -> None:
    path = history_dir / season / "teams.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    _atomic_write(path, json.dumps({"season": season, "teams": teams}, indent=2, sort_keys=True))


def main() -> int:
    HISTORY_DIR.mkdir(parents=True, exist_ok=True)

    # Phase 1: fetch + normalise every season into memory. A season whose CSV
    # can't be fetched or parsed is logged and skipped -- the rest still ingest
    # (the plan's "404s or is short ... skipped, not fatal" degradation).
    prepared: list[tuple[str, dict[int, list[dict]], list[str], list[dict], list[dict]]] = []
    total_read = total_normalised = 0

    for season in ARCHIVE_SEASONS:
        print(f"{season}: fetching merged_gw.csv ...")
        try:
            gw_text = fetch_text(f"{VAASTAV_BASE}/{season}/gws/merged_gw.csv")
            rows_by_gw, fields_present, rows_read = normalise_gw_rows(gw_text, season)
        except (urllib.error.URLError, ValueError, KeyError) as exc:
            print(f"  {season}: merged_gw.csv unusable ({exc!r}) -- skipping season", file=sys.stderr)
            continue

        total_read += rows_read
        total_normalised += sum(len(rows) for rows in rows_by_gw.values())

        fixtures: list[dict] = []
        try:
            fixtures = normalise_fixtures(fetch_text(f"{VAASTAV_BASE}/{season}/fixtures.csv"))
        except (urllib.error.URLError, ValueError, KeyError) as exc:
            print(f"  {season}: fixtures.csv unusable ({exc!r})", file=sys.stderr)

        teams: list[dict] = []
        try:
            teams = normalise_teams(fetch_text(f"{VAASTAV_BASE}/{season}/teams.csv"))
        except (urllib.error.URLError, ValueError, KeyError) as exc:
            print(f"  {season}: teams.csv unusable ({exc!r})", file=sys.stderr)

        prepared.append((season, rows_by_gw, fields_present, fixtures, teams))
        print(
            f"  {season}: {rows_read} rows -> {len(rows_by_gw)} GWs, "
            f"{len(fixtures)} fixtures, {len(teams)} teams"
        )

    if not prepared:
        print("No seasons ingested (network unavailable?)", file=sys.stderr)
        return 1

    # Reconcile BEFORE anything reaches disk: a short archive that lands under
    # the never-rewrite rule can't self-heal on a re-run.
    reconcile_row_counts(total_read, total_normalised)

    # Phase 2: write.
    coverage: dict[str, list[str]] = {}
    for season, rows_by_gw, fields_present, fixtures, teams in prepared:
        written, skipped = write_season(season, rows_by_gw, HISTORY_DIR)
        if fixtures:
            write_fixtures(season, fixtures, HISTORY_DIR)
        if teams:
            write_teams(season, teams, HISTORY_DIR)
        coverage[season] = fields_present
        print(f"  {season}: {written} GW files written, {skipped} already present")

    _atomic_write(HISTORY_DIR / "coverage.json", json.dumps(coverage, indent=2, sort_keys=True))
    print("coverage.json: " + ", ".join(f"{s}={len(c)} fields" for s, c in coverage.items()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
