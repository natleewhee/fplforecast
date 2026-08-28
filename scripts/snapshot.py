"""Step zero: snapshot FPL's mutable-in-place endpoints before they overwrite history.

bootstrap-static, fixtures and entry/{id} are live state with no history endpoint.
This script fetches each one and commits it under data/<endpoint>/<UTC date>.json.
No model, no app, no database — just a dated JSON archive.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

FPL_BASE = "https://fantasy.premierleague.com/api"
TEAM_ID = os.environ.get("FPL_TEAM_ID", "1168513")
DATA_DIR = Path(__file__).resolve().parent.parent / "data"
TODAY = datetime.now(timezone.utc).strftime("%Y-%m-%d")


def fetch(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "fplforecast-snapshotter/1.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp)


def save(endpoint_dir: str, payload: dict) -> Path:
    out_dir = DATA_DIR / endpoint_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{TODAY}.json"
    out_path.write_text(json.dumps(payload, indent=2, sort_keys=True))
    return out_path


def snapshot_bootstrap_static() -> dict:
    payload = fetch(f"{FPL_BASE}/bootstrap-static/")
    n_players = len(payload.get("elements", []))
    if n_players < 500:
        raise RuntimeError(f"bootstrap-static returned only {n_players} players — schema change? aborting")
    path = save("bootstrap-static", payload)
    print(f"bootstrap-static: {n_players} players -> {path}")
    return payload


def snapshot_fixtures() -> None:
    payload = fetch(f"{FPL_BASE}/fixtures/")
    if not isinstance(payload, list) or len(payload) < 300:
        raise RuntimeError(f"fixtures returned {len(payload) if isinstance(payload, list) else 'non-list'} — schema change? aborting")
    path = save("fixtures", {"fixtures": payload})
    print(f"fixtures: {len(payload)} fixtures -> {path}")


def snapshot_entry() -> None:
    if not TEAM_ID:
        print("entry: no FPL_TEAM_ID set, skipping")
        return
    try:
        payload = fetch(f"{FPL_BASE}/entry/{TEAM_ID}/")
    except urllib.error.HTTPError as exc:
        print(f"entry: fetch failed ({exc}) — non-fatal, continuing")
        return
    path = save(f"entry-{TEAM_ID}", payload)
    print(f"entry {TEAM_ID}: -> {path}")


def snapshot_history() -> None:
    """My chip usage and season-by-season history. Mutates as chips get played,
    so dated like bootstrap-static rather than keyed by gameweek."""
    if not TEAM_ID:
        print("history: no FPL_TEAM_ID set, skipping")
        return
    try:
        payload = fetch(f"{FPL_BASE}/entry/{TEAM_ID}/history/")
    except urllib.error.HTTPError as exc:
        print(f"history: fetch failed ({exc}) — non-fatal, continuing")
        return
    path = save(f"history-{TEAM_ID}", payload)
    print(f"history {TEAM_ID}: -> {path}")


def finished_gameweeks(bootstrap: dict) -> list[int]:
    return sorted(e["id"] for e in bootstrap.get("events", []) if e.get("finished"))


def snapshot_event_live(gw: int) -> None:
    """Per-GW live points, keyed by gameweek not date — once finished it stops changing."""
    out_path = DATA_DIR / "event-live" / f"gw{gw}.json"
    if out_path.exists():
        return
    payload = fetch(f"{FPL_BASE}/event/{gw}/live/")
    if not payload.get("elements"):
        raise RuntimeError(f"event/{gw}/live returned no elements — schema change? aborting")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, indent=2, sort_keys=True))
    print(f"event-live gw{gw}: -> {out_path}")


def snapshot_event_live_history(bootstrap: dict) -> None:
    gws = finished_gameweeks(bootstrap)
    if not gws:
        print("event-live: no finished gameweeks yet, skipping")
        return
    for gw in gws:
        snapshot_event_live(gw)


def snapshot_picks(bootstrap: dict) -> None:
    """My squad. Pre-deadline picks need auth cookies we don't have — only the last
    completed gameweek's picks are public. Keyed by gameweek, not date."""
    if not TEAM_ID:
        print("picks: no FPL_TEAM_ID set, skipping")
        return
    gws = finished_gameweeks(bootstrap)
    if not gws:
        print("picks: no finished gameweeks yet, skipping")
        return
    gw = gws[-1]
    out_path = DATA_DIR / f"picks-{TEAM_ID}" / f"gw{gw}.json"
    if out_path.exists():
        return
    try:
        payload = fetch(f"{FPL_BASE}/entry/{TEAM_ID}/event/{gw}/picks/")
    except urllib.error.HTTPError as exc:
        print(f"picks: fetch failed ({exc}) — non-fatal, continuing")
        return
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, indent=2, sort_keys=True))
    print(f"picks gw{gw}: -> {out_path}")


def main() -> int:
    failures = []
    bootstrap: dict | None = None
    try:
        bootstrap = snapshot_bootstrap_static()
    except Exception as exc:  # noqa: BLE001
        print(f"bootstrap-static: FAILED - {exc}", file=sys.stderr)
        failures.append("bootstrap-static")

    steps: list[tuple[str, object]] = [("fixtures", snapshot_fixtures)]
    if bootstrap is not None:
        steps += [
            ("entry", snapshot_entry),
            ("history", snapshot_history),
            ("event-live", lambda: snapshot_event_live_history(bootstrap)),
            ("picks", lambda: snapshot_picks(bootstrap)),
        ]
    else:
        print("bootstrap-static unavailable — skipping entry/event-live/picks", file=sys.stderr)

    for name, fn in steps:
        try:
            fn()
        except Exception as exc:  # noqa: BLE001 - fail loudly per-endpoint, don't let one kill the others
            print(f"{name}: FAILED - {exc}", file=sys.stderr)
            failures.append(name)

    if failures:
        print(f"Snapshot completed with failures: {failures}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
