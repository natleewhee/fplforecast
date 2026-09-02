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

from engine import baseline, model, newcomer
from engine.config import (
    EARLY_SEASON_GAP_RAMP,
    MEANINGFUL_UPGRADE_GAP,
    PAR_BUFFER_POINTS,
    PAR_BUFFER_PROVISIONAL_POINTS,
    PAR_MARGIN_MIN_GAMEWEEKS,
    ROLLING_WINDOW,
    SETTLE_GAMEWEEK,
)
from engine.features import POSITIONS, build_feature_frame, team_fixtures
from engine.history import ColdStart, classify, load_history
from engine.model import ModelContext
from engine.squad import (
    best_xi,
    rank_against_pool,
    top_alternatives,
    window_points,
    window_points_by_gw,
)
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


def load_understat_seasons() -> dict[str, dict[str, list[dict]]]:
    out: dict[str, dict[str, list[dict]]] = {}
    for path in sorted((DATA_DIR / "understat").glob("*/*.json")):
        payload = load_json(path)
        out.setdefault(payload["league"], {})[payload["season"]] = payload.get("players", [])
    return out


def load_latest_picks() -> tuple[int, list[dict], dict] | None:
    picks_dir = DATA_DIR / f"picks-{TEAM_ID}"
    if not picks_dir.exists():
        return None
    gw_files = sorted(picks_dir.glob("gw*.json"), key=lambda p: int(p.stem.removeprefix("gw")))
    if not gw_files:
        return None
    latest = gw_files[-1]
    data = load_json(latest)
    gw = int(latest.stem.removeprefix("gw"))
    return gw, data.get("picks", []), data.get("entry_history", {})


def load_entry_history() -> dict:
    """The team's season history snapshot: per-gameweek points/rank/value under
    ``current`` and finished-season summaries under ``past``."""
    d = DATA_DIR / f"history-{TEAM_ID}"
    if not d.exists():
        return {}
    files = sorted(d.glob("*.json"))
    return load_json(files[-1]) if files else {}


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


def _gw_model_vs_baseline(gw: int) -> dict | None:
    """This gameweek's row from the out-of-sample record: model/baseline XI
    points if it was scored, otherwise its status (``no_prediction``)."""
    path = DATA_DIR / "record" / "running.json"
    if not path.exists():
        return None
    for entry in load_json(path).get("entries", []):
        if entry.get("gameweek") != gw:
            continue
        if "modelPoints" in entry:
            return {
                "model": entry["modelPoints"],
                "baseline": entry["baselinePoints"],
                "delta": entry["delta"],
            }
        return {"status": entry.get("status", "pending")}
    return None


def build_history(hist: dict) -> dict | None:
    """The season-so-far record for the history view: one row per finished
    gameweek (points, bench, rank, hits, team value + the model/baseline row
    if scored) and a summary line per completed past season."""
    current = hist.get("current") or []
    past = hist.get("past") or []
    if not current and not past:
        return None
    gameweeks = []
    for e in current:
        gw = e.get("event")
        gameweeks.append(
            {
                "gameweek": gw,
                "points": e.get("points"),
                "benchPoints": e.get("points_on_bench"),
                "totalPoints": e.get("total_points"),
                "rank": e.get("rank"),
                "overallRank": e.get("overall_rank"),
                "transfers": e.get("event_transfers", 0),
                "hit": e.get("event_transfers_cost", 0),
                "teamValue": round((e.get("value") or 0) / 10, 1),
                "modelVsBaseline": _gw_model_vs_baseline(gw) if gw else None,
            }
        )
    seasons = [
        {
            "season": p.get("season_name"),
            "totalPoints": p.get("total_points"),
            "rank": p.get("rank"),
        }
        for p in past
    ]
    return {"gameweeks": gameweeks, "seasons": seasons}


