# xP Model Audit — 2026-09-05

Scope: adversarial review of `engine/model.py`, `engine/features.py`, `engine/strength.py`,
`engine/team_goals.py`, `engine/config.py`, `scripts/compute_forecast.py`, `engine/newcomer.py`,
against the live `data/forecast/gw4.json`. Read-only; nothing modified.

## 1. The João Pedro vs Haaland case

**Finding: not reproducible against the current `data/forecast/gw4.json`.** In the live file
(`generatedAt: 2026-09-05T04:07:47Z`, built on top of commit `c33d35d`, the just-merged
"Mundle" rate-blend fix), GW4 `perGameweek[0]` is:

| | João Pedro (CHE, FWD) | Haaland (MCI, FWD) |
|---|---|---|
| Opponent (GW4) | HUL (home), FDR 2 | MUN (away), FDR 4 |
| projected points | **6.81** | **6.88** |

Haaland is (marginally) still ahead. Also, neither player's GW4 opponent is Coventry/Arsenal as
described in the trigger report — João Pedro's fixture is home to "HUL" and Haaland's is away at
"MUN". This strongly suggests the reported instance came from an earlier forecast snapshot
(different fixture list and/or pre-dating the Mundle fix), not the file currently on disk. I
cannot reconstruct the exact reported instance, but I *can* reconstruct the full arithmetic behind
the current numbers and show the mechanisms that make the gap between these two players far
smaller than reputation would suggest — which is the same underlying anomaly, just less extreme
after the recent fixes.

### Full component walk (via `engine.model.project_detail`, unmodified code, real data)

Feature-row inputs (`engine.features.build_feature_frame`, both players: 180 min / 2 games this
season, `rate_source = history`, not cold-start):

| rate | João Pedro | Haaland |
|---|---|---|
| xg90 (blended) | 0.4083 | 0.4824 |
| xa90 (blended) | 0.0907 | 0.0771 |
| dc90 (blended) | 6.070 | 6.254 |
| bonus90 (blended) | **1.4554** | **1.1220** |
| yellow90 | 0.0202 | 0.0202 |
| minutes model | pStart 1.0, expMin 87.4 | pStart 1.0, expMin 88.1 |
| team strength (attack) | CHE 1.1434 | MCI **1.3732** |
| opponent (GW4) | HUL, unknown → defence ratio defaults to **1.0** (neutral) | MUN, known → defence ratio **1.0436** (slightly tougher than average) |
| home factor | ×1.15 (home) | ×1 (away) |
| resulting lam_for | 1.45 × 1.1434/1.0 × 1.15 = **1.91** | 1.45 × 1.3732/1.0436 × 1 = **1.91** |
| attack_adj (lam_for/1.45) | 1.315 | 1.316 |

Component totals (`project_detail`):

| component | João Pedro | Haaland |
|---|---|---|
| appearance | 2.00 | 2.00 |
| goals (xg90×mins90×attack_adj×4) | 2.09 | 2.49 |
| assists | 0.35 | 0.30 |
| cleanSheet | 0 (FWD) | 0 |
| defensiveContribution | 0.98 | 1.02 |
| bonus (bonus90×mins90) | **1.41** | **1.10** |
| cards | -0.02 | -0.02 |
| **total** | **6.81** | **6.88** |

### The specific mechanism

Two effects combine to make Haaland's structural attack-quality edge (attack rating 1.373 vs
1.143 — a real ~20% gap) largely disappear in the final lambda:

