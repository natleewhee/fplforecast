# xP model residual analysis, based on the backtest archive

Status: findings written up, no fix built yet. Written 2026-09-30.

> **Correction (2026-09-30, same day).** The first version of this analysis
> used a hand-copied version of `engine/backtest.py:_adapt_history()` that
> left out `defensive_contribution`. The real backtest has always passed it
> through. That inflated the DEF bias and invented "root cause 1" below.
> The analysis is now `scripts/residual_analysis.py`, which reuses the
> backtest's own replay loop so it can't drift again. Corrected numbers are
> in [[2026-09-30-backtest-fidelity-plan]] under "Phase 1 results". Root
> cause 2 (saves, and also bonus and cards, never ingested) and the
> team-strength gap still stand.

## Method

`scripts/backtest.py` / `engine/backtest.py` already replay the model
gameweek-by-gameweek across `data/history/{2023-24,2024-25,2025-26}` under a
leakage guard (only pre-deadline data feeds each projection), but only ever
report the *squad-level* model-vs-baseline points delta. That's the wrong
grain to find a component-level bug in.

I reused the same replay loop but called `engine.model.project_detail()`
instead of `model.project()`, so every player-gameweek keeps its full
component breakdown (goals/assists/cleanSheet/saves/defensiveContribution/
bonus/cards) alongside the actual points that gameweek. That produced
**82,509 player-gameweek records** across all three archived seasons — a
much larger, more leak-safe sample than the 3 gameweeks currently in
`data/record/`. (Script not committed — ad hoc, one-off; can be rebuilt from
this doc if useful again.)

## Headline numbers

| Position | n | bias (actual − projected) | MAE | avg actual | avg projected |
|---|---|---|---|---|---|
| GKP | 9,229 | **+0.277** | 0.575 | 0.78 | 0.50 |
| DEF | 27,106 | **+0.136** | 1.038 | 1.07 | 0.94 |
| MID | 36,524 | +0.010 | 0.996 | 1.20 | 1.19 |
| FWD | 9,650 | +0.055 | 1.094 | 1.26 | 1.20 |

MID and FWD are close to unbiased. **GKP and DEF are structurally
underprojected** — GKP by ~35% relative to their own average score.

## Root cause: the backtest can't see two real scoring components

Splitting GKP/DEF residuals by component (averaged over every played
gameweek) explains the whole gap:

```
GKP (n=2205, played): avg saves component = 0.000, avg defensiveContribution = 0.000
DEF (n=11034, played): avg saves component = 0.000, avg defensiveContribution = 0.000
```

Both are **exactly zero, every season, including 2025-26**. Two distinct
bugs, both in the backtest/archive pipeline, not (necessarily) in the live
model:

1. **`engine/backtest.py:_adapt_history()` drops `defensive_contribution`
   when building the synthetic live-history payload.** The stats dict it
   constructs (lines ~85-92) only carries `total_points`, `minutes`,
   `ict_index`, `expected_goals`, `expected_assists`. `data/history/coverage.json`
   confirms 2025-26's archive rows **do** carry `defensive_contribution` —
   it's just never threaded through to the payload `engine.features` reads
   rates from. This makes the backtest blind to DC points for every DEF/MID
   backtested, in the one season where the archive actually has the data.
2. **`saves` was never added to `GW_RICH_COLUMNS` in `scripts/ingest_history.py`.**
   No archived season carries goalkeeper saves at all, so the backtest can
   never score that component, and — more importantly — `engine.history`'s
   cross-season `archive_rates` blend (the one `engine.newcomer`/cold-start
   projections lean on for cheap prior-season data) has zero saves history
   to draw from for *any* keeper, in any season.

**This means the GKP/DEF underprojection numbers above are very likely a
backtest-measurement artifact, not proof the live model itself misprices
saves or DC.** Live projections source these same rates from
`bootstrap-static`'s `saves_per_90` / `defensive_contribution_per_90` and
`event-live`'s per-gameweek `saves` / `defensive_contribution` stats
(`engine/features.py:_SEASON_RATE_FIELDS` / `_LIVE_RATE_STATS`), which the
backtest's synthetic history simply doesn't reconstruct. I did not verify
the live path directly (would need a small number of known
gameweeks re-run through `compute_forecast.py` against the committed
`data/forecast/gwN.json` and eyeballed against actuals) — flagging that as
the open question, not asserting the live model is fine.

## Corroborating signal: season-over-season bias drift

