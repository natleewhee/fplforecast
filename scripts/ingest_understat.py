"""Newcomer support: pull per-player season xG / xA / minutes from Understat
for the top-five European leagues, so a player signed from abroad with no
Premier League history can still be projected (a discounted cross-league rate,
see ``engine.newcomer``).

Understat's page scrape stopped working in 2026; this uses its AJAX endpoint
``main/getPlayersStats`` (POST ``league`` + ``season``, gzip response), with a
short delay between calls to stay under its rate limit. Output:

    data/understat/<league>/<season>.json  {"league", "season", "players": [...]}

The Championship (promoted-team players) has no Understat coverage -- those
newcomers fall back to the price-tier prior in ``engine.newcomer``.
"""

from __future__ import annotations

import gzip
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

from engine.config import UNDERSTAT_LEAGUES

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
UNDERSTAT_DIR = DATA_DIR / "understat"
ENDPOINT = "https://understat.com/main/getPlayersStats/"
REQUEST_DELAY_SECONDS = 4.0

_FIELDS = {
    "name": "player_name",
    "team": "team_title",
    "position": "position",
    "games": "games",
    "minutes": "time",
    "goals": "goals",
    "assists": "assists",
    "xg": "xG",
    "xa": "xA",
    "npxg": "npxG",
    "shots": "shots",
    "key_passes": "key_passes",
}
_NUMERIC = {"games", "minutes", "goals", "assists", "xg", "xa", "npxg", "shots", "key_passes"}


def understat_seasons(today: date | None = None) -> list[str]:
    """The current and previous Understat seasons (Understat labels a season by
    the calendar year it starts in)."""
    today = today or date.today()
    current = today.year if today.month >= 7 else today.year - 1
    return [str(current), str(current - 1)]


def fetch_players(league: str, season: str) -> list[dict]:
    body = urllib.parse.urlencode({"league": league, "season": season}).encode()
    req = urllib.request.Request(
        ENDPOINT,
        data=body,
        headers={
            "User-Agent": "Mozilla/5.0 fplforecast-understat/1.0",
            "X-Requested-With": "XMLHttpRequest",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "Accept": "application/json",
            "Referer": f"https://understat.com/league/{league}/{season}",
        },
    )
    with urllib.request.urlopen(req, timeout=45) as resp:
        raw = resp.read()
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    payload = json.loads(raw.decode("utf-8"))
    return payload.get("players") or payload.get("response", {}).get("players", [])


def normalise(players: list[dict]) -> list[dict]:
    out: list[dict] = []
    for player in players:
        row: dict = {}
        for key, source in _FIELDS.items():
            value = player.get(source)
            if key in _NUMERIC:
                try:
                    row[key] = float(value)
                except (TypeError, ValueError):
                    row[key] = 0.0
            else:
                row[key] = value
        out.append(row)
    return out


def write(league: str, season: str, players: list[dict]) -> Path:
    path = UNDERSTAT_DIR / league / f"{season}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps({"league": league, "season": season, "players": players}, indent=2, sort_keys=True))
    tmp.replace(path)
    return path


def main(seasons: list[str] | None = None, sleep=time.sleep) -> int:
    seasons = seasons or understat_seasons()
    written = 0
    for i, league in enumerate(UNDERSTAT_LEAGUES):
        for season in seasons:
            if i or season != seasons[0]:
                sleep(REQUEST_DELAY_SECONDS)  # rate limit
            try:
                players = normalise(fetch_players(league, season))
            except (urllib.error.URLError, ValueError) as exc:
                print(f"  {league}/{season}: unusable ({exc!r})", file=sys.stderr)
                continue
            if not players:
                print(f"  {league}/{season}: no players returned", file=sys.stderr)
                continue
            path = write(league, season, players)
            written += 1
            print(f"  {league}/{season}: {len(players)} players -> {path}")

    if written == 0:
        print("No Understat data ingested (endpoint down or rate-limited?)", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
