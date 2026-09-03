---
title: Safety Score and Par Calibration Check - Plan
type: feat
date: 2026-09-03
topic: safety-score-and-calibration
execution: code
---

# Safety Score and Par Calibration Check - Plan

## Goal Capsule

- **Objective:** Two independent additions on top of the live-tracker plan (`2026-09-02-1419-...`):
  1. A **floor/ceiling range** per player and for the manager's XI, so a projection reads as a band, not a false-precise single number.
  2. A **calibration check** that, gameweek by gameweek, tests whether the tracker's par verdict (green/amber/red) actually predicted whether overall rank held or dropped — accumulating into a season-long accuracy record.
- **Relationship to the live-tracker plan:** both were named there as deferred/roadmap items (Scope Boundaries, "How This Work Fits Together", Deferred to Follow-Up Work). This plan owns them; it does not reopen U1–U7 except where noted.
- **Execution profile:** Two mostly-independent workstreams sharing one new piece of infrastructure: a residual-tracking record (model-projected vs. actual points, per player-gameweek), built the same way `data/record/running.json` already tracks model-vs-baseline XI points.

---

## Why floor/ceiling needs new infrastructure first

`engine/model.py` (`project_detail`) is a deterministic point-estimate model — it returns one number per component, not a distribution. There is no variance term anywhere in the pipeline today. Two ways to get a band without inventing one from nothing:

1. **Formula-derived band** — build floor/ceiling from the model's own uncertainty terms it already has: `pStart`/`pCameo` (rotation risk), `minutesRisk`, `provisional`. Ships immediately, no data dependency, but the band width is a guess dressed up as a number — exactly what R-generation KTD2 refused to do for par ("KD3's stated source does not exist, so the margin derivation stands in for it").
2. **Empirical band** — track `actual − projected` residuals per player-gameweek once scored, bucket by position (GKP/DEF/MID/FWD), and derive floor/ceiling from the bucket's realised spread. Matches the pattern the repo already committed to for the par margin (KTD2: bake a number from realised history, mark it provisional below a minimum sample, widen the band while provisional).

This plan takes approach 2, for consistency with KTD2 and because `scripts/score_predictions.py` already does most of the work: it freezes each gameweek's predictions, waits for `data_checked`, and scores them against fetched live actuals. It just doesn't currently keep the per-player residual, only the XI-total delta vs. baseline. Extending it to also persist per-player residuals is the smallest lift to a real (not guessed) variance source.

**Cold-start problem:** the season has 2 gameweeks scored today. A position bucket needs a minimum sample before its spread means anything. This plan reuses KTD2's exact device: below a minimum sample, fall back to a wider default band and flag it provisional — not a special case, the same shape as `parMargin`/`marginProvisional`.

---

## Part A — Floor/Ceiling Safety Score

### Requirements

- RA1. Every squad player's projection carries a floor and a ceiling alongside the point estimate, for the live gameweek and (where cheap) the five-gameweek pool projection.
- RA2. Floor/ceiling widths come from realised residual spread for that position, not a guessed multiplier — matching KTD2's precedent.
- RA3. Below a minimum sample of scored gameweeks for a position, the band is wider and flagged provisional, the same shape as `parMargin`/`marginProvisional`.
- RA4. The XI-level floor/ceiling sums the per-player bands assuming independence (`sqrt(sum of variances)`), not a naive sum of ranges — a naive sum overstates the band because 15 players don't all bust simultaneously.
- RA5. The floor/ceiling shows on the pitch view (per player, on hover/tap, matching the existing component-breakdown pattern) and as one XI-level band near the headline projected total.

### Key Decisions

