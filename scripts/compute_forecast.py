"""Squad-anchored weekly view: your fifteen held players, each carrying the
model's and the composite baseline's suggested swap (better same-position,
similar-price alternative + 5-GW gain), or nothing when the held player is
already the best option.

Thin CLI wrapper. It loads the latest snapshots from ``data/``, builds the
shared feature frame once, calls the pure ``engine/`` library for the pool
ranking and the per-player projections, and writes ``data/forecast/gwNN.json``.
Both projections are always computed -- a backtest artifact is never required
(KD4, KTD8, AE3).
"""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from engine import baseline, model
from engine.config import MEANINGFUL_UPGRADE_GAP, ROLLING_WINDOW
from engine.features import POSITIONS, build_feature_frame
from engine.history import ColdStart, classify, load_history
from engine.model import ModelContext
from engine.squad import rank_against_pool, window_points
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
    """The out-of-sample summary, or ``None`` until at least one gameweek has
    actually been scored (an empty record reads as no record)."""
    path = DATA_DIR / "record" / "running.json"
    if not path.exists():
        return None
    summary = load_json(path).get("summary") or {}
    return summary if summary.get("gameweeksScored", 0) > 0 else None


def _player_card(pid: int, elements_by_id: dict, teams_by_id: dict) -> dict:
    el = elements_by_id.get(pid, {})
    return {
        "id": pid,
        "webName": el.get("web_name", "???"),
        "team": teams_by_id.get(el.get("team"), "???"),
        "position": POSITIONS.get(el.get("element_type"), "???"),
    }


def _enrich_card(
    pid: int,
    feature_frame,
    target_gw: int,
    ctx: ModelContext,
    window_pts: dict,
    elements_by_id: dict,
    teams_by_id: dict,
) -> dict:
    """A render-ready player card: identity, next-GW projected points, the
    5-GW window total the ranking used, cold-start flag, per-leg opponents,
    and the full calculation breakdown for the hover."""
    detail = model.project_detail(feature_frame.loc[pid], target_gw, ctx)
    card = _player_card(pid, elements_by_id, teams_by_id)
    card["projectedPoints"] = detail.get("points")
    card["windowPoints"] = round(window_pts[pid], 2) if window_pts.get(pid) is not None else None
    card["coldStart"] = detail["coldStart"]
    card["opponents"] = detail["opponents"]
    card["breakdown"] = detail
    return card


def _upgrade_for(gap_row: dict, alt_card_fn) -> dict | None:
    """One projection's suggestion for a squad player: the better same-position,
    similar-price alternative and the 5-GW gain -- or ``None`` when nothing in
    the pool beats the held player. ``meaningful`` marks a gain big enough to
    surface prominently (``MEANINGFUL_UPGRADE_GAP``); smaller gains are shown
    muted so the weekly view isn't a wall of marginal swaps."""
    alt_id = gap_row["bestAlternative"]
    if alt_id is None or gap_row["gapPoints"] <= 0:
        return None
    return {
        "alternative": alt_card_fn(alt_id),
        "gapPoints": gap_row["gapPoints"],
        "meaningful": gap_row["gapPoints"] >= MEANINGFUL_UPGRADE_GAP,
    }


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

    model_rows = {
        r["squadPlayer"]: r
        for r in rank_against_pool(
            squad_ids, pool_ids, model_window, price_by_id, position_by_id, minutes_risk_by_id
        )
    }
    baseline_rows = {
        r["squadPlayer"]: r
        for r in rank_against_pool(
            squad_ids, pool_ids, baseline_window, price_by_id, position_by_id, minutes_risk_by_id
        )
    }

    def alt_card(pid: int) -> dict:
        return _enrich_card(
            pid, feature_frame, target_gw, ctx, model_window, elements_by_id, teams_by_id
        )

    # Your squad is the anchor: the fifteen held players, each with the model's
    # and the baseline's suggested swap hanging off it (KD4/KTD8 -- both are
    # always computed; a backtest artifact is never required).
    players: list[dict] = []
    squad_window_total = 0.0
    captain = None
    captain_score = None
    for pid in squad_ids:
        if pid not in feature_frame.index:
            continue
        detail = model.project_detail(feature_frame.loc[pid], target_gw, ctx)
        card = _player_card(pid, elements_by_id, teams_by_id)
        card["projectedPoints"] = detail.get("points")
        card["windowPoints"] = round(model_window[pid], 2) if model_window.get(pid) is not None else None
        card["coldStart"] = detail["coldStart"]
        card["minutesRisk"] = bool(minutes_risk_by_id.get(pid, False))
        card["opponents"] = detail["opponents"]
        card["breakdown"] = detail
        card["modelUpgrade"] = _upgrade_for(model_rows[pid], alt_card) if pid in model_rows else None
        card["baselineUpgrade"] = (
            _upgrade_for(baseline_rows[pid], alt_card) if pid in baseline_rows else None
        )
        players.append(card)

        if model_window.get(pid) is not None:
            squad_window_total += model_window[pid]
        single_gw = detail.get("points")
        if not detail["coldStart"] and single_gw is not None and (
            captain_score is None or single_gw > captain_score
        ):
            captain, captain_score = card, single_gw

    if captain is not None:
        captain["isCaptain"] = True
    for card in players:
        card.setdefault("isCaptain", False)

    def _agree(card: dict) -> bool:
        mu, bu = card["modelUpgrade"], card["baselineUpgrade"]
        return bool(mu and bu and mu["alternative"]["id"] == bu["alternative"]["id"])

    def _meaningful(card: dict) -> bool:
        mu, bu = card["modelUpgrade"], card["baselineUpgrade"]
        return bool((mu and mu["meaningful"]) or (bu and bu["meaningful"]))

    upgrade_count = {
        "model": sum(1 for c in players if c["modelUpgrade"]),
        "baseline": sum(1 for c in players if c["baselineUpgrade"]),
        "agree": sum(1 for c in players if _agree(c)),
        "meaningful": sum(1 for c in players if _meaningful(c)),
    }

    forecast = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "basedOnGameweek": based_on_gw,
        "targetGameweek": target_gw,
        "rollingWindow": ROLLING_WINDOW,
        "overridesApplied": len(overrides),
        "squad": {"windowPoints": round(squad_window_total, 2), "players": players},
        "upgradeCount": upgrade_count,
        "captain": {"webName": captain["webName"], "id": captain["id"]} if captain else None,
        "runningRecord": load_running_record(),
    }

    out_dir = DATA_DIR / "forecast"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"gw{target_gw}.json"
    out_path.write_text(json.dumps(forecast, indent=2, sort_keys=True))
    print(f"forecast for GW{target_gw} (based on GW{based_on_gw} squad): -> {out_path}")
    print(
        f"upgrades — meaningful: {upgrade_count['meaningful']}, model: {upgrade_count['model']}, "
        f"baseline: {upgrade_count['baseline']}, agree: {upgrade_count['agree']}; captain: "
        f"{forecast['captain']['webName'] if forecast['captain'] else None}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