1. **Unknown-opponent neutrality vs a flat home bonus.** João Pedro faces a team with *no*
   entry (or a zero-match entry) in `team_goal_rate_table` — likely a promoted/placeholder side
   in this data set — which defaults to a defence ratio of exactly `1.0` (see
   `engine/strength.py::expected_goals`, `dfn.defence if dfn else 1.0`). Haaland faces a team with
   a real, slightly-above-average defence rating (1.0436). João Pedro's home fixture then gets the
   flat `HOME_GOALS_FACTOR = 1.15` that Haaland's away fixture does not. The combination
   (neutral opponent × 1.15 home vs a real-but-only-slightly-tough opponent × 1.0 away)
   nearly exactly cancels Man City's much higher attack rating — both fixtures land at
   `lam_for ≈ 1.91` to two decimal places. This is very likely coincidental in its exact size, but
   it demonstrates a structural problem: **`HOME_GOALS_FACTOR` (a single flat 15% for every team)
   is large enough to fully offset a genuine ~20% team-quality gap**, and an *unmodeled* opponent
   defaults to fully neutral rather than to any prior reflecting "unknown/promoted teams tend to
   be weaker than average," so a player at home to an unrated team is quietly advantaged relative
   to a player away at a known, competent side.
2. **`bonus90` is overweighted relative to its real sample size (confirmed bug, see §2.1).**
   João Pedro's blended bonus90 (1.4554) is inflated by an evidence-shrinkage bug that grants it
   the trust of ~12 games' worth of data when only ~2 games of bonus data actually exist. Correcting
   just this one bug (see below) drops João Pedro's bonus component from 1.41 to ~0.99 and
   Haaland's from 1.10 to ~0.81 — narrowing the gap further in Haaland's favour, not closing it,
   because both are hit by the same bug in proportion to their raw hot-streak bonus rate. It is a
   real, confirmed defect but not what makes João Pedro *specifically* outproject Haaland.

**Verdict:** the near-parity is driven almost entirely by (1), a flat home-advantage term that is
large enough to erase real team-quality gaps combined with a neutral fallback for unrated
opponents, not by any sign error, wrong-gameweek data, or double-counting. I could not confirm
João Pedro *exceeding* Haaland in the live data as reported — only a near-tie that would tip either
way on a marginal fixture/rate change. Given how close the two fixtures' `attack_adj` land (1.315
vs 1.316), a very small perturbation (a slightly weaker archived opponent for João Pedro, a
slightly larger home factor, or one more hot bonus point) is all it would take to flip the
ordering — which is consistent with the user having seen it flipped in an earlier run.

---

## 2. Other faults found, ranked

### 2.1 CONFIRMED — Evidence-count bug in rate shrinkage overweights bonus90/yellow90/gc90/saves90 for small samples
**File:** `engine/features.py::_rate_features`, lines ~230–233 and 292–301.

`evidence[pid]` is computed once per player as
`season_min/90 + recent_games + (RATE_ARCHIVE_GAMES if has_archive else 0.0)` and then reused as
the shrinkage sample size `n` for **every** rate name, including `bonus90`, `yellow90`, `gc90`,
and `saves90` — none of which ever receive an archive-sourced value (`_ARCHIVE_RATE_NAMES =
("xg90", "xa90", "dc90")` only). For a player with archived history (`has_archive=True`), this
credits +8 games of confidence to a rate that has zero games of archived backing, which
under-shrinks a noisy 2-game sample toward the prior far more than it should.

Reproduced numerically (this file, live data): João Pedro's blended raw bonus rate is 2.0/90 from
2 games. With the actual evidence used (`n=12`) the shrunk value is 1.4554; with the archive credit
correctly excluded for this rate (`n=4`, actual season+recent games only) it would be 1.0197 — a
30% overstatement. Same pattern for Haaland (1.1220 vs a corrected 0.8197). This is the same bug
*class* as the just-fixed Mundle issue (a weight that doesn't scale with the sample size actually
behind it) but in a different place the Mundle fix didn't touch.

**Fix (scoped):** compute evidence per rate name, not once per player — e.g. only add
`RATE_ARCHIVE_GAMES` to a rate's evidence when `name in _ARCHIVE_RATE_NAMES` and
`archive_rates.get(pid)` has that specific key. A few lines in the pass-2 loop of
`_rate_features`.

### 2.2 CONFIRMED — Archive per-90 rates are averaged unweighted across seasons
**File:** `scripts/compute_forecast.py::archive_rates`.