- KDA1. Residual variance, not a formula-derived band. Chosen over deriving width from `pStart`/`pCameo` directly: those terms already feed the point estimate (via `mins90`), so reusing them for the band width double-counts the same uncertainty rather than measuring it. Realised residuals measure the thing actually being claimed: how far off has this position's projection actually been.
- KDA2. Bucket by position only, not by player or by `minutesRisk` tier. Four buckets get a usable sample within a season; per-player or per-tier buckets would stay perpetually cold-start on a 38-gameweek single-season history. Revisit once multiple seasons of history exist.
- KDA3. Aggregate XI band via independence assumption (`sqrt(Σ variance)`), not `Σ range`. Flagged as an approximation — real player-to-player correlation exists (a rained-off fixture zeroes multiple players at once) — but a full covariance model is out of scope; the independence assumption is the standard first-order approximation and is stated as such in the UI copy ("typical range"), not oversold as a guarantee.

### Implementation Units

**UA1. Persist per-player residuals when a gameweek is scored**
- **Files:** `scripts/score_predictions.py`, `engine/backtest.py` (if a shared helper is warranted), `tests/test_predictions.py`.
- **Approach:**
  1. In `score_gameweek`, alongside the existing XI-total scoring, also compute `residual = actual_points − projected_points` for every player in that gameweek's frozen `predictions["model"]` map (not just the selected XI — every player it had a live projection for), tagged with `element_type`.
  2. Append these to a new `data/record/residuals.json`: `{ "byPosition": { "1": [r1, r2, ...], "2": [...], "3": [...], "4": [...] }, "gameweeksIncluded": [1, 2, ...] }`. Keep raw residuals, not a running mean/variance — the sample is small enough that recomputing stats from the full list each run is cheap and avoids compounding rounding drift.
  3. Idempotency: guard the same way `score_gameweek` already guards against re-scoring a gameweek already in `running.json` — skip a gameweek already present in `gameweeksIncluded`.
- **Test scenarios:**
  - A scored gameweek with three players of known projected/actual points appends the correct three residuals to the right position buckets.
  - Re-running `score_predictions.py` for an already-scored gameweek does not duplicate residuals.
  - A player absent from that gameweek's live actuals (blank gameweek, unused sub) is skipped, not recorded as a large negative residual.

**UA2. Compute floor/ceiling in the engine**
- **Files:** `engine/squad.py` (new function, e.g. `floor_ceiling`), `engine/config.py`, `tests/test_squad.py`.
- **Approach:**
  1. Add `SAFETY_BAND_Z = 1.0` (one standard deviation either side — a ~68% band, matching how the par buffer is stated in points rather than a percentile) and `SAFETY_MIN_SAMPLE_PER_POSITION = 20` to `engine/config.py`.
  2. `floor_ceiling(projected_points, element_type, residuals_by_position)`: below `SAFETY_MIN_SAMPLE_PER_POSITION` residuals for that position, use a config default stdev (`SAFETY_BAND_PROVISIONAL_STDEV`, a stated multiple of the typical scored-position stdev, e.g. the GKP/DEF/MID/FWD average from `data/predictions` if any history exists yet, else a flat conservative constant) and set `bandProvisional = true`; otherwise compute `stdev(residuals_by_position[element_type])` directly. Return `{ floor: max(0, projected - Z*stdev), ceiling: projected + Z*stdev, bandProvisional }`.
  3. Add `xi_floor_ceiling(xi: list[dict], residuals_by_position) -> dict` per RA4: per-player variance = `stdev**2`; XI floor = `xi_total - Z*sqrt(Σ variance)`, XI ceiling = `xi_total + Z*sqrt(Σ variance)`.
- **Test scenarios:**
  - A position with residuals `[+2, -3, +1, -1, ...]` (≥ min sample) produces floor/ceiling at `projected ∓ 1·stdev`, `bandProvisional` false.
  - A position below the minimum sample uses the provisional default and flags it.
  - `xi_floor_ceiling` on a known 11-player set with known per-position variances matches the `sqrt(Σ variance)` hand-computed value, not `Σ range`.
  - Floor never goes negative even when `projected - stdev < 0`.

