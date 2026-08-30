"""Provisional per-90 rates for players with no Premier League history, so the
model can project them instead of showing "no history" (supersedes KTD11).

Two sources, in order of preference:

1. **Cross-league form** -- if the player is found in Understat's top-five-league
   data (``data/understat/``, ``scripts/ingest_understat.py``) with enough
   minutes, their xG/90 and xA/90 from that league, multiplied by a
   ``LEAGUE_DISCOUNT`` (a Ligue 1 goal is worth ~0.86 of a Premier League one).
2. **Price-tier prior** -- otherwise (a promoted-team player from the
   Championship, a youth debutant), the average per-90 rates of established
   players at the same position and price. FPL prices by expected output, so
   price is a quality proxy; "a whole promoted squad projects as an anonymous
   average of whoever costs the same."

The defensive rates (dc90 / gc90 / saves90) and bonus / cards always come from
the price prior -- Understat carries no defensive-action data.
"""

from __future__ import annotations

import unicodedata

from engine.config import (
    LEAGUE_DISCOUNT,
    RATE_CLAMP,
    UNDERSTAT_MIN_MINUTES,
)

_RATE_NAMES = ("xg90", "xa90", "dc90", "gc90", "saves90", "bonus90", "yellow90")
_PRICE_BIN_M = 0.5
# bootstrap per-90 field -> our rate name (bonus / yellow are per-90'd from totals)
_BOOT_RATE_FIELDS = {
    "expected_goals_per_90": "xg90",
    "expected_assists_per_90": "xa90",
    "defensive_contribution_per_90": "dc90",
    "goals_conceded_per_90": "gc90",
    "saves_per_90": "saves90",
}


# Letters that do not NFKD-decompose to ASCII (Scandinavian / German / Slavic).
_TRANSLITERATE = str.maketrans(
    {"ø": "o", "æ": "ae", "ß": "ss", "đ": "d", "ð": "d", "þ": "th", "ł": "l", "ı": "i", "œ": "oe"}
)


def normalize_name(*parts: str) -> str:
    combined = " ".join(p for p in parts if p).lower().strip().translate(_TRANSLITERATE)
    combined = unicodedata.normalize("NFKD", combined).encode("ascii", "ignore").decode("ascii")
    return " ".join(combined.split())


def understat_index(by_league_season: dict[str, dict[str, list[dict]]]) -> dict[str, list[dict]]:
    """``{league: {season: [player rows]}}`` -> ``{normalized name: [records]}``,
    each record carrying its league and season."""
    index: dict[str, list[dict]] = {}
    for league, seasons in by_league_season.items():
        for season, players in seasons.items():
            for player in players:
                key = normalize_name(player.get("name", ""))
                if not key:
                    continue
                index.setdefault(key, []).append({**player, "league": league, "season": season})
    return index


def match_understat(element: dict, index: dict[str, list[dict]]) -> dict | None:
    """The best Understat record for an FPL element: matched on normalised name,
    with at least ``UNDERSTAT_MIN_MINUTES``, preferring the most recent season
    then the most minutes. ``None`` when there is no confident match."""
    keys = {
        normalize_name(element.get("first_name", ""), element.get("second_name", "")),
        normalize_name(element.get("web_name", "")),
    }
    candidates = [rec for key in keys if key for rec in index.get(key, [])]
    candidates = [c for c in candidates if float(c.get("minutes") or 0) >= UNDERSTAT_MIN_MINUTES]
    if not candidates:
        return None
    return max(candidates, key=lambda c: (str(c.get("season", "")), float(c.get("minutes") or 0)))


def price_curve(elements: list[dict]) -> dict:
    """Mean per-90 rates by (element_type, price bin) over established players
    (those with real minutes this season). Returned as a lookup table with an
    all-players fallback per rate/position."""
    buckets: dict[tuple[int, float], dict[str, list[float]]] = {}
    per_position: dict[int, dict[str, list[float]]] = {}

    for el in elements:
        minutes = float(el.get("minutes") or 0)
        if minutes < 270:  # ~3 full matches -> "established"
            continue
        et = el.get("element_type")
        price = (el.get("now_cost") or 0) / 10.0
        binned = round(price / _PRICE_BIN_M) * _PRICE_BIN_M
        per90 = minutes / 90.0
        rates = {name: _num(el.get(field)) for field, name in _BOOT_RATE_FIELDS.items()}
        rates["bonus90"] = _num(el.get("bonus")) / per90
        rates["yellow90"] = _num(el.get("yellow_cards")) / per90

        for store, key in ((buckets, (et, binned)), (per_position, et)):
            slot = store.setdefault(key, {n: [] for n in _RATE_NAMES})
            for name, value in rates.items():
                slot[name].append(value)

    def mean(slot: dict[str, list[float]], name: str) -> float:
        vals = slot.get(name, [])
        return sum(vals) / len(vals) if vals else 0.0

    return {
        "bins": {k: {n: mean(v, n) for n in _RATE_NAMES} for k, v in buckets.items()},
        "position": {k: {n: mean(v, n) for n in _RATE_NAMES} for k, v in per_position.items()},
    }


def _lookup_price(curve: dict, element_type: int, price: float) -> dict[str, float]:
    binned = round(price / _PRICE_BIN_M) * _PRICE_BIN_M
    for delta in (0.0, _PRICE_BIN_M, -_PRICE_BIN_M, 2 * _PRICE_BIN_M, -2 * _PRICE_BIN_M):
        hit = curve["bins"].get((element_type, round(binned + delta, 1)))
        if hit:
            return hit
    return curve["position"].get(element_type, {n: 0.0 for n in _RATE_NAMES})


def newcomer_rates(
    elements: list[dict],
    cold_start_ids: set[int],
    understat: dict[str, list[dict]],
    curve: dict,
) -> dict[int, dict]:
    """``{player_id: {..per-90 rates.., "source": "understat:<league>" | "price"}}``
    for every cold-start player."""
    out: dict[int, dict] = {}
    for el in elements:
        pid = el["id"]
        if pid not in cold_start_ids:
            continue
        et = el.get("element_type")
        rates = dict(_lookup_price(curve, et, (el.get("now_cost") or 0) / 10.0))
        source = "price"

        match = match_understat(el, understat)
        if match and float(match.get("minutes") or 0) > 0:
            per90 = float(match["minutes"]) / 90.0
            discount = LEAGUE_DISCOUNT.get(match["league"], 0.8)
            rates["xg90"] = float(match.get("xg") or 0) / per90 * discount
            rates["xa90"] = float(match.get("xa") or 0) / per90 * discount
            source = f"understat:{match['league']}"

        rates = {n: min(rates.get(n, 0.0), RATE_CLAMP.get(n, rates.get(n, 0.0))) for n in _RATE_NAMES}
        rates["source"] = source
        out[pid] = rates
    return out


def _num(value) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0
