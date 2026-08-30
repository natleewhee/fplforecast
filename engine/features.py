"""Per-player point projection assembly, lifted verbatim from
``scripts/compute_forecast.py``'s ``main()`` loop (U1). Pure: takes
already-loaded dicts, returns plain dicts.

Projection per player, in order of preference:

  1. minutes model (``scripts/minutes_model.py``): expectedMinutes/90 x per90Points
  2. last-ROLLING_WINDOW-GW flat average total points (the original dumb slice,
     used as a fallback — e.g. for a player the minutes model hasn't seen yet)

Both are scaled by a hard availability multiplier (injury/suspension veto, or
the partial ``chance_of_playing_next_round``) applied *after* the projection,
per the plan's "availability is a veto, not a feature" principle.

Also scaled by FPL's own fixture difficulty rating (FDR) for the target
gameweek — an interim, explicitly crude opponent-strength signal per the plan
doc ("FDR is crude; replace with own λ"). A blank gameweek (no fixture) zeroes
the projection; a double gameweek sums both legs' multipliers, so it naturally
comes out around 2x a single game rather than needing special-casing.
"""

from __future__ import annotations

UNAVAILABLE_STATUSES = {"i", "s", "u", "n"}  # injured, suspended, unavailable, not in squad

POSITIONS = {1: "GKP", 2: "DEF", 3: "MID", 4: "FWD"}


def fdr_multiplier(difficulty: int) -> float:
    """FDR runs 1 (easiest) to 5 (hardest). Linear, symmetric around 3 -> 1.0x.
    Deliberately simple — this is the placeholder the plan wants replaced
    with a real expected-goals λ model, not a tuned formula."""
    return 1.2 - 0.1 * (difficulty - 1)


def team_fixture_multiplier(team_id: int, target_gw: int, fixtures: list[dict]) -> float:
    total = 0.0
    for fx in fixtures:
        if fx.get("event") != target_gw:
            continue
        if fx.get("team_h") == team_id:
            total += fdr_multiplier(fx["team_h_difficulty"])
        elif fx.get("team_a") == team_id:
            total += fdr_multiplier(fx["team_a_difficulty"])
    return total  # 0.0 for a blank gameweek, ~2x for a double gameweek


def availability_multiplier(el: dict) -> float:
    if el.get("status") in UNAVAILABLE_STATUSES:
        return 0.0
    chance = el.get("chance_of_playing_next_round")
    if chance is None:
        return 1.0
    return chance / 100.0


def project_squad(
    picks: list[dict],
    target_gw: int,
    *,
    elements_by_id: dict[int, dict],
    teams_by_id: dict[int, str],
    minutes_model: dict[str, dict],
    rolling_averages: dict[int, float],
    fixtures: list[dict],
) -> list[dict]:
    """One projection dict per pick whose ``element`` id is known, in the order
    the picks were given. A pick whose id is absent from ``elements_by_id`` is
    skipped, exactly as the pre-U1 script did."""
    squad: list[dict] = []
    for pick in picks:
        el = elements_by_id.get(pick["element"])
        if el is None:
            continue

        mm = minutes_model.get(str(el["id"]))
        if mm:
            base = (mm["expectedMinutes"] / 90) * mm["per90Points"]
            component = "minutes-model"
        else:
            base = rolling_averages.get(el["id"], 0.0)
            component = "rolling-average"

        fdr_mult = team_fixture_multiplier(el["team"], target_gw, fixtures)
        projected = base * availability_multiplier(el) * fdr_mult
        squad.append(
            {
                "id": el["id"],
                "webName": el["web_name"],
                "team": teams_by_id.get(el["team"], "???"),
                "position": POSITIONS[el["element_type"]],
                "element_type": el["element_type"],
                "projected": round(projected, 2),
                "component": component,
                "expectedMinutes": mm["expectedMinutes"] if mm else None,
                "fdrMultiplier": round(fdr_mult, 2),
            }
        )
    return squad
