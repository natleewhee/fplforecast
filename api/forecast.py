"""On-demand personal forecast for an arbitrary FPL team ID -- the "anyone
can use this with their own team" entry point. A Vercel Python Function,
unlike every other forecast in this app (built once daily for this app's own
team and served as static JSON): this runs scripts/compute_forecast.py's
same build_pool_context()/build_personal_forecast() live, per request, for
whichever team ID is asked for.

Deliberately the *same* two functions the daily cron uses, not a lighter
substitute -- the whole point is that a guest's forecast comes from the
identical model as the owner's, not a cheaper one. What differs is only
where the squad-specific inputs (picks, entry, history) come from: the
owner's daily cron reads them off disk (committed by scripts/snapshot.py);
this fetches them live from FPL's public API for whatever team ID was asked
for, the same way src/lib/liveBlend.ts's /api/live and /api/league routes
already do for the owner's own team.

No persistence, no git commits: this never touches data/overrides/ or
writes anything back to the repo. That stays the owner-only path
(src/app/api/transfers/route.ts) -- a guest's transfer note has nowhere
safe to go, so guests don't get one.

Bundles engine/ (and therefore pandas/numpy, ~114MB) plus a gzipped copy of
the model data (data-deploy/, built by scripts/compress_deploy_data.py at
deploy time -- see that file's docstring for why the data has to be
compressed for this to fit Vercel's 250MB unzipped function size limit).
Decompresses into /tmp once per warm container, not per request.

NOT verified against a live Vercel deployment from this environment (no
Vercel access here) -- flagging the same things api/solve.py's own docstring
does: cold-start latency (this one imports pandas/numpy, so worse than
solve.py's), the data-deploy/ decompression actually working under Vercel's
read-only-except-/tmp filesystem, and the overall bundle size actually
landing under the limit in practice, not just in this sandbox's estimate.
"""

from __future__ import annotations

import gzip
import json
import os
import shutil
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import parse_qs, urlparse

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

import scripts.compute_forecast as compute_forecast  # noqa: E402

FPL = "https://fantasy.premierleague.com/api"
DEPLOY_DATA_DIR = Path(_ROOT) / "data-deploy"
SCRATCH_DATA_DIR = Path("/tmp/fplforecast-data")

# A container can be reused across requests (a "warm" Lambda) -- only
# decompress once per container, not once per request.
_decompressed = False

# build_pool_context() is team-agnostic (feature frame + fitted model +
# every player's pool projection) and measured ~8s locally -- by far the
# most expensive step here. It only changes when target_gw changes (once a
# gameweek, when the bundled model data itself is redeployed), so a warm
# container reuses it across every guest request instead of refitting the
# model from scratch each time. Keyed by target_gw so a stale cache from
# before a redeploy never survives past the gameweek it was built for.
_cached_pool_ctx: dict | None = None
_cached_pool_ctx_gw: int | None = None


def _get_pool_context(bootstrap: dict, target_gw: int) -> dict:
    """Vercel's Hobby-tier Functions get a hard 10s wall clock regardless of
    this app's own maxDuration config, and build_pool_context() alone is
    ~8s -- too tight against that, on top of the FPL API round trips below.
    The daily cron (scripts/compute_forecast.py's main()) already computes
    this exact team-agnostic context once a day for this app's own
    forecast, so the deploy bundle ships that run's pickled output
    (compute_forecast.load_cached_pool_context()) and this only refits the
    model live as a fallback -- a missing/stale/version-mismatched cache
    (see that function's own docstring), never a silent behavior change."""
    global _cached_pool_ctx, _cached_pool_ctx_gw
    if _cached_pool_ctx is not None and _cached_pool_ctx_gw == target_gw:
        return _cached_pool_ctx

    pool_ctx = compute_forecast.load_cached_pool_context(target_gw)
    if pool_ctx is None:
        pool_ctx = compute_forecast.build_pool_context(bootstrap, target_gw)

    _cached_pool_ctx = pool_ctx
    _cached_pool_ctx_gw = target_gw
    return _cached_pool_ctx


