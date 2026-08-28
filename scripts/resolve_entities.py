"""Entity resolution: match this season's FPL player ids to their identity in
past seasons, so historical data becomes usable as a prior.

The problem, per the plan doc: FPL's own player ids reset every season —
there's no endpoint that says "this year's id 245 was id 118 in 2024-25".
vaastav/Fantasy-Premier-League mirrors FPL's schema per season, so it has
the same problem, one level removed. Understat and FBref are a separate,
harder join (different naming conventions entirely) and are NOT attempted
here — this script only resolves FPL-to-FPL identity across seasons, which
is what the minutes model's within-season-only prior actually needs next.

Matching key: normalized (first_name, second_name). Ambiguous or
unmatched players are recorded, never silently guessed — per the plan's
"silently-wrong joins" risk, a bad match here poisons every season of
history built on top of it.
"""

from __future__ import annotations

import csv
import json
import sys
import unicodedata
import urllib.error
import urllib.request
from datetime import datetime, timezone
from io import StringIO
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
VAASTAV_BASE = "https://raw.githubusercontent.com/vaastav/Fantasy-Premier-League/master/data"

# Reviewed manually each close season — see the module docstring for why this
# isn't derived automatically. Today's date is 2026-08-28, so the last three
# *completed* seasons are:
PAST_SEASONS = ["2025-26", "2024-25", "2023-24"]


def normalize_name(first: str, second: str) -> str:
    combined = f"{first} {second}".lower().strip()
    combined = unicodedata.normalize("NFKD", combined).encode("ascii", "ignore").decode("ascii")
    return " ".join(combined.split())


def fetch_text(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "fplforecast-entity-resolution/1.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8")


def load_season_idlist(season: str) -> dict[str, list[int]]:
    """normalized name -> list of historical ids (usually one; >1 means a name
    collision within that season, e.g. two different players named the same)."""
    url = f"{VAASTAV_BASE}/{season}/player_idlist.csv"
    try:
        text = fetch_text(url)
    except urllib.error.HTTPError as exc:
        print(f"  {season}: fetch failed ({exc})", file=sys.stderr)
        return {}

    reader = csv.DictReader(StringIO(text))
    by_name: dict[str, list[int]] = {}
    for row in reader:
        name = normalize_name(row["first_name"], row["second_name"])
        by_name.setdefault(name, []).append(int(row["id"]))
    return by_name


def latest_bootstrap() -> tuple[str, dict] | None:
    d = DATA_DIR / "bootstrap-static"
    if not d.exists():
        return None
    files = sorted(d.glob("*.json"))
    if not files:
        return None
    return files[-1].stem, json.loads(files[-1].read_text())


def main() -> int:
    bootstrap_result = latest_bootstrap()
    if bootstrap_result is None:
        print("No bootstrap-static snapshot yet — run scripts/snapshot.py first", file=sys.stderr)
        return 1
    bootstrap_date, bootstrap = bootstrap_result

    season_lookups: dict[str, dict[str, list[int]]] = {}
    for season in PAST_SEASONS:
        print(f"Fetching {season} player_idlist.csv...")
        season_lookups[season] = load_season_idlist(season)
        print(f"  {season}: {len(season_lookups[season])} distinct names")

    if not any(season_lookups.values()):
        print("No season data fetched — nothing to resolve (network unavailable?)", file=sys.stderr)
        return 1

    resolved: dict[str, dict] = {}
    unresolved: list[dict] = []

    for el in bootstrap["elements"]:
        current_id = el["id"]
        name = normalize_name(el["first_name"], el["second_name"])
        by_season: dict[str, int] = {}
        ambiguous_in: list[str] = []

        for season, lookup in season_lookups.items():
            candidates = lookup.get(name, [])
            if len(candidates) == 1:
                by_season[season] = candidates[0]
            elif len(candidates) > 1:
                ambiguous_in.append(season)

        if by_season:
            resolved[str(current_id)] = {
                "webName": el["web_name"],
                "bySeason": by_season,
            }
        if ambiguous_in or not by_season:
            unresolved.append(
                {
                    "currentId": current_id,
                    "webName": el["web_name"],
                    "normalizedName": name,
                    "ambiguousIn": ambiguous_in,
                    "matchedSeasons": list(by_season.keys()),
                }
            )

    total = len(bootstrap["elements"])
    # Row-count assertion: every current player accounted for, one way or the other.
    accounted = len({int(k) for k in resolved} | {u["currentId"] for u in unresolved})
    if accounted != total:
        raise RuntimeError(
            f"entity resolution dropped players: {total} in bootstrap, {accounted} accounted for"
        )

    out = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "bootstrapDate": bootstrap_date,
        "seasonsAttempted": PAST_SEASONS,
        "totalPlayers": total,
        "resolvedCount": len(resolved),
        "unresolvedCount": len(unresolved),
        "resolved": resolved,
        "unresolved": unresolved,
    }

    out_dir = DATA_DIR / "entity-resolution"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{bootstrap_date}.json"
    out_path.write_text(json.dumps(out, indent=2, sort_keys=True))
    print(
        f"entity resolution: {len(resolved)}/{total} players matched to >=1 past season, "
        f"{len(unresolved)} need review -> {out_path}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
