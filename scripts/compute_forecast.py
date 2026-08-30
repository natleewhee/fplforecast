"""Three-column weekly view (U8): the model's preferred moves, the composite
baseline's preferred moves, and the current squad's projected outcome.

Thin CLI wrapper. It loads the latest snapshots from ``data/``, builds the
shared feature frame once, calls the pure ``engine/`` library for the two
gap-ranking columns and the current-squad projection, and writes
``data/forecast/gwNN.json``. All three columns are always written, regardless
of any backtest artifact (KTD8, AE3).
"""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from engine import baseline, model
from engine.config import DISPLAY_GAP_ROWS, ROLLING_WINDOW
from engine.features import POSITIONS, build_feature_frame
from engine.history import ColdStart, classify, load_history
from engine.model import ModelContext
from engine.squad import rank_against_pool, top_gap_rows, window_points
from engine.strength import team_strength_table

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
TEAM_ID = os.environ.get("FPL_TEAM_ID", "1168513")  # config, not a login (R10)


def latest_file(subdir: str) -> Path | None:
    d = DATA_DIR / subdir
    if not d.exists():
        return None
    files = sorted(d.glob("*.json"))
    return files[-1] if files else None


def load_json(path: Path) -> dict:
    return json.loads(path.read_text())


def load_bootstrap() -> dict | None:
    path = latest_file("bootstrap-static")
    return load_json(path) if path else None


def load_event_live_history() -> list[dict]:
    """Current-season per-gameweek results, oldest first (KTD4)."""
    d = DATA_DIR / "event-live"
    if not d.exists():
        return []
    files = sorted(d.glob("gw*.json"), key=lambda p: int(p.stem.removeprefix("gw")))
    return [load_json(f) for f in files]


def load_fixtures() -> list[dict]:
    path = latest_file("fixtures")
    return load_json(path).get("fixtures", []) if path else []


def load_minutes_model() -> dict[str, dict]:
    path = latest_file("minutes-model")
    return load_json(path).get("predictions", {}) if path else {}


def load_entity_resolution() -> dict[str, dict]:
    path = latest_file("entity-resolution")
    return load_json(path).get("resolved", {}) if path else {}


def load_team_strength_seasons() -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    for teams_file in sorted((DATA_DIR / "history").glob("*/teams.json")):
        payload = load_json(teams_file)
        out[payload["season"]] = payload.get("teams", [])
    return out


def load_latest_picks() -> tuple[int, list[dict]] | None:
    picks_dir = DATA_DIR / f"picks-{TEAM_ID}"
    if not picks_dir.exists():
        return None
    gw_files = sorted(picks_dir.glob("gw*.json"), key=lambda p: int(p.stem.removeprefix("gw")))
    if not gw_files:
        return None
    latest = gw_files[-1]
    gw = int(latest.stem.removeprefix("gw"))
    return gw, load_json(latest).get("picks", [])


def load_overrides(gw: int) -> list[dict]:
    """Manual transfers recorded against ``gw``; ignored once picks have moved on."""
    path = DATA_DIR / "overrides" / "transfers.json"
    if not path.exists():
        return []
    data = load_json(path)
    if data.get("basedOnGw") != gw:
        print(
            f"overrides: ignoring stale overrides (recorded for GW{data.get('basedOnGw')}, "
            f"picks are GW{gw})"
        )
        return []
    return data.get("transfers", [])


def apply_overrides(squad_ids: list[int], overrides: list[dict]) -> list[int]:
    """Swap 'out' ids for 'in' ids. Not budget-checked -- a deferred risk."""
    ids = list(squad_ids)
    for override in overrides:
        if override["out"] in ids:
            ids[ids.index(override["out"])] = override["in"]
        else:
            print(f"overrides: 'out' player {override['out']} not in current squad, skipping")
    return ids


def load_running_record() -> dict | None:
    path = DATA_DIR / "record" / "running.json"
    if not path.exists():
        return None
    return load_json(path).get("summary")


def _player_card(pid: int, elements_by_id: dict, teams_by_id: dict) -> dict:
    el = elements_by_id.get(pid, {})
    return {
        "id": pid,
        "webName": el.get("web_name", "???"),
        "team": teams_by_id.get(el.get("team"), "???"),
        "position": POSITIONS.get(el.get("element_type"), "???"),
    }


def _enrich_gap_rows(
    rows: list[dict],
    feature_frame,
    target_gw: int,
    ctx: ModelContext,
    window_pts: dict,
    elements_by_id: dict,
    teams_by_id: dict,
) -> list[dict]:
    """Turn id-only gap rows into render-ready rows: player cards, next-GW
    projected points, the window total the ranking used, and the full
    calculation breakdown for the hover."""
    out: list[dict] = []
    for row in rows:
        enriched = {"gapPoints": row["gapPoints"], "minutesRisk": row["minutesRisk"]}
        for role in ("squadPlayer", "bestAlternative"):
            pid = row[role]
            if pid is None:
                enriched[role] = None
                continue
            detail = model.project_detail(feature_frame.loc[pid], target_gw, ctx)
            card = _player_card(pid, elements_by_id, teams_by_id)
            card["projectedPoints"] = detail.get("points")
            card["windowPoints"] = round(window_pts[pid], 2) if window_pts.get(pid) is not None else None
            card["coldStart"] = detail["coldStart"]
            card["opponents"] = detail["opponents"]
            card["breakdown"] = detail
            enriched[role] = card
        out.append(enriched)
    return out