def last_gameweek_review(bootstrap: dict, elements_by_id: dict) -> dict | None:
    """The 'decide -> watch -> learn' card: how the held squad actually did in
    the most recent finished gameweek, plus the model-vs-baseline row once that
    gameweek has been scored. ``None`` until a finished gameweek's picks have
    been snapshotted."""
    finished = [e for e in bootstrap.get("events", []) if e.get("finished")]
    if not finished:
        return None
    event = max(finished, key=lambda e: e["id"])
    gw = event["id"]

    picks_path = DATA_DIR / f"picks-{TEAM_ID}" / f"gw{gw}.json"
    if not picks_path.exists():
        return None
    pdata = load_json(picks_path)
    entry_history = pdata.get("entry_history", {})
    picks = pdata.get("picks", [])

    live_path = DATA_DIR / "event-live" / f"gw{gw}.json"
    actual_by_id: dict[int, int | None] = {}
    if live_path.exists():
        for el in load_json(live_path).get("elements", []):
            actual_by_id[el["id"]] = (el.get("stats") or {}).get("total_points")

    def _cap(flag: str) -> dict | None:
        pick = next((p for p in picks if p.get(flag)), None)
        if pick is None:
            return None
        el = elements_by_id.get(pick["element"], {})
        return {
            "webName": el.get("web_name", "???"),
            "actual": actual_by_id.get(pick["element"]),
            "multiplier": pick.get("multiplier", 2 if flag == "is_captain" else 1),
        }

    return {
        "gameweek": gw,
        "dataChecked": bool(event.get("data_checked")),
        "xiPoints": entry_history.get("points"),  # net of hits, captain doubled
        "benchPoints": entry_history.get("points_on_bench"),
        "transfersCost": entry_history.get("event_transfers_cost", 0),
        "overallRank": entry_history.get("overall_rank"),
        "captain": _cap("is_captain"),
        "viceCaptain": _cap("is_vice_captain"),
        "modelVsBaseline": _gw_model_vs_baseline(gw),
    }


def _player_card(pid: int, elements_by_id: dict, teams_by_id: dict) -> dict:
    el = elements_by_id.get(pid, {})
    return {
        "id": pid,
        "webName": el.get("web_name", "???"),
        "team": teams_by_id.get(el.get("team"), "???"),
        "position": POSITIONS.get(el.get("element_type"), "???"),
        "elementType": el.get("element_type"),
        "price": round((el.get("now_cost") or 0) / 10, 1),
    }


def par_margin(
    current: list[dict], events: list[dict], min_gameweeks: int = PAR_MARGIN_MIN_GAMEWEEKS
) -> tuple[float, bool]:
    """The manager's hold-rank margin: the median of ``own points − that
    gameweek's average`` over their completed gameweeks. Below ``min_gameweeks``
    of evidence it is ``0.0`` and the second return is ``True`` (provisional),
    so the live tracker shows the wider provisional buffer (KTD2)."""
    avg_by_event = {
        e.get("id"): e.get("average_entry_score")
        for e in events
        if e.get("finished") and e.get("average_entry_score") is not None
    }
    deltas = sorted(
        entry["points"] - avg_by_event[entry["event"]]
        for entry in current
        if entry.get("event") in avg_by_event and entry.get("points") is not None
    )
    if len(deltas) < min_gameweeks:
        return 0.0, True
    mid = len(deltas) // 2
    median = deltas[mid] if len(deltas) % 2 else (deltas[mid - 1] + deltas[mid]) / 2
    return float(median), False


def effective_gap(target_gw: int) -> float:
    """The 5-GW gain a swap must clear to be surfaced as a recommendation.
    Raised early in the season, when two gameweeks of data can throw up a big
    but meaningless gap; back to ``MEANINGFUL_UPGRADE_GAP`` by ``SETTLE_GAMEWEEK``."""
    weeks_early = max(0, SETTLE_GAMEWEEK - target_gw)
    return MEANINGFUL_UPGRADE_GAP * (1 + EARLY_SEASON_GAP_RAMP * weeks_early)


def archive_rates(resolved_map: dict, history_frame) -> dict[int, dict]:
    """``{current_player_id: {xg90, xa90, dc90}}`` from prior seasons -- the
    deepest slice of the model's per-90 rate blend. Rates are per historical id,
    averaged over the seasons a current player resolves to."""
    if history_frame is None or getattr(history_frame, "empty", True):
        return {}

    df = history_frame.reset_index()
    by_hist: dict[int, dict] = {}
    for hist_id, sub in df.groupby("historical_id"):
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
        by_hist[int(hist_id)] = rec

    out: dict[int, dict] = {}
    for current_id, entry in resolved_map.items():
        recs = [by_hist[h] for h in entry.get("bySeason", {}).values() if h in by_hist]
        if not recs:
            continue
        agg: dict[str, float] = {}
        for key in ("xg90", "xa90", "dc90"):
            vals = [r[key] for r in recs if key in r]
            if vals:
                agg[key] = sum(vals) / len(vals)
        out[int(current_id)] = agg
    return out