```python
for key in ("xg90", "xa90", "dc90"):
    vals = [r[key] for r in recs if key in r]
    if vals:
        agg[key] = sum(vals) / len(vals)
```

This is a straight mean across seasons regardless of how many minutes each season contributed. A
player with 2500 minutes in 2023-24 and 90 minutes (one substitute cameo) in 2025-26 has both
seasons' xg90 weighted equally. A season with very few minutes produces a noisy per-90
extrapolation (the same "one cameo → 15 xG/90" failure mode the Mundle fix addressed for the
current season) and it is not damped here at all before being averaged into the archive figure fed
into the main blend at a fixed `RATE_BLEND["archive"] = 0.3` weight.

**Fix (scoped):** weight each season's contribution by that season's minutes (or clamp/scale a
season's rate the same way `RATE_SEASON_FULL_GAMES` does for the current season) before averaging
in `archive_rates`.

### 2.3 SUSPECTED — Unknown/unrated opponent defaults to a fully neutral 1.0 rather than a data-informed prior
**File:** `engine/strength.py::expected_goals`, `opponent_multiplier`; `engine/team_goals.py`.

An opponent absent from the archive (a new promoted club with no finished fixtures yet, or a name
that fails to match between `teams.json` and `fixtures.json`) contributes `atk_ratio = 1.0` /
`def_ratio = 1.0` — dead neutral, not "probably weaker than average" (which is usually the true
prior for a newly-promoted or unmatched side). Combined with §1's home-factor finding, this quietly
inflates any player's projection who happens to face such a team at home, and deflates a
CS-chasing defender's projection who faces one away, purely because of a data gap rather than a
modelled belief. This is the "small-sample or missing-data case silently defaults to something
that favors a player" pattern named in the brief.

**Confidence:** confirmed as a code fact (the `else 1.0` fallback); suspected as the actual
explanation for the trigger case since I could not verify which team the original report's
"Coventry" fixture resolved to in the archive.

**Fix (scoped):** give a genuinely-unrated team a discounted default (e.g., a fixed "promoted-team"
attack/defence prior below 1.0, or fall back to the FPL admin `strength_*` proxy from
`engine.strength.team_strength_table` — which at least reflects a manually-set expectation — when
`team_goal_rate_table` has no match) instead of pure neutrality.

### 2.4 SUSPECTED — `HOME_GOALS_FACTOR` is a single flat constant applied identically to every team
**File:** `engine/config.py` (`HOME_GOALS_FACTOR = 1.15`), consumed in `engine/strength.py::expected_goals`.

The module docstring for `engine/strength.py` explicitly checked and rejected a *venue-split team
rating* on the grounds it added noise — that finding looks sound (documented, checked across 25
archived teams). But nothing checks whether a single flat multiplier, applied identically to a
newly-promoted side and Manchester City alike, is itself well-calibrated. As shown in §1, at 15% it
is large enough to erase a genuine ~20% team-attack-quality gap between two Premier League sides.
This isn't necessarily wrong (real home advantage is a known, real effect), but the magnitude is an
unvalidated magic constant with no citation or backtest reference in `config.py`, unlike most other
constants there which cite a KD/KTD or a script. Worth a sanity check against `data/record/` once
enough gameweeks exist, the same way `SAFETY_BAND_Z`/`SAFETY_BAND_PROVISIONAL_STDEV` are meant to
be recalibrated from `residuals.json`.

**Fix (scoped):** none needed immediately; flag for the same backtest-calibration pass already
planned for the safety band, and consider clamping the *product* of team-strength ratio × home
factor rather than leaving them uncombined and unclamped (`TEAM_LAMBDA_CLAMP` catches only the
final lambda, not this specific interaction).

### 2.5 SUSPECTED — `defensiveContribution` probability model is a bare linear ratio, not a real distribution
**File:** `engine/model.py`, `p_hit = min(1.0, dc90 / DC_THRESHOLD[et])`.

Treating "probability of hitting a fixed per-match defensive-actions threshold" as
`rate-per-90 / threshold` is a crude linear proxy for what is really a count/threshold-crossing
probability (more naturally a Poisson-style `P(X ≥ threshold)`). It systematically under-predicts
for players whose actions cluster tightly around the threshold most matches (nearly-certain to hit
it, but the linear ratio caps out well below 1.0 unless dc90 exceeds the full threshold) and can be
noisy for a 2-game dc90 sample the same way other early-season rates are. Not confirmed as
materially wrong without a backtest against actual DC-point hit rates, but it's an unvalidated
approximation sitting next to more carefully modelled Poisson-flavoured terms elsewhere
(clean sheet uses `exp(-lambda)`, an actual Poisson P(0)).

**Fix (scoped):** if `data/record/` has enough scored gameweeks with the 2025-26 DC rule, backtest
`p_hit` against realised hit rates and consider a saturating function (e.g. `1 - exp(-dc90/threshold)`)
instead of a bare linear ratio, which would also remove the current hard ceiling artifact.

### 2.6 SUSPECTED — `minutes_model` missing-entry fallback (0.5 mins90 / 0.35 pStart) is a single flat guess for every position/price
**File:** `engine/model.py::_minutes_profile`.

A player with no minutes-model row at all gets a flat fringe-player default regardless of price,
position, or whether they are a nailed-on starter simply missing from the snapshot due to a data
lag. This under- or over-states such players' minutes uniformly rather than falling back to
something price/ownership-informed. Likely low-impact (should be rare once the minutes model is
populated) but worth flagging as another silent-default case.

**Fix (scoped):** low priority; log/flag when this fallback fires so it's visible how often it's
actually hit, before spending effort on a smarter fallback.

---

## 3. What's solid / where the recent fixes already helped

- **Team-strength Phase 1 (home/away collapse) and Phase 2 (real-goals table)** are sound as
  implemented: `team_goal_rate_table`'s shrinkage-by-matches-played (`TEAM_GOALS_SHRINKAGE_MATCHES
  = 20`) correctly pulls thin-sample teams toward neutral, and the divide-by-zero guard on
  goals-against (`max(own_against_rate, 0.1)`) is a reasonable, deliberate floor, not an
  accidental one. `expected_goals`/`opponent_multiplier` consume either strength source (admin
  rating or real goals) through the same `TeamStrength` shape, so Phase 2 didn't leave any stale
  Phase-1-only code path live — confirmed by `compute_forecast.py` calling `team_goal_rate_table`
  directly for `ModelContext.team_strength`.
- **The Mundle fix (scaling season/recent blend weight by the player's own minutes-sample
  reliability) works as intended** for the two rates it targets most visibly (`xg90`/`xa90`): I
  did not find a case where a true single-cameo extrapolation still enters at full weight in the
  `season`/`recent` blend sources themselves. The gap I found in §2.1 is downstream of this fix,
  in the *shrinkage* step, not the blend-weight step the Mundle fix touched — that step was
  already bugged for the non-archived rate names before the Mundle fix, and is not a regression
  from it.
- **No captain-multiplier or gameweek-indexing bug found.** `perGameweek[0]` in `gw4.json`
  matches `project_detail`'s output for `target_gw=4` exactly for both players when recomputed
  directly from the live data files; the captain ×2 multiplier is applied downstream and
  symmetrically (`compute_forecast.py` lines ~504–560), so it cannot itself be the source of a
  same-position ranking flip.
- **Clean-sheet math is legitimate Poisson** (`exp(-lambda_against)`), not an ad hoc approximation,
  unlike the defensive-contribution term (§2.5).
- **`TEAM_LAMBDA_CLAMP` and `TEAM_STRENGTH_CLAMP`** are present and did fire sanity bounds
  correctly in the sampled data (no lambda outside `(0.3, 3.5)` observed).
