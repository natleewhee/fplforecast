"""U4: cross-season player history + cold-start classification.

``load_history`` is the one sanctioned reader inside ``engine/`` (KTD1) -- a
pure deserializer over the committed ``data/history/`` archive that U3 writes.
Everything else here is pure: it takes the loaded frame and the entity
resolution map and never touches the filesystem or the network.

A player with no resolvable history is a *marker*, never a number (KTD11):
``classify`` returns a ``ColdStart`` object so ``engine.baseline`` /
``engine.model`` can refuse to project rather than emit a confident zero.
"""

from __future__ import annotations

import json
import unicodedata
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

from engine.config import PRIOR_ONLY_SEASONS

INDEX_COLUMNS = ["season", "gw", "historical_id"]

# Share of resolved players that must match at least one archive row. Below
# this, the join is almost certainly keyed on the wrong column and would
# mislabel established players as cold-start -- fail loud instead (mirrors
# resolve_entities.py's row-count assertion).
MATCH_RATE_FLOOR = 0.6


@dataclass(frozen=True)
class ColdStart:
    """No resolvable Premier League history. Rendered as "no history"; never
    ranked into a recommendation (KTD11). Covers AE1."""

    status: str = "cold_start"


@dataclass(frozen=True)
class HasHistory:
    rows: int
    status: str = "has_history"


@dataclass(frozen=True)
class HistoryArchive:
    """The deserialized ``data/history/`` tree: the gameweek frame plus the
    per-season field-coverage map."""

    frame: pd.DataFrame  # MultiIndex (season, gw, historical_id)
    coverage: dict[str, list[str]]  # season -> normalised fields the CSV carried

    def available_fields(self, season: str) -> list[str]:
        """Fields present in that season's source CSV, so callers branch on
        presence rather than treating a missing column as zero (R3)."""
        return list(self.coverage.get(season, []))


def load_history(data_dir: str | Path, *, include_prior_only: bool = False) -> HistoryArchive:
    """Read every ``data/history/<season>/gwNN.json`` into one frame indexed by
    ``(season, gw, historical_id)``, plus ``coverage.json``. Seasons in
    ``PRIOR_ONLY_SEASONS`` are skipped unless ``include_prior_only`` (the
    backtest)."""
    history_dir = Path(data_dir) / "history"

    records: list[dict] = []
    for gw_file in sorted(history_dir.glob("*/gw*.json")):
        if not include_prior_only and gw_file.parent.name in PRIOR_ONLY_SEASONS:
            continue
        records.extend(json.loads(gw_file.read_text())["rows"])

    frame = pd.DataFrame.from_records(records)
    if not frame.empty:
        frame = frame.set_index(INDEX_COLUMNS).sort_index()

    coverage_path = history_dir / "coverage.json"
    coverage = json.loads(coverage_path.read_text()) if coverage_path.exists() else {}
    if not include_prior_only:
        coverage = {k: v for k, v in coverage.items() if k not in PRIOR_ONLY_SEASONS}

    return HistoryArchive(frame=frame, coverage=coverage)


def player_series(
    current_id: int | str,
    resolved_map: dict[str, dict],
    history_frame: pd.DataFrame,
) -> pd.DataFrame:
    """That player's archive rows across every season they resolve to, ordered
    oldest to newest. Empty when the player is absent from ``resolved_map`` or
    has no matching rows. Seasons the player was *ambiguous* in carry no
    ``bySeason`` entry (resolve_entities.py), so they are excluded, not guessed.
    """
    entry = resolved_map.get(str(current_id))
    if not entry or history_frame.empty:
        return history_frame.iloc[0:0]
    by_season: dict[str, int] = entry.get("bySeason", {})
    if not by_season:
        return history_frame.iloc[0:0]

    seasons = history_frame.index.get_level_values("season").to_numpy()
    hist_ids = history_frame.index.get_level_values("historical_id").to_numpy()
    mask = np.zeros(len(history_frame), dtype=bool)
    for season, hist_id in by_season.items():
        mask |= (seasons == season) & (hist_ids == hist_id)

    return history_frame.iloc[mask].sort_index()


def classify(
    current_id: int | str,
    resolved_map: dict[str, dict],
    history_frame: pd.DataFrame,
    bootstrap_element: dict | None = None,
) -> ColdStart | HasHistory:
    """``ColdStart`` when the player has no ``bySeason`` entry and no archive
    row for any mapped id; otherwise ``HasHistory`` with the row count.

    ``bootstrap_element`` is accepted for call-site symmetry with the U5
    feature builder and is currently unused -- classification is purely a
    function of the resolution map and the archive.
    """
    series = player_series(current_id, resolved_map, history_frame)
    if len(series) == 0:
        return ColdStart()
    return HasHistory(rows=int(len(series)))