def upcoming_gameweek(bootstrap: dict, now: datetime, fallback: int) -> int:
    """The gameweek to forecast: the first whose deadline is still in the
    future, so the view rolls forward on its own as gameweeks pass."""
    for event in bootstrap.get("events", []):
        deadline = datetime.fromisoformat(event["deadline_time"].replace("Z", "+00:00"))
        if deadline > now:
            return event["id"]
    return fallback


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
    card["provisional"] = detail.get("provisional", False)
    card["rateSource"] = detail.get("rateSource", "history")
    card["opponents"] = detail["opponents"]
    card["breakdown"] = detail
    return card


def _affordable(alt_price, sell_price: float, bank: float) -> bool | None:
    """Whether the swap fits the budget: bank + what the held player sells for
    must cover the alternative's price. ``None`` when a price is unknown."""
    if alt_price is None:
        return None
    return (bank + sell_price) >= alt_price - 1e-6


def _upgrade_for(gap_row: dict, alt_card_fn, gap_bar: float, sell_price: float, bank: float) -> dict | None:
    """One projection's suggestion for a squad player: the better same-position,
    similar-price alternative, the 5-GW gain, whether it fits the budget, and
    whether the gain clears the (season-scaled) ``gap_bar``."""
    alt_id = gap_row["bestAlternative"]
    if alt_id is None or gap_row["gapPoints"] <= 0:
        return None
    card = alt_card_fn(alt_id)
    return {
        "alternative": card,
        "gapPoints": gap_row["gapPoints"],
        "meaningful": gap_row["gapPoints"] >= gap_bar,
        "affordable": _affordable(card.get("price"), sell_price, bank),
    }