**UA3. Emit floor/ceiling from the forecast pipeline**
- **Files:** `scripts/compute_forecast.py`.
- **Approach:** load `data/record/residuals.json` (absent file → empty buckets, same guard pattern as `load_running_record`); attach `floorCeiling` to each squad player's live-gameweek card via `_player_card` and an XI-level `xiFloorCeiling` alongside the existing headline total. Pool-wide five-gameweek floor/ceiling (RA1's "where cheap") is out of scope for this pass — the position-bucket stdev is a single-gameweek residual measure, and compounding it across five gameweeks needs a variance-of-sum-of-gameweeks argument this plan does not attempt; note it as deferred, not silently dropped.
- **Test scenarios:** forecast JSON carries `floorCeiling` per squad player and one `xiFloorCeiling`; a fixture with no `residuals.json` yet still produces provisional bands, not a crash.

**UA4. Surface it in the UI**
- **Files:** `src/app/Pitch.tsx`, `src/app/ProjectionCell.tsx`, `src/app/page.tsx`, `src/lib/snapshots.ts` (types).
- **Approach:** extend `ProjectionCell`'s existing hover/tap component-breakdown affordance with a floor–ceiling line; render the XI-level band as a small range under the headline total (e.g. "62 (54–70)"), with a "provisional range" label when `bandProvisional`. No new page, reuses the existing card idiom the component breakdown already established.
- **Test scenarios:** renders against a `gwNN.json` fixture carrying `floorCeiling`/`xiFloorCeiling`; a fixture without them (pre-UA3 data) renders the plain total with no band, not a crash.

---

## Part B — Par Calibration Check

### Requirements

- RB1. Once a gameweek is `data_checked`, retrospectively compute what the tracker's par verdict would have been for that gameweek, using only data that would have been available before it (no lookahead).
- RB2. Compare that verdict against what actually happened to overall rank that gameweek (held/improved vs. dropped).
- RB3. Accumulate a season-long accuracy record: hit rate per verdict colour, not just an aggregate — a calibration check that only reports one number can't distinguish "green is always right, red is a coin flip" from genuinely balanced accuracy.
- RB4. Surface the record somewhere the manager can see it without it cluttering the live tracker itself (RB4 is a display placement decision, not a live-tracker change).

### Key Decision

