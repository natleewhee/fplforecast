"""Live squad solve for the "force keep / force remove a player" control
(2026-09-05 transfer-scenarios plan follow-up). A Vercel Python Function --
everything else in this repo is precomputed at forecast-build time and
served as static JSON (the plan's deliberate "the browser never solves
anything" call), but an arbitrary force-in/force-out pick can't be
precomputed for every possible player, so this is the one on-demand solve.

Reads the already-committed ``data/forecast/gw<N>.json`` for its pool/squad
(the same data ``scripts/compute_forecast.py`` bakes the precomputed
scenarios from) rather than recomputing the xP model -- this endpoint only
ever re-runs the ILP, never the model. It reimplements the small
``_scenario_to_dict``/``_player_ref``/``_scenario_weeks`` shaping helpers
from ``scripts/compute_forecast.py`` rather than importing that module,
specifically to avoid pulling pandas/numpy (which the ``engine`` package's
model code depends on transitively) into this lambda -- ``engine.optimise``
itself only needs ``pulp``, so that's the only third-party dependency this
function bundles. Keep these helpers in sync with compute_forecast.py's by
hand if that shape changes; tests/test_solve_api.py pins the contract.

NOT verified against a live Vercel deployment from this environment (no
Vercel access here) -- see the PR description for the specific things that
need checking after deploy: the CBC binary running under Vercel's Python
runtime, data/forecast/*.json being bundled via vercel.json's
``includeFiles``, and cold-start latency.
"""

from __future__ import annotations

import json
import os
import sys
from http.server import BaseHTTPRequestHandler

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from engine.optimise import ScenarioResult, solve_squad  # noqa: E402

MAX_FORCED_PLAYERS = 15  # can't force in/out more than a full squad


def _player_ref(pid: int, pool_by_id: dict) -> dict:
    p = pool_by_id.get(pid, {})
    return {
        "id": pid,
        "webName": p.get("webName"),
        "position": p.get("position"),
        "team": p.get("team"),
        "price": p.get("price"),
        "availability": p.get("availability"),
    }


def _scenario_weeks(result: ScenarioResult, pool_by_id: dict, target_gw: int) -> list[dict]:
    weeks = []
    for offset in range(result.horizon_gws):
        xi_ids = result.xi_by_gw[offset] if offset < len(result.xi_by_gw) else []
        captain_id = result.captain_by_gw[offset] if offset < len(result.captain_by_gw) else None
        players = []
        total = 0.0
        for pid in xi_ids:
            p = pool_by_id.get(pid, {})
            per_gw = p.get("perGameweek") or []
            xp = per_gw[offset] if offset < len(per_gw) else None
            opponents_by_gw = p.get("opponents") or []
            opponents = opponents_by_gw[offset] if offset < len(opponents_by_gw) else []
            is_captain = pid == captain_id
            players.append(
                {
                    "id": pid,
                    "webName": p.get("webName"),
                    "position": p.get("position"),
                    "team": p.get("team"),
                    "xp": xp,
                    "opponents": opponents,
                    "isCaptain": is_captain,
                }
            )
            if xp is not None:
                total += xp * (2 if is_captain else 1)
        weeks.append(
            {
                "targetGw": target_gw + offset,
                "players": players,
                "totalXp": round(total, 2),
            }
        )
    return weeks


def _scenario_to_dict(result: ScenarioResult, pool_by_id: dict, target_gw: int) -> dict:
    return {
        "squad": result.squad_ids,
        "xiByGw": result.xi_by_gw,
        "captainByGw": result.captain_by_gw,
        "horizonGws": result.horizon_gws,
        "points": result.points,
        "hitCost": result.hit_cost,
        "netPoints": result.net_points,
        "transfersIn": [_player_ref(pid, pool_by_id) for pid in result.transfers_in],
        "transfersOut": [_player_ref(pid, pool_by_id) for pid in result.transfers_out],
        "weeks": _scenario_weeks(result, pool_by_id, target_gw),
    }


def _load_forecast(gw: int) -> dict:
    path = os.path.join(_ROOT, "data", "forecast", f"gw{gw}.json")
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _pool_by_id_with_squad_fallback(forecast: dict) -> dict:
    pool_by_id = {p["id"]: p for p in forecast["pool"]}
    for card in forecast["squad"]["players"]:
        pool_by_id.setdefault(card["id"], card)
    return pool_by_id


def solve(body: dict) -> tuple[int, dict]:
    """Pure request -> (status, payload) so this is testable without an
    HTTP server in front of it."""
    try:
        forecast_gw = int(body["forecastGw"])
        horizon = int(body.get("horizon", 1))
        scenario_type = body.get("type", "transfer")
        force_in = [int(pid) for pid in (body.get("forceIn") or [])]
        force_out = [int(pid) for pid in (body.get("forceOut") or [])]
    except (KeyError, TypeError, ValueError) as exc:
        return 400, {"error": f"bad request: {exc}"}

    if horizon not in (1, 3, 5):
        return 400, {"error": "horizon must be 1, 3, or 5"}
    if scenario_type not in ("transfer", "freeHit", "wildcard"):
        return 400, {"error": "type must be transfer, freeHit, or wildcard"}
    if len(force_in) + len(force_out) > MAX_FORCED_PLAYERS:
        return 400, {"error": f"cannot force more than {MAX_FORCED_PLAYERS} players total"}
    if set(force_in) & set(force_out):
        return 400, {"error": "a player cannot be both forced in and forced out"}

    try:
        forecast = _load_forecast(forecast_gw)
    except FileNotFoundError:
        return 404, {"error": f"no forecast for GW{forecast_gw}"}

    pool = forecast["pool"]
    pool_by_id = _pool_by_id_with_squad_fallback(forecast)
    squad_ids = [p["id"] for p in forecast["squad"]["players"]]
    bank = forecast["squad"]["bank"]
    target_gw = forecast["targetGameweek"]

    if scenario_type == "transfer":
        result = solve_squad(
            pool,
            held=squad_ids,
            bank=bank,
            free_transfers=forecast["scenarios"]["freeTransfers"]["value"],
            horizon_gws=horizon,
            force_in=force_in,
            force_out=force_out,
        )
    else:
        if scenario_type == "freeHit":
            horizon = 1  # Free Hit is deliberately single-gameweek (KD in the plan)
        total_budget = bank + sum(
            pool_by_id[pid]["sellPrice"] for pid in squad_ids if pid in pool_by_id
        )
        result = solve_squad(
            pool,
            held=[],
            bank=total_budget,
            free_transfers=0,
            horizon_gws=horizon,
            unlimited=True,
            force_in=force_in,
            force_out=force_out,
        )

    if not result.feasible:
        return 422, {
            "error": (
                "No feasible squad satisfies these constraints -- the forced "
                "players may not fit the budget, formation, or 3-per-club limit."
            )
        }

    return 200, _scenario_to_dict(result, pool_by_id, target_gw)


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("content-length", 0) or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            body = json.loads(raw or b"{}")
        except json.JSONDecodeError:
            self._respond(400, {"error": "invalid JSON body"})
            return
        status, payload = solve(body)
        self._respond(status, payload)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors_headers()
        self.end_headers()

    def _cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _respond(self, status: int, payload: dict):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self._cors_headers()
        self.end_headers()
        self.wfile.write(body)
