"""U10: once a gameweek's results are final, score the frozen predictions
against what actually happened and update the running model-vs-baseline
record (R15, KD3, KTD7, KTD12).

A gameweek is scored only when its bootstrap event has ``data_checked: true``
(bonus applied, stats corrected) and it is not already in the record. Live
points are fetched fresh from ``event/{gw}/live`` -- not the committed
snapshot, which ``snapshot.py`` freezes pre-bonus. A gameweek with no stored
prediction is recorded as ``no_prediction`` and never scored after the fact
(KTD7, AE4). The pass is idempotent.

Also UA1 of the 2026-09-03 safety-score plan: the same scored gameweek
updates ``data/record/residuals.json`` with each player's ``actual -
projected`` error, bucketed by position -- the realised spread the safety
score's floor/ceiling band is built from (engine.squad.floor_ceiling)."""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

from engine.backtest import select_squad, xi_actual_points
from engine.config import MEANINGFUL_EDGE_PER_GW
from scripts import compute_forecast as cf

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
FPL_API = "https://fantasy.premierleague.com/api"


def fetch_event_live(gw: int) -> dict:
    req = urllib.request.Request(
        f"{FPL_API}/event/{gw}/live/", headers={"User-Agent": "fplforecast-score-predictions/1.0"}
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def load_running() -> dict:
    path = DATA_DIR / "record" / "running.json"
    return json.loads(path.read_text()) if path.exists() else {"entries": [], "summary": {}}


POSITIONS = ("1", "2", "3", "4")  # GKP, DEF, MID, FWD -- engine.features.POSITIONS keys


def load_residuals() -> dict:
    path = DATA_DIR / "record" / "residuals.json"
    data = json.loads(path.read_text()) if path.exists() else {}
    by_position = data.get("byPosition") or {}
    data["byPosition"] = {pos: list(by_position.get(pos, [])) for pos in POSITIONS}
    data.setdefault("gameweeksIncluded", [])
    return data


def residuals_for_gameweek(predictions: dict, elements_by_id: dict, live: dict) -> dict[str, list[float]]:
    """``actual - projected`` per player this gameweek, bucketed by position,
    from the model's own frozen projections only -- the safety band (Part A)
    only needs the model's out-of-sample error. A player with no live actual
    (blank gameweek, unused sub) is skipped, not recorded as a large miss."""
    actuals = {
        el["id"]: (el.get("stats", {}) or {}).get("total_points")
        for el in live.get("elements", [])
    }
    out: dict[str, list[float]] = {pos: [] for pos in POSITIONS}
    for pid_str, projected in (predictions.get("model") or {}).items():
        if projected is None:
            continue
        pid = int(pid_str)
        actual = actuals.get(pid)
        if actual is None:
            continue
        el = elements_by_id.get(pid)
        if el is None:
            continue
        pos = str(el["element_type"])
        if pos not in out:
            continue
        out[pos].append(round(actual - projected, 2))
    return out


def _projection_list(pred_map: dict, elements_by_id: dict) -> list[dict]:
    out: list[dict] = []
    for pid_str, points in pred_map.items():
        if points is None:
            continue
        el = elements_by_id.get(int(pid_str))
        if el is None:
            continue
        out.append(
            {"id": int(pid_str), "element_type": el["element_type"], "team": el["team"], "points": points}
        )
    return out


def score_gameweek(gw: int, predictions: dict, elements_by_id: dict, live: dict) -> dict:
    """Build the model and baseline squads from the frozen projections with the
    same ``select_squad`` the backtest uses, take each best XI, and score it on
    the fresh actual points."""
    actuals = {
        el["id"]: (el.get("stats", {}) or {}).get("total_points", 0) for el in live.get("elements", [])
    }
    model_pts = xi_actual_points(
        select_squad(_projection_list(predictions["model"], elements_by_id)), actuals
    )
    baseline_pts = xi_actual_points(
        select_squad(_projection_list(predictions["baseline"], elements_by_id)), actuals
    )
    return {
        "gameweek": gw,
        "modelPoints": round(model_pts, 1),
        "baselinePoints": round(baseline_pts, 1),
        "delta": round(model_pts - baseline_pts, 1),
    }


def summarise(entries: list[dict]) -> dict:
    scored = [e for e in entries if "modelPoints" in e]
    n = len(scored)
    model_total = sum(e["modelPoints"] for e in scored)
    baseline_total = sum(e["baselinePoints"] for e in scored)
    per_gw = round((model_total - baseline_total) / n, 3) if n else 0.0
    return {
        "gameweeksScored": n,
        "modelTotal": round(model_total, 1),
        "baselineTotal": round(baseline_total, 1),
        "pooledDeltaPerGw": per_gw,
        "meaningful": per_gw >= MEANINGFUL_EDGE_PER_GW,
    }


def main(fetch=fetch_event_live) -> int:
    bootstrap = cf.load_bootstrap()
    if bootstrap is None:
        print("No bootstrap-static snapshot yet — run scripts/snapshot.py first", file=sys.stderr)
        return 1

    elements_by_id = {el["id"]: el for el in bootstrap["elements"]}
    running = load_running()
    already = {e["gameweek"] for e in running["entries"]}
    residuals = load_residuals()
    residuals_already = set(residuals["gameweeksIncluded"])

    for event in bootstrap.get("events", []):
        gw = event["id"]
        if gw in already or not event.get("data_checked"):
            continue

        pred_path = DATA_DIR / "predictions" / f"gw{gw}.json"
        if not pred_path.exists():
            running["entries"].append({"gameweek": gw, "status": "no_prediction"})
            print(f"GW{gw}: no stored prediction — recorded as no_prediction (AE4)")
            continue

        try:
            live = fetch(gw)
        except urllib.error.URLError as exc:
            print(f"GW{gw}: live fetch failed ({exc!r}) — skipping", file=sys.stderr)
            continue

        predictions = json.loads(pred_path.read_text())
        entry = score_gameweek(gw, predictions, elements_by_id, live)
        running["entries"].append(entry)
        print(
            f"GW{gw}: model {entry['modelPoints']}  baseline {entry['baselinePoints']}  "
            f"delta {entry['delta']}"
        )

        if gw not in residuals_already:
            gw_residuals = residuals_for_gameweek(predictions, elements_by_id, live)
            for pos, vals in gw_residuals.items():
                residuals["byPosition"][pos].extend(vals)
            residuals["gameweeksIncluded"].append(gw)
            residuals_already.add(gw)

    running["entries"].sort(key=lambda e: e["gameweek"])
    running["summary"] = summarise(running["entries"])

    out_path = DATA_DIR / "record" / "running.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(running, indent=2, sort_keys=True))
    print(f"running record -> {out_path}: {running['summary']}")

    residuals["gameweeksIncluded"].sort()
    residuals_path = DATA_DIR / "record" / "residuals.json"
    residuals_path.parent.mkdir(parents=True, exist_ok=True)
    residuals_path.write_text(json.dumps(residuals, indent=2, sort_keys=True))
    print(f"residuals -> {residuals_path}: {len(residuals['gameweeksIncluded'])} gameweek(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
