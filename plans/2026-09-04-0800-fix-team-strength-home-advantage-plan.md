---
title: Fix Home-Advantage Double Counting and Team-Strength Compression - Plan
type: fix
date: 2026-09-04
topic: team-strength-home-advantage
execution: code
---

# Fix Home-Advantage Double Counting and Team-Strength Compression - Plan

## Goal Capsule

- **Objective:** Two related defects in `engine/strength.py`'s expected-goals model, found while cross-checking why Raya (Arsenal GKP) projected only 2.86 xP away at Sunderland in GW4 — a fixture that should read as one of the safer clean-sheet chances on the board, not a coin-flip.
- **Trigger case:** Arsenal away at Sunderland, GW4. The model's own `lambdaAgainst` (Arsenal's expected goals conceded) comes out at 1.54 — above the league average of 1.45 — producing only a 21% clean-sheet probability. Traced to two independent, additive problems in how `expected_goals()` weighs home advantage and team quality.
- **Scope:** `engine/strength.py`, `engine/config.py`. Does not touch the player-level rate blending bug found for the same investigation (Mundle's small-sample xG blow-up) — that is a separate, already-diagnosed defect in `engine/features.py::_rate_features`, tracked separately.
- **Not in scope:** The "full expected-goals λ model" `engine/model.py`'s own docstring already defers (KTD10) — a from-scratch rebuild using bookmaker odds or a proper Poisson/Dixon-Coles fit. This plan works within the existing FPL-strength-rating-based design and fixes two specific defects in it; Phase 2 below sketches a bounded upgrade to that design's main structural weakness, scoped as its own follow-up rather than KTD10's full rebuild.

---

## Diagnosis

### Issue 1: Home advantage is applied twice, and the first application is noise

`expected_goals()` (`engine/strength.py:152`) computes:

```
lam = base * atk_ratio / def_ratio
if attacker_home:
    lam *= HOME_GOALS_FACTOR  # 1.15, a flat 15% boost
```

`atk_ratio` already comes from the attacking team's **home-specific** rating (`attack_home` vs `attack_away`) when the attacker is at home — which is itself supposed to already encode that team's home/away split, i.e. their own home advantage. `HOME_GOALS_FACTOR` then adds a second, flat, universal 15% on top, for every team, every match.

I pulled every team's home/away split from the committed archive to check whether the first mechanism (the home/away-specific rating) is actually carrying real signal:

| team | attack home vs away gap | defence home vs away gap |
|---|---|---|
| ARS | +2.0% | +1.7% |
| MCI | +0.9% | −0.3% |
| LIV | −1.8% | −0.2% |
| AVL | −1.4% | −4.5% |
| BOU | −3.1% | +4.3% |
| SUN | −1.8% | −1.5% |
| *(full 25-team table available on request)* | mostly 0–3%, both signs | mostly 0–5%, both signs |

Across all 25 teams in the archive, the home/away split is small (mostly under 3%) **and inconsistently signed** — for several teams (AVL, BHA, BOU, LIV, NFO, and more) the "away" rating is actually *higher* than the "home" rating, the opposite of what a home-advantage signal should look like. This is FPL's own `strength_attack_home/away` field, not a home-advantage measurement — it doesn't reliably encode home advantage at all; it's mostly noise around each team's overall rating.

So today: the flat `HOME_GOALS_FACTOR` is carrying essentially all of the real home-advantage effect, correctly. But the home/away-specific rating split is *also* being used, contributing near-zero real signal and some noise (occasionally working against the home team, e.g. Bournemouth's defence reading 4.3% *worse* at home than away). It isn't "double counting" in the sense of two mechanisms reinforcing each other — it's one real mechanism (`HOME_GOALS_FACTOR`) plus one noisy, sign-inconsistent one (the split) that adds variance without adding accuracy.

**Fix direction:** collapse each team's attack/defence rating to a single (non-home/away-split) value, and let `HOME_GOALS_FACTOR` be the sole, explicit home-advantage term. Simpler, and removes a source of noise that currently sometimes points the wrong way.

### Issue 2: team strength is a coarse, compressed proxy that barely separates elite and weak teams

`team_strength_table()` builds every team's rating purely from FPL's own preseason `strength_attack_*` / `strength_defence_*` fields (administratively set, not derived from actual goals data), averaged over up to 3 archived seasons and shrunk toward 1.0 by `TEAM_STRENGTH_SHRINKAGE_SEASONS=1.5`.

Two consequences, both visible in the Raya case:

1. **Elite teams read as barely above average.** Arsenal's `defence_away` = 1.065 (6.5% better than average) and Man City's = 1.094 (9.4% better) — modest for teams with two of the best defensive records in the league over the archived seasons. FPL's own strength ratings are kept in a fairly tight band (they're used league-wide for Fixture Difficulty Rating, and FPL doesn't rate any team dramatically higher than another), so this isn't a code bug — it's a structural ceiling on how much signal this proxy can ever carry, however well it's blended.
2. **Promoted teams read as almost exactly average**, regardless of their actual likely quality. Sunderland has one archived season (their promotion-season strength rating) and reads at attack_home=0.983 — 1.7% below average — rather than meaningfully weaker as a newly-promoted side typically is until the market/FPL itself revises them. There's no in-season update mechanism: nothing in the pipeline recalibrates a team's rating from *this season's own actual results* as they accumulate — `data/history/2025-26/teams.json` refreshes daily from FPL's own admin-set fields, but those fields themselves only move when FPL chooses to revise them, not continuously from results.

**Fix direction (larger, own phase):** derive team attack/defence strength from real goals-scored/conceded data already sitting in the archive (`data/history/<season>/gwNN.json` player rows carry `goals_conceded` per player per fixture, aggregable to a team total per match) instead of — or blended with — FPL's own compressed proxy rating, and blend in this season's own accumulating results with games-played shrinkage, the same empirical-Bayes pattern already used for player rates (`RATE_PRIOR_GAMES`) and the par margin (`PAR_MARGIN_MIN_GAMEWEEKS`).

---

## Key Decisions

- KD1. Collapse the home/away rating split to one per-team attack/defence rating; `HOME_GOALS_FACTOR` becomes the sole home-advantage mechanism. Chosen over keeping the split: the archive data shows it isn't a reliable home-advantage signal (inconsistently signed across teams), so keeping it only adds unexplained variance to fixtures like this one. **Needs your sign-off before I touch it** — this changes every fixture's lambda, not just Raya's.
- KD2. Phase 2 (real goals-data team strength) is scoped as its own follow-up plan, not bundled into this fix. It's a meaningfully larger lift (new team-level goals aggregation from the archive, in-season blending with shrinkage) and touches the same territory as the already-deferred KTD10 full expected-goals rebuild — better to size and sequence it deliberately rather than fold it into a small mechanical fix.
- KD3. Phase 1 ships with before/after lambda comparisons for a handful of known fixtures (Arsenal, Man City, a promoted side) in the verification step, not just passing unit tests — the whole point is the *number* reads more sanely, not just that the code runs.

---

## Phase 1 — Collapse the home/away split (small, mechanical) — DONE 2026-09-04

Implemented as designed. Verified against real committed archive data:
Arsenal's own home/away split was already thin (2.0%/1.7%), so this specific
trigger case barely moved (`lambdaAgainst` 1.5416 vs 1.5399 before — clean-
sheet probability still ~21.4%). The fix's real effect is systemic: every
fixture's home/away gap is now *exactly* `HOME_GOALS_FACTOR` (1.15×, checked
directly), with the previously noisy, inconsistently-signed venue-specific
rating swing gone entirely — confirmed on Bournemouth, whose defence used to
read *worse* at home than away, a wrong-direction artifact this removes.

**Raya's number is still low after Phase 1** — the actual driver was always
Issue 2 (Arsenal's defensive edge reading as only ~7% above average; no
in-season update for a team like Sunderland), which is Phase 2, not yet
built. Flagging this plainly rather than claiming Phase 1 fixed the
headline case it was found from.

### Implementation

- **Files:** `engine/strength.py`, `tests/test_strength.py` (or wherever team-strength tests currently live — confirm at execution time).
- **Approach:**
  1. In `team_strength_table()`, average each team's `strength_attack_home`/`strength_attack_away` into one `attack` ratio (and same for defence), rather than keeping them split. `TeamStrength` becomes `{attack, defence, seasons}` — drop the `_home`/`_away` suffixes.
  2. In `expected_goals()`, use the single `attack`/`defence` ratio regardless of venue; keep `HOME_GOALS_FACTOR` exactly as-is (applied only when `attacker_home`).
  3. Update `_leg_context` in `engine/model.py` (the caller) — it currently passes `attacker_home=` to select home vs away ratios inside `expected_goals`; after this change that parameter still matters (it still gates whether `HOME_GOALS_FACTOR` applies) but no longer selects between two rating variants.
  4. `opponent_multiplier()` (the fallback path used when `team_strength` is absent) also reads `attack_home`/`attack_away` — update it to the collapsed shape too, for consistency, even though it's not on the live model's hot path today.
- **Test scenarios:**
  - Arsenal away at Sunderland (this case): recompute `lambdaAgainst` and confirm it drops meaningfully below the league average (Arsenal's real defensive edge should show up as *less* than 1.45, not more).
  - A team with a currently-inverted split (e.g. Bournemouth, whose defence reads worse at home than away today) — confirm the collapsed rating no longer produces a home-fixture penalty that shouldn't exist.
  - `HOME_GOALS_FACTOR` still applies once, only for the home attacker, unchanged from today.
  - Existing `test_strength.py` (or equivalent) cases updated for the new `TeamStrength` shape; anything asserting on `attack_home`/`attack_away` directly gets repointed to `attack`.
- **Verification:** `python -m pytest -q`; regenerate `data/forecast/gw3.json` and manually compare Raya's and a few other GKP/DEF cards' clean-sheet-driving `lambdaAgainst` before/after for plausibility, not just that the pipeline runs.

---

## Phase 2 — Real goals-data team strength (sketch, own follow-up plan)

Not implementing this now — sketching the shape so it's not lost, per your "both issues" scope.

- **Data source:** `data/history/<season>/gwNN.json` rows already carry `goals_conceded` (and presumably `goals_scored`) per player per fixture; a defender/GK's `goals_conceded` for a given match equals that team's goals conceded in that fixture. Aggregating by `(team, gw)` across the archive gives real per-match team goals for/against — the actual signal FPL's compressed `strength_*` fields are only a proxy for.
- **In-season blending:** once this season's own `event-live` snapshots accumulate a few gameweeks, blend the archive-derived rate with this season's own actual goals for/against, using games-played shrinkage — the same pattern as `RATE_PRIOR_GAMES` (player rates) and `PAR_MARGIN_MIN_GAMEWEEKS` (par margin): thin in-season evidence stays close to the archive prior, and the team's rating moves as real results accumulate, rather than staying frozen at a preseason value all year (today's actual gap, alongside Phase 1's).
- **Promoted teams:** with no archive at all (a team's first-ever PL season, if one exists), the modest signal available is what Phase 1 already provides — league-average until real minutes accumulate. Same shape as the player-level newcomer path (`engine/newcomer.py`) — this would essentially be that same pattern, one level up, applied to teams instead of players.
- **Why this is its own plan, not a Phase 2 here:** it needs a new team-level goals aggregation module, a decision on how many games of in-season evidence should out-weigh the archive, and a decision on whether to keep FPL's `strength_*` fields as a blend component (a market-consensus-adjacent signal) or drop them entirely in favor of pure goals data. Those are real design calls, not mechanical fixes — worth their own planning pass once Phase 1 and the Mundle rate-blending fix have landed and settled.

---

## Verification Contract

| Gate | Command | Applies to |
|---|---|---|
| Python unit tests | `python -m pytest -q` | Phase 1 |
| Manual sanity check | regenerate `data/forecast/gw3.json`; compare `lambdaAgainst`/`lambdaFor` for Arsenal, Man City, and a promoted side before/after Phase 1 | Phase 1 |

## Definition of Done (Phase 1 only)

- `TeamStrength` carries one `attack`/`defence` rating per team, not a home/away split.
- `HOME_GOALS_FACTOR` is the only home-advantage mechanism in `expected_goals()`.
- `opponent_multiplier()` updated to match, even though it's off the live model's hot path.
- Arsenal's clean-sheet probability away at Sunderland (GW4) reads higher than today's 21%, and the change is explainable by "the home/away noise is gone," not by an unrelated side effect.
- `python -m pytest -q` green.

## Open Questions

- Do you want Phase 1 implemented now, or do you want to see the Mundle rate-blending fix land first and re-check whether Raya's number still looks off before touching team strength? They're independent bugs but both affect the same displayed numbers, so it may be easier to judge Phase 1's effect in isolation with Mundle already fixed.
- Phase 2 — worth a dedicated plan now, or park it until Phase 1's effect on real fixtures has been observed for a few gameweeks?