| Season | n | bias | MAE |
|---|---|---|---|
| 2023-24 | 27,877 | +0.014 | 0.977 |
| 2024-25 | 26,135 | +0.067 | 0.991 |
| 2025-26 | 28,497 | **+0.174** | 0.955 |

Bias roughly triples between 2023-24 and 2025-26. The DC points rule didn't
exist in 2023-24, was live but not captured by the archive in 2024-25, and
is captured-but-not-piped-through in 2025-26 (root cause #1 above) — so the
backtest's blind spot has been growing exactly as more of the archive
carries data the pipeline still discards. Consistent with, not independent
of, the finding above.

## A second, separate, and expected pattern: fat right tail on hauls

Mean residual when a player actually played is +0.689, but the **median is
-0.06** — near zero. The gap is a small number of outsized misses in both
directions:

- 9.7% of played gameweeks have `|residual| >= 5`
- that 9.7% accounts for **more than 100% of the total signed residual**
  (+22,668 of the +22,575 pooled sum) — the "core" 90.3% nets out to
  essentially zero (mean -0.003, median -0.25)
- the biggest misses are what you'd expect from a model with no read on
  moment-to-moment events: a keeper's 24-point haul from a
  penalty-save-plus-clean-sheet game, a nailed starter's red card or missed
  penalty turning a projected 8 into a 1

This isn't a bug to fix — no reasonable pre-match model predicts a specific
hat-trick or red card — but it does mean **the pooled mean-based metrics
already used in `data/record/running.json` and this analysis are haul-
sensitive**. A meaningfully-better/worse-looking week can be one big outlier,
not a real shift in model quality. Worth knowing before reading too much
into any single gameweek's `delta`.

## What I did *not* find

- Minutes-model calibration looks reasonable: `expectedMinutes` buckets
  against actual P(60+ minutes) rise monotonically and roughly track
  (0-15→2.8%, 45-60→50.2%, 90-105→91.6%). No obvious miscalibration.
- Early-season (`GW1-6`) vs. settled (`GW7+`) bias/MAE are close
  (+0.052/1.048 vs +0.091/0.964) — the shrinkage-toward-position-prior in
  `build_feature_frame` seems to be doing its job; cold-start rows aren't a
  standout error source in this sample (all backtest rows are non-provisional
  by construction, though — the backtest never exercises the
  `engine.newcomer` cold-start path at all, since it only ever sees
  already-resolved historical players. That path is untested by this
  analysis entirely.)
- DNP handling is fine: 60.3% of all player-gameweek rows are an unused
  squad player, and the model gives them an average of 0.31 projected
  points against an actual of ~0 — small, expected noise, not a bias source.

## Recommendations, in order of confidence

1. **Fix `engine/backtest.py:_adapt_history()`** to carry
   `defensive_contribution` through to the synthetic stats dict when the
   archive has it (2025-26 onward). Small, mechanical, high-confidence fix.
   Re-run the backtest after, and the GKP/DEF bias numbers above should
   shrink for 2025-26 specifically — that's the falsifiable check.
2. **Add `saves` to `GW_RICH_COLUMNS` in `scripts/ingest_history.py`**,
   confirm vaastav's `merged_gw.csv` source actually carries a saves column
   for the archived seasons, and re-ingest. This fixes both the backtest
   blind spot and, more valuably, gives `engine.history`'s `archive_rates`
   real saves priors for cold-start/newcomer goalkeepers — currently that
   blend has nothing to draw on for any keeper, live or backtested.
3. **After both fixes, re-run this same per-component residual analysis.**
   If GKP/DEF bias collapses toward MID/FWD's near-zero level, that
   confirms the live model was fine all along and this was purely a
   measurement gap. If a real gap remains, *then* it's worth looking at
   `engine/model.py`'s save/DC point formulas themselves.
4. **Lower priority**: consider reporting the median alongside the mean in
   `data/record/running.json`'s summary and in this kind of analysis, given
   how haul-sensitive the mean is. Not urgent — the existing
   `pooledDeltaPerGw` metric is a sum-of-XI-points comparison, not a
   per-player mean, so it's less exposed to this than the raw residual mean
   used here, but worth keeping in mind before trusting a single gameweek's
   swing.

## Out of scope here

- Did not verify the live projection path directly against known past
  gameweeks (see the open question under "Root cause" above) — that's the
  natural next step before touching any model code.
- Did not look at bonus-points or cards-point accuracy in similar depth;
  their backtest averages weren't zero, so nothing flagged them, but they
  also weren't deliberately audited component-by-component the way
  saves/DC were once those hit zero.
