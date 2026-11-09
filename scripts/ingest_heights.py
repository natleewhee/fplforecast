#!/usr/bin/env python3
"""Look up each Premier League player's height on Wikidata.

Run by hand when you want heights (new signings, a new season), not by the
nightly job: heights almost never change.

For every player in the latest ``data/bootstrap-static`` snapshot it searches
Wikidata by name, reads the date of birth (P569) and height (P2048) of the
candidates, and accepts one only when the **date of birth matches FPL's
``birth_date`` exactly**. Name alone is never enough (two players can share a
name; Wikidata is full of namesakes). Players with no match are simply left
out: the app then shows a typical height for their position and marks it as a
default on the review page.

Writes ``data/appearance/players.json`` (``players[code].cm`` and
``cmSource``), keeping anything else in the file. Hand corrections belong in
``data/appearance/overrides.json``, which always wins and is never touched
here.

Usage:  python scripts/ingest_heights.py [--limit N] [--only-missing] [--dry-run]
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
OUT_FILE = DATA_DIR / "appearance" / "players.json"

API = "https://www.wikidata.org/w/api.php"
USER_AGENT = "gafferfpl-appearance/1.0 (personal project)"

# Wikidata unit items for a height value.
UNIT_METRE = "Q11573"
UNIT_CENTIMETRE = "Q174728"
# Anything outside this is a typo or the wrong unit, not a footballer.
MIN_CM, MAX_CM = 150, 215

Fetch = Callable[[dict], dict]


def http_fetch(params: dict, *, retries: int = 4) -> dict:
    """GET one Wikidata API call as JSON, backing off on 429 / 5xx."""
    url = f"{API}?{urllib.parse.urlencode({**params, 'format': 'json'})}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.load(resp)
        except urllib.error.HTTPError as err:
            if err.code not in (429, 500, 502, 503, 504) or attempt == retries - 1:
                raise
        except urllib.error.URLError:
            if attempt == retries - 1:
                raise
        time.sleep(2 ** attempt)
    raise RuntimeError("unreachable")


def latest_bootstrap() -> dict:
    files = sorted((DATA_DIR / "bootstrap-static").glob("*.json"))
    if not files:
        raise SystemExit("No bootstrap-static snapshot found. Run scripts/snapshot.py first.")
    return json.loads(files[-1].read_text())


def search_names(player: dict) -> list[str]:
    """The names to try, most specific first, without repeats."""
    first = (player.get("first_name") or "").strip()
    second = (player.get("second_name") or "").strip()
    known = (player.get("known_name") or "").strip()
    web = (player.get("web_name") or "").strip()
    names = [f"{first} {second}".strip(), known, web]
    seen: set[str] = set()
    out = []
    for name in names:
        if name and name.lower() not in seen:
            seen.add(name.lower())
            out.append(name)
    return out


def search_candidates(name: str, fetch: Fetch, limit: int = 8) -> list[str]:
    data = fetch(
        {
            "action": "wbsearchentities",
            "search": name,
            "language": "en",
            "type": "item",
            "limit": limit,
        }
    )
    return [hit["id"] for hit in data.get("search", []) if hit.get("id", "").startswith("Q")]


def _best_claims(claims: list[dict]) -> list[dict]:
    """Preferred-rank statements if there are any, else the normal ones."""
    preferred = [c for c in claims if c.get("rank") == "preferred"]
    return preferred or [c for c in claims if c.get("rank") != "deprecated"]


def parse_dob(entity: dict) -> str | None:
    """Date of birth as YYYY-MM-DD, or None if missing or not precise to the day."""
    for claim in _best_claims(entity.get("claims", {}).get("P569", [])):
        value = claim.get("mainsnak", {}).get("datavalue", {}).get("value", {})
        time_str = value.get("time", "")  # "+1995-09-15T00:00:00Z"
        if value.get("precision", 0) >= 11 and len(time_str) >= 11:
            return time_str[1:11]
    return None


def parse_height_cm(entity: dict) -> int | None:
    """Height in whole centimetres, or None if missing or implausible."""
    for claim in _best_claims(entity.get("claims", {}).get("P2048", [])):
        value = claim.get("mainsnak", {}).get("datavalue", {}).get("value", {})
        try:
            amount = float(value.get("amount"))
        except (TypeError, ValueError):
            continue
        unit = str(value.get("unit", "")).rsplit("/", 1)[-1]
        if unit == UNIT_METRE:
            amount *= 100
        elif unit != UNIT_CENTIMETRE:
            continue  # feet, inches or anything unfamiliar: skip rather than guess
        cm = round(amount)
        if MIN_CM <= cm <= MAX_CM:
            return cm
    return None


def fetch_entities(qids: list[str], fetch: Fetch, cache: dict[str, dict]) -> None:
    """Fill ``cache`` with {qid: {"dob", "cm"}} for any ids not already in it."""
    todo = [q for q in dict.fromkeys(qids) if q not in cache]
    for start in range(0, len(todo), 50):
        batch = todo[start : start + 50]
        data = fetch({"action": "wbgetentities", "ids": "|".join(batch), "props": "claims"})
        entities = data.get("entities", {})
        for qid in batch:
            entity = entities.get(qid) or {}
            cache[qid] = {"dob": parse_dob(entity), "cm": parse_height_cm(entity)}


def match_player(player: dict, fetch: Fetch, cache: dict[str, dict]) -> dict | None:
    """The first candidate whose date of birth matches FPL's. None if no one does.

    Returns {"qid", "cm"} where cm may be None (right person, no height listed).
    """
    birth = player.get("birth_date")
    if not birth:
        return None
    for name in search_names(player):
        candidates = search_candidates(name, fetch)
        fetch_entities(candidates, fetch, cache)
        for qid in candidates:
            if cache.get(qid, {}).get("dob") == birth:
                return {"qid": qid, "cm": cache[qid]["cm"]}
    return None


def run(
    elements: list[dict],
    existing: dict,
    fetch: Fetch,
    *,
    only_missing: bool = False,
    limit: int | None = None,
    sleep: Callable[[float], None] = time.sleep,
    pause: float = 0.0,
    log: Callable[[str], None] = print,
) -> dict:
    """Return the updated players.json content and print a match report."""
    out = json.loads(json.dumps(existing)) if existing else {}
    out.setdefault("players", {})
    out.setdefault("meta", {})
    cache: dict[str, dict] = {}

    todo = [e for e in elements if not (only_missing and "cm" in out["players"].get(str(e["code"]), {}))]
    if limit is not None:
        todo = todo[:limit]

    with_height, no_height, unmatched = 0, 0, []
    for i, player in enumerate(todo, 1):
        found = match_player(player, fetch, cache)
        code = str(player["code"])
        if found and found["cm"]:
            rec = out["players"].setdefault(code, {})
            rec["cm"] = found["cm"]
            rec["cmSource"] = f"wikidata:{found['qid']}"
            with_height += 1
        elif found:
            no_height += 1
        else:
            unmatched.append(player.get("web_name", code))
        if pause:
            sleep(pause)
        if i % 50 == 0:
            log(f"  {i}/{len(todo)} looked up")

    total = len(todo)
    out["meta"]["heights"] = {
        "ranAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "looked_up": total,
        "found_with_height": with_height,
        "found_without_height": no_height,
        "not_found": len(unmatched),
    }
    out["generatedAt"] = out["meta"]["heights"]["ranAt"]

    pct = (100 * with_height / total) if total else 0.0
    log(
        f"Heights: {with_height}/{total} found ({pct:.0f}%), "
        f"{no_height} right person but no height listed, {len(unmatched)} not found."
    )
    if unmatched:
        log("Not found (first 40): " + ", ".join(unmatched[:40]))
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--limit", type=int, help="only look up the first N players (a trial run)")
    parser.add_argument("--only-missing", action="store_true", help="skip players that already have a height")
    parser.add_argument("--dry-run", action="store_true", help="print the report but do not write the file")
    parser.add_argument("--pause", type=float, default=0.25, help="seconds to wait between players")
    args = parser.parse_args()

    elements = latest_bootstrap()["elements"]
    existing = json.loads(OUT_FILE.read_text()) if OUT_FILE.exists() else {}
    result = run(
        elements,
        existing,
        http_fetch,
        only_missing=args.only_missing,
        limit=args.limit,
        pause=args.pause,
    )
    if args.dry_run:
        print("Dry run: nothing written.")
        return 0
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(json.dumps(result, indent=2, ensure_ascii=False, sort_keys=True) + "\n")
    print(f"Wrote {OUT_FILE.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
