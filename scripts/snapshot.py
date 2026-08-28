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


def snapshot_bootstrap_static() -> None:
    payload = fetch(f"{FPL_BASE}/bootstrap-static/")
    n_players = len(payload.get("elements", []))
    if n_players < 500:
        raise RuntimeError(f"bootstrap-static returned only {n_players} players — schema change? aborting")
    path = save("bootstrap-static", payload)
    print(f"bootstrap-static: {n_players} players -> {path}")


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


def main() -> int:
    failures = []
    for name, fn in (
        ("bootstrap-static", snapshot_bootstrap_static),
        ("fixtures", snapshot_fixtures),
        ("entry", snapshot_entry),
    ):
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