def main(now: datetime | None = None) -> int:
    now = now or datetime.now(timezone.utc)

    bootstrap = load_bootstrap()
    if bootstrap is None:
        print("No bootstrap-static snapshot yet — run scripts/snapshot.py first", file=sys.stderr)
        return 1

    picks_result = load_latest_picks()
    if picks_result is None:
        print("No squad picks snapshot yet (no finished gameweek) — nothing to forecast", file=sys.stderr)
        return 0

    based_on_gw, picks, entry_history = picks_result
    target_gw = upcoming_gameweek(bootstrap, now, fallback=based_on_gw + 1)
    bank = round((entry_history.get("bank") or 0) / 10, 1)
    gap_bar = effective_gap(target_gw)

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

    cold_start_ids = {el["id"] for el in bootstrap["elements"] if is_cold_start(el["id"])}
    nc_rates = newcomer.newcomer_rates(
        bootstrap["elements"],
        cold_start_ids,
        newcomer.understat_index(load_understat_seasons()),
        newcomer.price_curve(bootstrap["elements"]),
    )

    feature_frame = build_feature_frame(
        bootstrap["elements"],
        load_event_live_history(),
        is_cold_start,
        ROLLING_WINDOW,
        archive_rates=archive_rates(resolved_map, archive.frame),
        newcomer_rates=nc_rates,
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
    model_window_by_gw = window_points_by_gw(feature_frame, model_fn, target_gw)
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
    for pid in squad_ids:
        if pid not in feature_frame.index:
            continue
        detail = model.project_detail(feature_frame.loc[pid], target_gw, ctx)
        card = _player_card(pid, elements_by_id, teams_by_id)
        sell_price = card["price"]  # public data has no purchase price; assume bought at today's
        card["sellPrice"] = sell_price
        card["projectedPoints"] = detail.get("points")
        card["windowPoints"] = round(model_window[pid], 2) if model_window.get(pid) is not None else None
        card["provisional"] = detail.get("provisional", False)
        card["rateSource"] = detail.get("rateSource", "history")
        card["minutesRisk"] = bool(minutes_risk_by_id.get(pid, False))
        card["opponents"] = detail["opponents"]
        card["breakdown"] = detail
        card["modelUpgrade"] = (
            _upgrade_for(model_rows[pid], alt_card, gap_bar, sell_price, bank)
            if pid in model_rows
            else None
        )
        card["baselineUpgrade"] = (
            _upgrade_for(baseline_rows[pid], alt_card, gap_bar, sell_price, bank)
            if pid in baseline_rows
            else None
        )
        card["alternatives"] = [
            {
                **alt_card(a["id"]),
                "gapPoints": a["gapPoints"],
                "affordable": _affordable(alt_card(a["id"]).get("price"), sell_price, bank),
            }
            for a in top_alternatives(pid, pool_ids, model_window, price_by_id, position_by_id, limit=3)
            if a["gapPoints"] is None or a["gapPoints"] >= gap_bar
        ]
        players.append(card)

        if model_window.get(pid) is not None:
            squad_window_total += model_window[pid]

    for card in players:
        card["isCaptain"] = False
        card["isViceCaptain"] = False

    # Captain / vice on the single upcoming gameweek. A provisional player (no
    # PL history, projection is a prior) is never handed the armband.
    ranked = sorted(
        (c for c in players if not c["provisional"] and c["projectedPoints"] is not None),
        key=lambda c: c["projectedPoints"],
        reverse=True,
    )
    captain = ranked[0] if ranked else None
    vice = ranked[1] if len(ranked) > 1 else None
    if captain is not None:
        captain["isCaptain"] = True
    if vice is not None:
        vice["isViceCaptain"] = True

    captain_edge = None
    if captain is not None and vice is not None:
        delta = captain["projectedPoints"] - vice["projectedPoints"]
        label = "coin-flip" if delta < 0.5 else "slight edge" if delta < 1.5 else "clear edge"
        captain_edge = {"points": round(delta, 2), "label": label}

    # Recommended XI vs bench for the upcoming gameweek (KTD8-style: a direct
    # projection of the held squad, best legal formation by projected points).
    xi_input = [
        {
            "id": c["id"],
            "element_type": c["elementType"] or 4,
            "projected": c["projectedPoints"] if c["projectedPoints"] is not None else -1.0,
        }
        for c in players
    ]
    starting, bench = best_xi(xi_input)
    starting_ids = [p["id"] for p in starting]
    bench_ids = [p["id"] for p in bench]
    for c in players:
        c["role"] = "start" if c["id"] in starting_ids else "bench"

    # Headline: what this XI is projected to score next gameweek, captain
    # doubled -- and how that compares to leaving last week's XI untouched and
    # to the lineup the composite baseline would pick from the same fifteen.
    card_by_id = {c["id"]: c for c in players}

    def _xi_points(ids, captain_id) -> float:
        total = sum((card_by_id[i]["projectedPoints"] or 0.0) for i in ids if i in card_by_id)
        cap = card_by_id.get(captain_id)
        if cap and cap["projectedPoints"]:
            total += cap["projectedPoints"]  # the captain's points count twice
        return total

    model_xi_points = _xi_points(starting_ids, captain["id"] if captain else None)

    prev_start_ids = [p["element"] for p in picks if p.get("position", 99) <= 11]
    prev_captain_id = next((p["element"] for p in picks if p.get("is_captain")), None)
    no_change_points = _xi_points(prev_start_ids or starting_ids, prev_captain_id)

    bl_starting, bl_bench = best_xi(
        [
            {
                "id": c["id"],
                "element_type": c["elementType"] or 4,
                "projected": baseline_window.get(c["id"]) or -1.0,
            }
            for c in players
        ]
    )
    bl_start_ids = [p["id"] for p in bl_starting]
    bl_bench_ids = [p["id"] for p in bl_bench]
    bl_captain_id = max(
        bl_start_ids, key=lambda i: baseline_window.get(i) or -1e9, default=None
    )
    baseline_xi_points = _xi_points(bl_start_ids, bl_captain_id)

    # "Your XI": last week's lineup, untouched -- the do-nothing baseline the
    # toggle lets you compare the model's and the composite's picks against.
    your_start_ids = [i for i in prev_start_ids if i in card_by_id]
    your_bench_ids = [i for i in squad_ids if i in card_by_id and i not in your_start_ids]
    if len(your_start_ids) != 11:  # picks missing / overridden -- fall back
        your_start_ids, your_bench_ids = starting_ids, bench_ids
        your_captain_id = captain["id"] if captain else None
    else:
        your_captain_id = prev_captain_id

    next_gw = {
        "points": round(model_xi_points, 1),
        "deltaVsNoChange": round(model_xi_points - no_change_points, 1),
        "deltaVsBaselineXi": round(model_xi_points - baseline_xi_points, 1),
    }

    # How much the model's and the baseline's lineups actually overlap -- the
    # trust signal KD2 wanted on screen (F4), companion to the XI toggle.
    lineup_agreement = len(set(starting_ids) & set(bl_start_ids))

    # One-line "why" on every held player, so a tight call (benching a premium
    # keeper on 0.2) reads as a decision, not a bug (F6).
    xi_cut = min(
        (
            card_by_id[i]["projectedPoints"]
            for i in starting_ids
            if card_by_id[i].get("projectedPoints") is not None
        ),
        default=None,
    )

    def _opp_str(card: dict) -> str:
        legs = card.get("opponents") or []
        if not legs:
            return "blank gameweek"
        leg = legs[0]
        return f"{'v' if leg.get('wasHome') else '@'}{leg.get('team', '?')} (FDR {leg.get('fdrRating', '-')})"

    for c in players:
        pp = c.get("projectedPoints")
        pps = f"{pp:.1f}" if pp is not None else "—"
        if c["isCaptain"]:
            if captain_edge and vice is not None:
                c["rationale"] = (
                    f"{pps} proj — {captain_edge['label']}, "
                    f"+{captain_edge['points']:.1f} on {vice['webName']}"
                )
            else:
                c["rationale"] = f"{pps} proj — clear top score"
        elif c["isViceCaptain"]:
            c["rationale"] = f"{pps} proj — next best after {captain['webName']}"
        elif c["role"] == "start":
            c["rationale"] = f"{pps} proj — {_opp_str(c)}"
        else:
            cut = f", under the {xi_cut:.1f} XI cut" if xi_cut is not None else ""
            c["rationale"] = f"{pps} proj{cut} — {_opp_str(c)}"

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

    # Suggested XI for every gameweek in the rolling window, not just the next
    # one: same fifteen held players, best legal formation and captain for that
    # gameweek's fixtures. Player identity (name/team/price) is carried once on
    # ``squad.players``; these rows are keyed by id.
    et_by_id = {c["id"]: (c["elementType"] or 4) for c in players}
    upcoming = []
    for gw in range(target_gw, target_gw + ROLLING_WINDOW):
        gw_players = []
        for pid in squad_ids:
            if pid not in feature_frame.index:
                continue
            d = model.project_detail(feature_frame.loc[pid], gw, ctx)
            gw_players.append(
                {
                    "id": pid,
                    "projectedPoints": d.get("points"),
                    "provisional": d.get("provisional", False),
                    "minutesRisk": bool(minutes_risk_by_id.get(pid, False)),
                    "opponents": [
                        {
                            "team": o.get("team"),
                            "wasHome": o.get("wasHome"),
                            "fdrRating": o.get("fdrRating"),
                        }
                        for o in d.get("opponents", [])
                    ],
                }
            )
        pts_by_id = {p["id"]: p["projectedPoints"] for p in gw_players}
        gw_start, gw_benched = best_xi(
            [
                {
                    "id": p["id"],
                    "element_type": et_by_id.get(p["id"], 4),
                    "projected": p["projectedPoints"] if p["projectedPoints"] is not None else -1.0,
                }
                for p in gw_players
            ]
        )
        gw_start_ids = [p["id"] for p in gw_start]
        gw_bench_ids = [p["id"] for p in gw_benched]
        gw_cap_rank = sorted(
            (
                p
                for p in gw_players
                if p["id"] in gw_start_ids
                and not p["provisional"]
                and p["projectedPoints"] is not None
            ),
            key=lambda p: p["projectedPoints"],
            reverse=True,
        )
        gw_cap = gw_cap_rank[0]["id"] if gw_cap_rank else None
        gw_vice = gw_cap_rank[1]["id"] if len(gw_cap_rank) > 1 else None
        gw_total = sum((pts_by_id.get(i) or 0.0) for i in gw_start_ids) + (
            pts_by_id.get(gw_cap) or 0.0
        )
        upcoming.append(
            {
                "gameweek": gw,
                "points": round(gw_total, 1),
                "startingXi": gw_start_ids,
                "bench": gw_bench_ids,
                "captainId": gw_cap,
                "viceCaptainId": gw_vice,
                "players": gw_players,
            }
        )

    # Whole-pool five-gameweek projections for the pre-deadline planning table
    # (R9, R10, R14). Opponent legs come straight from the fixture list -- no
    # per-pool-player model evaluation (KTD3).
    def _pool_opponents(club_team_id: int) -> list[list[dict]]:
        legs_by_gw: list[list[dict]] = []
        for gw in range(target_gw, target_gw + ROLLING_WINDOW):
            legs = team_fixtures(club_team_id, gw, ctx.fixtures)
            legs_by_gw.append(
                [
                    {
                        "team": teams_by_id.get(leg["opponent"], "???"),
                        "wasHome": leg["was_home"],
                        "fdrRating": leg["difficulty"],
                    }
                    for leg in legs
                ]
            )
        return legs_by_gw

    pool = []
    for pid in pool_ids:
        el = elements_by_id.get(pid, {})
        per_gw = model_window_by_gw.get(pid)
        if per_gw is None:
            continue
        pool.append(
            {
                "id": pid,
                "webName": el.get("web_name", "???"),
                "team": teams_by_id.get(el.get("team"), "???"),
                "elementType": el.get("element_type"),
                "position": POSITIONS.get(el.get("element_type"), "???"),
                "price": round((el.get("now_cost") or 0) / 10, 1),
                "selectedByPercent": float(el.get("selected_by_percent") or 0),
                "form": float(el.get("form") or 0),
                "perGameweek": [round(v, 2) for v in per_gw],
                "total": round(sum(per_gw), 2),
                "opponents": _pool_opponents(el.get("team")),
            }
        )

    # Per-component expected-points breakdown for the held fifteen, target
    # gameweek only -- the live tracker decays attacking value on the clock and
    # re-derives clean-sheet from the scoreline (KTD3, KTD6).
    squad_components = {}
    for pid in squad_ids:
        if pid not in feature_frame.index:
            continue
        detail = model.project_detail(feature_frame.loc[pid], target_gw, ctx)
        squad_components[str(pid)] = detail.get("components", {})

    # Baked hold-rank margin for the live tracker's par score (KTD2).
    entry_history = load_entry_history()
    par_hold_margin, margin_provisional = par_margin(
        entry_history.get("current") or [], bootstrap.get("events") or []
    )

    forecast = {
        "generatedAt": now.isoformat(),
        "basedOnGameweek": based_on_gw,
        "targetGameweek": target_gw,
        "rollingWindow": ROLLING_WINDOW,
        "overridesApplied": len(overrides),
        "squad": {
            "windowPoints": round(squad_window_total, 2),
            "players": players,
            "startingXi": starting_ids,
            "bench": bench_ids,
            "baselineXi": bl_start_ids,
            "baselineBench": bl_bench_ids,
            "baselineCaptainId": bl_captain_id,
            "yourXi": your_start_ids,
            "yourBench": your_bench_ids,
            "yourCaptainId": your_captain_id,
            "bank": bank,
            "bankNote": "sell prices assume each player was bought at today's price",
        },
        "upgradeCount": upgrade_count,
        "lineupAgreement": lineup_agreement,
        "effectiveGap": round(gap_bar, 1),
        "earlySeason": gap_bar > MEANINGFUL_UPGRADE_GAP + 1e-6,
        "nextGw": next_gw,
        "captain": (
            {
                "webName": captain["webName"],
                "id": captain["id"],
                "points": round(captain["projectedPoints"], 1),
            }
            if captain
            else None
        ),
        "viceCaptain": (
            {
                "webName": vice["webName"],
                "id": vice["id"],
                "points": round(vice["projectedPoints"], 1),
            }
            if vice
            else None
        ),
        "captainEdge": captain_edge,
        "runningRecord": load_running_record(),
        "lastGameweek": last_gameweek_review(bootstrap, elements_by_id),
        "upcoming": upcoming,
        "pool": pool,
        "squadComponents": squad_components,
        "parMargin": round(par_hold_margin, 1),
        "marginProvisional": margin_provisional,
        "parBuffer": PAR_BUFFER_POINTS,
        "parBufferProvisional": PAR_BUFFER_PROVISIONAL_POINTS,
        "history": build_history(entry_history),
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