- KDB1. Fully retrospective, no new persisted mid-gameweek state. The live tracker's par (KTD2) is computable after the fact from data already committed: `data/history-<TEAM_ID>/*.json` (`current[]`: per-gameweek `points`, `overall_rank`) and `data/bootstrap-static/*.json` (`events[].average_entry_score`, which stays populated for finished events). Recomputing `parMargin` for gameweek G using only gameweeks strictly before G (leave-one-out from what the live tracker actually had baked that week) avoids needing to have snapshotted the tracker's live state during play. This is simpler than KTD5's route-and-poll machinery and needs no new API surface — it is a batch job over already-committed history, same shape as `score_predictions.py`.
  - Trade-off, stated not hidden: this reconstructs par from the *final* gameweek score, not the mid-gameweek *projected* total the tracker actually showed live. It calibrates the par threshold and the margin formula (KTD2's actual claim: "the margin the manager needed to hold rank"), not the live-blend projection math (KTD6) that produces the in-flight number. That's the right scope for a calibration check per the original deferred item ("par against realised overall-rank movement") — calibrating the live-projection accuracy itself is a different, harder check (would need mid-gameweek snapshots going forward) and is not attempted here.

### Implementation Units

**UB1. Retrospective par-vs-rank scoring**
- **Files:** `scripts/score_par_calibration.py` (new), `engine/config.py`, `tests/test_par_calibration.py`.
- **Approach:**
  1. New script, run in the same Action step as `score_predictions.py` (after it, since both key off `data_checked`).
  2. For each finished, `data_checked` gameweek G with G ≥ 2 (need a prior gameweek for rank-movement comparison) not already in a new `data/record/par-calibration.json`:
     - `parMargin_G` = median of `(points − average_entry_score)` over all gameweeks `< G` (leave-one-out, mirrors KTD2 exactly but excludes G itself); `marginProvisional_G` = true if fewer than `PAR_MARGIN_MIN_GAMEWEEKS` prior gameweeks exist.
     - `par_G` = `average_entry_score(G) + parMargin_G`; buffer = `parBufferProvisional` if `marginProvisional_G` else `parBuffer` (existing config constants).
     - `verdict_G` = green if `points(G) − par_G > buffer`, amber if within buffer, red if below.
     - `rankMovement_G` = "held" if `overall_rank(G) <= overall_rank(G-1)` (lower is better) else "dropped".
     - `hit_G` = true if (`verdict_G` in {green, amber} and rankMovement_G == "held") or (`verdict_G == red` and `rankMovement_G == "dropped"`) — amber counts as a hold-prediction per KD2's "not a coin-flip on the line" framing; a miss is specifically green/amber-but-dropped or red-but-held.
  3. Append `{gameweek, verdict, rankMovement, hit, marginProvisional}` to `par-calibration.json`; recompute the summary: hit rate overall and per verdict colour, sample count.
- **Test scenarios:**
  - Three prior gameweeks with known points/average feed a hand-computed `parMargin_G`; verdict and hit match a worked example.
  - A gameweek already in the record is not rescored (idempotent, matches `score_predictions.py`'s guard).
  - `marginProvisional_G` true for gameweek 2 (only 1 prior gameweek, below `PAR_MARGIN_MIN_GAMEWEEKS = 3`).
  - Per-colour hit rate is computed separately from the pooled rate — a fixture with all-green verdicts that all hit should not silently validate red's accuracy too.

**UB2. Surface the calibration record**
- **Files:** `scripts/compute_forecast.py` (a `parCalibration` loader mirroring `load_running_record`), `src/app/History.tsx` or a small new module next to `RunningRecordModule` in `page.tsx`.
- **Approach:** load the summary the same guarded way `load_running_record` does (`None` until at least one gameweek is scored); render it in the existing History/season-review area, not the live tracker — RB4's placement call, keeping the in-play tracker uncluttered per the live-tracker plan's KD4 spirit (minimal live-surface noise).
- **Test scenarios:** renders against a fixture record with a mixed hit/miss history; renders nothing (not a crash) when the record file doesn't exist yet.

---

## Sequencing

- Part A and Part B are independent — no shared code beyond both reading/writing under `data/record/`. Can run in parallel.
- Within Part A: UA1 → UA2 → UA3 → UA4 (strictly sequential, each depends on the last).
- Within Part B: UB1 → UB2.
- Both parts are independent of U6 (removing the old alternatives panel) — no file overlap.

## Verification Contract

| Gate | Command | Applies to |
|---|---|---|
| Python unit tests | `python -m pytest -q` | UA1, UA2, UA3, UB1 |
| Type check | `npx tsc --noEmit` | UA4, UB2 |
| Lint | `npm run lint` | UA4, UB2 |
| Production build | `npm run build` | UA4, UB2 |
| Manual: residual record grows correctly | run `score_predictions.py` (or the calibration script) against two consecutive real scored gameweeks, inspect `residuals.json` / `par-calibration.json` by hand | UA1, UB1 |

## Open questions I did not resolve unilaterally

- **Where exactly RB4 renders** (History tab vs. a new small module) — I picked History as the default per KD4's "keep the live surface uncluttered" precedent, but this is a UI call worth confirming before UB2 lands.
- **`SAFETY_BAND_Z` and the provisional default stdev in UA2** are placeholder constants; like KTD6's decay weights, the plan states execution tunes them against real data rather than picking final numbers now.
- Whether floor/ceiling should eventually extend to the five-gameweek pool table (UA3 explicitly defers this) — flagging it rather than silently deciding either way.