def assert_match_rate(
    resolved_map: dict[str, dict],
    history_frame: pd.DataFrame,
    floor: float = MATCH_RATE_FLOOR,
) -> float:
    """Fraction of resolved players with >=1 matched archive row. Raises
    ``RuntimeError`` below ``floor`` -- a near-zero rate means the frame is
    keyed on the wrong column and would silently mislabel everyone cold-start."""
    if not resolved_map:
        return 1.0

    present: set[tuple[str, int]] = set()
    if not history_frame.empty:
        present = set(
            zip(
                history_frame.index.get_level_values("season"),
                history_frame.index.get_level_values("historical_id"),
            )
        )
    matched = sum(
        1
        for entry in resolved_map.values()
        if any((season, hist_id) in present for season, hist_id in entry.get("bySeason", {}).items())
    )
    rate = matched / len(resolved_map)
    if rate < floor:
        raise RuntimeError(
            f"history match rate {rate:.1%} below floor {floor:.0%} -- "
            f"likely a wrong-column join; refusing to mislabel players as cold-start"
        )
    return rate


def season_rates(frame: pd.DataFrame) -> dict[tuple[str, int], dict]:
    """Per-90 rates for every ``(season, historical_id)`` in the archive. Keyed
    by season too: FPL reuses element ids for different players each season."""
    if frame is None or frame.empty:
        return {}
    df = frame.reset_index()
    out: dict[tuple[str, int], dict] = {}
    for (season, hist_id), sub in df.groupby(["season", "historical_id"]):
        minutes = float(sub["minutes"].sum())
        if minutes <= 0:
            continue
        per90 = minutes / 90.0
        rec = {
            "xg90": float(sub["expected_goals"].sum()) / per90,
            "xa90": float(sub["expected_assists"].sum()) / per90,
        }
        if "defensive_contribution" in sub:
            dc = sub[sub["defensive_contribution"].notna() & (sub["minutes"] > 0)]
            if not dc.empty and dc["minutes"].sum() > 0:
                rec["dc90"] = float(dc["defensive_contribution"].sum()) / (dc["minutes"].sum() / 90.0)
        out[(season, int(hist_id))] = rec
    return out


ARCHIVE_RATE_KEYS = ("xg90", "xa90", "dc90")


def archive_rates_for(links: dict, rates: dict[tuple[str, int], dict]) -> dict[int, dict]:
    """``{player_id: {rate: value}}``: each player's per-season rates, averaged
    over the seasons in ``links[player_id]`` (``{season: historical_id}``)."""
    out: dict[int, dict] = {}
    for player_id, by_season in links.items():
        recs = [rates[(s, h)] for s, h in by_season.items() if (s, h) in rates]
        if not recs:
            continue
        agg = {}
        for key in ARCHIVE_RATE_KEYS:
            vals = [r[key] for r in recs if key in r]
            if vals:
                agg[key] = sum(vals) / len(vals)
        out[int(player_id)] = agg
    return out


def normalise_name(name: str | None) -> str:
    text = unicodedata.normalize("NFKD", name or "")
    text = "".join(c for c in text if not unicodedata.combining(c))
    return " ".join(text.lower().split())


def links_by_name(frame: pd.DataFrame, season: str) -> dict[int, dict[str, int]]:
    """For each player in ``season``, their ids in every *earlier* season,
    matched by normalised full name (the archive's ``web_name``). A name held by
    two players within one season is ambiguous and never matched, as in
    ``scripts/resolve_entities.py``."""
    if frame is None or frame.empty or "web_name" not in frame.columns:
        return {}
    df = frame.reset_index()[["season", "historical_id", "web_name"]].drop_duplicates(
        ["season", "historical_id"]
    )
    df = df[df["season"] <= season]
    df["key"] = df["web_name"].map(normalise_name)
    unique = df.groupby(["season", "key"])["historical_id"].transform("nunique") == 1
    df = df[unique & (df["key"] != "")]

    by_season = {s: dict(zip(g["key"], g["historical_id"])) for s, g in df.groupby("season")}
    current = by_season.get(season, {})
    earlier = {s: m for s, m in by_season.items() if s < season}
    links: dict[int, dict[str, int]] = {}
    for key, hid in current.items():
        found = {s: int(m[key]) for s, m in earlier.items() if key in m}
        if found:
            links[int(hid)] = found
    return links