def main() -> int:
    bootstrap = load_bootstrap()
    if bootstrap is None:
        print("No bootstrap-static snapshot yet — run scripts/snapshot.py first", file=sys.stderr)
        return 1

    picks_result = load_latest_picks()
    if picks_result is None:
        print("No squad picks snapshot yet (no finished gameweek) — nothing to forecast", file=sys.stderr)
        return 0

    based_on_gw, picks = picks_result
    target_gw = based_on_gw + 1

    elements_by_id = {el["id"]: el for el in bootstrap["elements"]}
    teams_by_id = {t["id"]: t["short_name"] for t in bootstrap["teams"]}

    overrides = load_overrides(based_on_gw)
    squad_ids = [p["element"] for p in picks]
    if overrides:
        squad_ids = apply_overrides(squad_ids, overrides)
        print(f"overrides: applied {len(overrides)} manual transfer(s)")

    resolved_map = load_entity_resolution()
    archive = load_history(DATA_DIR)

    def is_cold_start(pid: int) -> bool:
        return isinstance(classify(pid, resolved_map, archive.frame), ColdStart)

    feature_frame = build_feature_frame(
        bootstrap["elements"], load_event_live_history(), is_cold_start, ROLLING_WINDOW
    )

    ctx = ModelContext(
        fixtures=load_fixtures(),
        minutes_model=load_minutes_model(),
        elements_by_id=elements_by_id,
        teams_by_id=teams_by_id,
        team_strength=team_strength_table(load_team_strength_seasons()),
    )

    def model_fn(row, gw):
        return model.project(row, gw, ctx)

    def baseline_fn(row, _gw):
        return baseline.project(row)

    model_window = window_points(feature_frame, model_fn, target_gw)
    baseline_window = window_points(feature_frame, baseline_fn, target_gw)

    price_by_id = feature_frame["price"].to_dict()
    position_by_id = {
        pid: POSITIONS.get(int(row["element_type"]), "???")
        for pid, row in feature_frame.iterrows()
    }
    minutes_risk_by_id = {
        pid: model.minutes_risk_flag(row, ctx) for pid, row in feature_frame.iterrows()
    }
    # "the best *available* alternative" (R12): only players FPL lists as
    # available (not injured / suspended / loaned / out of the game).
    pool_ids = [
        pid for pid in feature_frame.index if elements_by_id.get(pid, {}).get("status") == "a"
    ]

    model_rows = rank_against_pool(
        squad_ids, pool_ids, model_window, price_by_id, position_by_id, minutes_risk_by_id
    )
    baseline_rows = rank_against_pool(
        squad_ids, pool_ids, baseline_window, price_by_id, position_by_id, minutes_risk_by_id
    )

    model_column = _enrich_gap_rows(
        top_gap_rows(model_rows, DISPLAY_GAP_ROWS), feature_frame, target_gw, ctx,
        model_window, elements_by_id, teams_by_id,
    )
    baseline_column = _enrich_gap_rows(
        top_gap_rows(baseline_rows, DISPLAY_GAP_ROWS), feature_frame, target_gw, ctx,
        baseline_window, elements_by_id, teams_by_id,
    )

    # Current-squad column: a direct model projection of the fifteen held
    # players -- a total plus per-player rows, not a pool ranking (KTD8, R11).
    current_players: list[dict] = []
    squad_window_total = 0.0
    captain = None
    captain_score = None
    for pid in squad_ids:
        if pid not in feature_frame.index:
            continue
        row = feature_frame.loc[pid]
        detail = model.project_detail(row, target_gw, ctx)
        card = _player_card(pid, elements_by_id, teams_by_id)
        card["projectedPoints"] = detail.get("points")
        card["coldStart"] = detail["coldStart"]
        card["minutesRisk"] = bool(minutes_risk_by_id.get(pid, False))
        card["opponents"] = detail["opponents"]
        card["breakdown"] = detail
        current_players.append(card)

        if model_window.get(pid) is not None:
            squad_window_total += model_window[pid]
        single_gw = detail.get("points")
        if not detail["coldStart"] and single_gw is not None and (
            captain_score is None or single_gw > captain_score
        ):
            captain, captain_score = card, single_gw

    forecast = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "basedOnGameweek": based_on_gw,
        "targetGameweek": target_gw,
        "rollingWindow": ROLLING_WINDOW,
        "overridesApplied": len(overrides),
        "columns": {
            "model": model_column,
            "baseline": baseline_column,
            "currentSquad": {
                "windowPoints": round(squad_window_total, 2),
                "players": current_players,
            },
        },
        "captain": (
            {"webName": captain["webName"], "id": captain["id"], "column": "model"}
            if captain
            else None
        ),
        "runningRecord": load_running_record(),
    }

    out_dir = DATA_DIR / "forecast"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"gw{target_gw}.json"
    out_path.write_text(json.dumps(forecast, indent=2, sort_keys=True))
    print(f"forecast for GW{target_gw} (based on GW{based_on_gw} squad): -> {out_path}")
    print(
        f"model upgrades: {len(model_column)}, baseline upgrades: {len(baseline_column)}, "
        f"captain: {forecast['captain']['webName'] if forecast['captain'] else None}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