def _ensure_data_decompressed() -> None:
    global _decompressed
    if _decompressed and SCRATCH_DATA_DIR.exists():
        return
    if SCRATCH_DATA_DIR.exists():
        shutil.rmtree(SCRATCH_DATA_DIR)
    for gz_path in DEPLOY_DATA_DIR.rglob("*.gz"):
        rel = gz_path.relative_to(DEPLOY_DATA_DIR)
        out_path = SCRATCH_DATA_DIR / rel.with_suffix("")  # drop the trailing .gz
        out_path.parent.mkdir(parents=True, exist_ok=True)
        with gzip.open(gz_path, "rb") as f_in, out_path.open("wb") as f_out:
            shutil.copyfileobj(f_in, f_out)
    compute_forecast.DATA_DIR = SCRATCH_DATA_DIR
    _decompressed = True


def _fpl_get(path: str) -> dict:
    req = urllib.request.Request(f"{FPL}{path}", headers={"User-Agent": "fplforecast-guest/1.0"})
    with urllib.request.urlopen(req, timeout=15) as res:
        return json.loads(res.read())


def build_forecast_for_team(team_id: int) -> tuple[int, dict]:
    """(status, payload) -- mirrors api/solve.py's testable request/response
    split. Fetches this team's own squad/history live, then runs the exact
    same build_pool_context()/build_personal_forecast() the daily cron uses
    against this app's shared, already-committed model data."""
    _ensure_data_decompressed()

    bootstrap = compute_forecast.load_bootstrap()
    if bootstrap is None:
        return 503, {"error": "no bootstrap-static snapshot bundled with this deploy"}

    finished = [e for e in bootstrap.get("events", []) if e.get("finished")]
    if not finished:
        return 503, {"error": "no finished gameweek yet this season -- nothing to forecast"}
    based_on_gw = max(e["id"] for e in finished)
    target_gw = compute_forecast.upcoming_gameweek(
        bootstrap, datetime.now(timezone.utc), fallback=based_on_gw + 1
    )

    try:
        entry = _fpl_get(f"/entry/{team_id}/")
        history = _fpl_get(f"/entry/{team_id}/history/")
        picks_payload = _fpl_get(f"/entry/{team_id}/event/{based_on_gw}/picks/")
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return 404, {"error": f"no FPL team found with ID {team_id}"}
        return 502, {"error": f"FPL API error: {exc}"}
    except urllib.error.URLError as exc:
        return 502, {"error": f"couldn't reach the FPL API: {exc}"}

    picks = picks_payload.get("picks", [])
    entry_history = picks_payload.get("entry_history", {})
    if not picks:
        return 422, {"error": f"team {team_id} has no picks recorded for GW{based_on_gw} yet"}
    squad_ids = [p["element"] for p in picks]

    pool_ctx = _get_pool_context(bootstrap, target_gw)
    forecast = compute_forecast.build_personal_forecast(
        bootstrap,
        pool_ctx,
        based_on_gw,
        picks,
        entry_history,
        squad_ids,
        overrides_applied=0,  # a guest has nowhere to persist a transfer override
        season_history=history,
    )
    forecast["teamName"] = entry.get("name")
    forecast["managerName"] = f"{entry.get('player_first_name', '')} {entry.get('player_last_name', '')}".strip()
    return 200, forecast


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        query = parse_qs(urlparse(self.path).query)
        raw_team_id = (query.get("teamId") or [""])[0]
        try:
            team_id = int(raw_team_id)
            if team_id <= 0:
                raise ValueError
        except ValueError:
            self._respond(400, {"error": "teamId must be a positive integer"})
            return

        try:
            status, payload = build_forecast_for_team(team_id)
        except Exception as exc:  # noqa: BLE001 -- an on-demand lookup should never 500 silently
            self._respond(502, {"error": f"forecast build failed: {exc}"})
            return
        self._respond(status, payload)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors_headers()
        self.end_headers()

    def _cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _respond(self, status: int, payload: dict):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self._cors_headers()
        self.end_headers()
        self.wfile.write(body)
