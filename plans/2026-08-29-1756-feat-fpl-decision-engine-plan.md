---
title: FPL Decision Engine - Plan
type: feat
date: 2026-08-29
topic: fpl-decision-engine
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
---

# FPL Decision Engine - Plan

## Goal Capsule

- **Objective:** Each gameweek, the manager can see how their own squad, a projection model, and a transparent baseline each rate their available moves, and can tell over time whether the model is actually adding anything.
- **Means:** Extract the projection math into a headless `engine/` library, add a composite baseline beside the model, replace the single best-XI recommendation with a three-column view, and add a pre-deadline prediction log, a post-gameweek scoring pass, and a leakage-guarded backtest (KTD1, KTD6).
- **Product authority:** Single-user private tool. Chip timing, multi-user access, and mini-league features are not active scope.
- **Open blockers:** None. The two `Resolve Before Planning` questions are settled as KD8 (transfer window) and KD9 (baseline threshold).
- **Execution profile:** Deep. Three surfaces move together — a Python library plus CLI wrappers, the daily GitHub Action, and the static Next.js app. New `engine/` modules are built test-first; the reused scripts get characterization coverage only where the extraction changes their call path.
- **Tail ownership:** Implementation lands as dependency-ordered commits straight on the default branch (`claude/fpl-forecaster-build-setup-ksd7z0`), no PR, per the delivery decision for this planning pass. Repo conventions and user preference override that at execution time.

---

## Product Contract

**Product Contract preservation:** restructured, no scope change. R1–R17, F1–F3, AE1–AE4, and KD1–KD7 are unchanged. The two `Resolve Before Planning` questions are resolved as new Key Decisions KD8 and KD9. The `Deferred to Planning` questions are answered in the Planning Contract (KTD2, KTD5, KTD9, and the backtest-output shape in U11).

### Summary

A private, single-user Fantasy Premier League app that projects per-player points from multi-season history and presents each gameweek as a three-column comparison: the model's picks, a composite baseline's picks, and the current squad. It records its predictions before results are known and scores them afterwards, so evaluation continues past the initial backtest.

### Problem Frame

Weekly FPL decisions — which transfer, who to captain — are currently made on feel: recent form, fixture eyeballing, and whatever the consensus is that week. That is workable but unexamined, and there is no way to tell afterwards whether a given call was good process or a good result.

The obvious remedy, a points model, has a specific failure mode. A homegrown projection is easy to build and hard to trust: it produces a confident-looking number, the author chose its features and its evaluation window, and a single historical backtest run by the person who built the model is weak evidence. The risk is not that the model is wrong; it is that it is wrong in a way that is invisible, gets acted on for a season, and quietly costs rank.

Two structural constraints shape any answer. The official Fantasy Premier League API serves detailed data for the current season only — past seasons appear as season totals, not gameweek rows — so multi-season history has to come from a community archive with its own coverage gaps. And player identifiers are reassigned between seasons, so a player's history does not stitch together without explicit mapping work.

### Key Decisions

- KD1. **The comparison baseline is a composite, not a naive rule.** (session-settled: user-directed — chosen over season-to-date points-per-game, last-5 form, and crowd ownership: a bar the model can clear by accident proves nothing.) Governs R7, R8.
- KD2. **The weekly view presents three columns rather than a single recommendation.** (session-settled: user-directed — chosen over an optimiser and a squad diagnostic: trust in the model is the bottleneck, so the surface that keeps earning it beats the surface that assumes it.) Governs R11, R12.
- KD3. **The app is its own ongoing evaluation harness.** Predictions are written before results are known, which produces out-of-sample evidence a historical backtest cannot. Governs R14, R15.
- KD4. **A failed backtest does not stop the product.** (session-settled: user-directed — chosen over stopping the build and over iterating until the gate passes: the view has standalone value driven by the baseline alone.) Governs R9.
- KD5. **Chip timing stays out.** (session-settled: user-approved — chip decisions are season-level and already handled by hand, and folding them in roughly doubles the modelling surface for the part least likely to change behaviour.)
- KD6. **Single-user, no accounts.** (session-settled: user-directed — chosen over a public tool under the Nat Does The Math brand: removes auth and per-user state, and allows an unpolished surface.) Governs R10.
- KD7. **The projection logic is a pure library, callable without a UI.** The same functions must run over historical gameweeks for the backtest and over the current gameweek for the view; a model reachable only through the app cannot be evaluated. Governs R6, R7.
- KD8. **Transfers are judged over a rolling 5-gameweek window; captaincy over the single upcoming gameweek.** (session-settled: user-directed — chosen over 3 gameweeks, a next-fixture-block window, and a single-gameweek window: 5 matches the horizon most managers plan on and the constant already in the scaffold.) Governs R12.
- KD9. **"Beating the baseline" is reported, not gated.** The backtest reports the model-versus-baseline squad points delta per season and pooled, and flags a pooled mean difference of 0.3 points per gameweek per squad or more as meaningful. It never blocks the build. (session-settled: user-directed — chosen over a majority-of-seasons rule, a strict 5%-over-two-seasons rule, and no numeric threshold: KD4 already makes the gate informational, so a stated number just makes the report legible.) Governs R16; supports the first Success Criterion.

The loop the product runs on:

```mermaid
flowchart TB
  A[Multi-season archive] --> C[Feature set]
  B[Live FPL API] --> C
  C --> D[Composite baseline]
  C --> E[Projection model]
  D --> F[Weekly three-column view]
  E --> F
  F --> G[Prediction log, written pre-deadline]
  H[Actual gameweek results] --> I[Scoring pass]
  G --> I
  I --> J[Running model-vs-baseline record]
  J --> F
```

### Requirements

**Data foundation**

- R1. The system ingests per-gameweek historical player data across multiple past seasons from a community archive.
- R2. The system resolves player identity across seasons so that one player's history is retrievable as a single series despite per-season identifier reassignment.
- R3. The system records, per season ingested, which statistical fields are available, so downstream logic can tell a genuine zero from an absent field.
- R4. The system fetches current-season data — squad, prices, fixtures, gameweek results — from the live Fantasy Premier League API.
- R5. A player with no prior Premier League history is represented explicitly as cold-start rather than as a low projection.

**Projection and baseline**

- R6. The projection logic is callable as a library over any historical gameweek without invoking the user interface.
- R7. The composite baseline projects a player's points from historical scoring average, the ICT influence measure, and recent form, using no fixture or minutes-risk input.
- R8. The projection model projects a player's points from the baseline's inputs plus fixture difficulty and minutes risk.
- R9. Both the baseline and the model remain available to the weekly view regardless of backtest outcome.

**Weekly view**

- R10. The manager's team identifier is supplied as configuration, and the app fetches that squad without a login.
- R11. The weekly view presents three parallel columns for the upcoming gameweek: the model's preferred moves, the baseline's preferred moves, and the current squad's projected outcome.
- R12. Within each column, the view ranks the fifteen squad players against the best available alternative at a comparable price and surfaces the largest projected gaps.
- R13. The view flags minutes risk on any recommended player.

**Evaluation**

- R14. The app records each gameweek's model projections and baseline projections before that gameweek's deadline.
- R15. Once a gameweek's results are final, the app scores the stored projections against actual points and updates a running model-versus-baseline record.
- R16. The backtest replays past seasons gameweek by gameweek and reports the model's and baseline's squad-level outcomes over the same period.
- R17. The backtest excludes from a gameweek's inputs any data that was not knowable before that gameweek's deadline.

### Key Flows

- F1. Weekly decision
  - **Trigger:** Manager opens the app in the days before a gameweek deadline.
  - **Steps:** App fetches the current squad and player pool; baseline and model each project the upcoming gameweek; the view renders three columns with gap rankings and minutes-risk flags; manager makes their own transfer and captain calls.
  - **Outcome:** Manager has acted, and the gameweek's projections are stored.
  - **Covered by:** R4, R10, R11, R12, R13, R14

- F2. Post-gameweek scoring
  - **Trigger:** A gameweek's results become final.
  - **Steps:** App retrieves actual points; scores the stored model and baseline projections; updates the running record.
  - **Outcome:** The running model-versus-baseline record reflects one more out-of-sample gameweek.
  - **Covered by:** R15

- F3. Historical backtest
  - **Trigger:** Manager runs the backtest, typically after changing model features.
  - **Steps:** The projection library replays past seasons gameweek by gameweek under a knowable-at-the-time input restriction; squad-level outcomes are computed for model and baseline over the same period.
  - **Outcome:** A report stating whether the model beat the baseline, and by how much.
  - **Covered by:** R6, R16, R17

### Acceptance Examples

- AE1. Cold-start player
  - **Covers R5.**
  - **Given** a player promoted into the Premier League this season with no prior top-flight record,
  - **When** the weekly view renders,
  - **Then** the player appears marked as having no history rather than carrying a projection built from absent data.

- AE2. Backtest leakage guard
  - **Covers R17.**
  - **Given** the backtest is replaying gameweek 12 of a past season,
  - **When** the model projects players for that gameweek,
  - **Then** no input derived from gameweek 12 or later is available to it.

- AE3. Model loses the gate
  - **Covers R9.**
  - **Given** the backtest reports that the model did not beat the composite baseline,
  - **When** the manager opens the weekly view,
  - **Then** all three columns still render and the baseline column remains usable on its own.

- AE4. Prediction recorded before deadline
  - **Covers R14.**
  - **Given** a gameweek deadline has passed with the app never opened that week,
  - **When** the scoring pass runs,
  - **Then** that gameweek is recorded as having no stored prediction rather than being scored from a projection generated after the fact.

### Success Criteria

- The backtest reports a squad-level comparison between model and baseline over the same historical period, with the same input restriction applied to both.
- The running out-of-sample record is readable at a glance from the weekly view.
- The weekly view is usable in under five minutes before a deadline.

### Scope Boundaries

**Deferred for later**

- Chip timing recommendations — Wildcard, Bench Boost, Triple Captain, Free Hit.
- Automated transfer execution against the FPL account.
- Price-change prediction.

**Outside this product's identity**

- Multi-user access, accounts, or any public deployment under the Nat Does The Math brand.
- Mini-league or rival-tracking features.
- A polished consumer interface; the surface only needs to serve one reader.

**Deferred to Follow-Up Work**

- The expected-goals team-strength (λ) model that the scaffold comments call for. FDR stays the interim opponent-difficulty signal (KTD10).
- Wiring the *live* composite baseline to the multi-season archive. The archive lands with the backtest in this plan; the live baseline stays within-season (KTD4).
- Budget and selling-price validation for transfer overrides. The README names this the largest silent-corruption surface in the project; it stays deferred rather than done wrong.
- Per-season backtest tuning of baseline component weights beyond a single documented default.

### Dependencies and Assumptions

- The `vaastav/Fantasy-Premier-League` community archive is the multi-season source. It is MIT-licensed, covers roughly 2016-17 onwards, and carries per-season coverage flags because older seasons predate expected-goals data.
- The public Fantasy Premier League API is available without authentication for squad, fixture, price, and results data. It has no published stability guarantee; an endpoint change breaks weekly ingestion.
- Transfers are judged over a rolling 5-gameweek window and captaincy over the single upcoming gameweek (KD8).
- Fixture difficulty and minutes risk may not add enough signal over the composite baseline to change decisions. The plan treats this as a likely outcome, not an edge case.
- The backtest covers the last three completed seasons (2025-26, 2024-25, 2023-24), matching the seasons `scripts/resolve_entities.py` already resolves (KTD3).

### Outstanding Questions

Both `Resolve Before Planning` questions are settled (KD8, KD9). The remaining `Deferred to Planning` items are answered in the Planning Contract: prediction-log storage (KTD2), how fixture difficulty is represented (KTD10), how minutes risk is derived (KTD9), and the backtest report shape (U11 — per-season plus pooled). No launch-blocking question remains.

One known unknown carries into implementation, not blocking: the 2026/27 chip allocation is assumed from the 2025/26 ruleset in `src/lib/snapshots.ts` and is not re-verified against live `bootstrap-static`. It affects a display string only and is out of active scope.

### Sources and Research

- `vaastav/Fantasy-Premier-League` — per-season `gws/merged_gw.csv` (gameweek-level player rows), `players_raw.csv` (season totals and the `starts` field), and `player_idlist.csv` (per-season id list). The multi-season source for R1 and the coverage flags in R3.
- The official Fantasy Premier League API — `bootstrap-static`, `element-summary`, `fixtures`, `event/{gw}/live`, and `entry/{id}` endpoints; current-season detail only, with past seasons available as totals rather than gameweek rows.
- `scripts/compute_forecast.py` — the current projection assembly (`load_minutes_model`, `team_fixture_multiplier`, `availability_multiplier`, `best_xi`). This is the code that U1 extracts into `engine/` to satisfy KD7 and R6.
- `scripts/minutes_model.py` — empirical-Bayes minutes model. Its `pStart` / `pCameo` / `pUnused` buckets feed the minutes-risk flag (R13, KTD9); its `expectedMinutes` feeds the model's minutes-risk input (R8).
- `scripts/resolve_entities.py` — the cross-season id map for R2. Its `PAST_SEASONS` constant fixes the archive depth (KTD3). Its `unresolved` list and row-count assertion are the pattern for never silently guessing a join.
- `scripts/snapshot.py` — the dated / gameweek-keyed JSON archive pattern under `data/`. `data/history/`, `data/predictions/`, and `data/record/` mirror it (KTD2). Finished gameweeks are keyed `gwNN.json` and never rewritten.
- `src/lib/snapshots.ts` and `src/app/page.tsx` — the static `data/` reader and the current single-recommendation UI that U13 replaces with the three-column view (R11).
- `.github/workflows/snapshot.yml` — the daily pipeline order that U12 extends.

---

## Planning Contract

### Approach

The Product Contract is the target; the scaffold is the starting point. The snapshotter, entity resolution, and minutes model are reused unchanged. Three things move:

1. **Projection logic becomes a library.** `scripts/compute_forecast.py` today mixes file loading, projection math, and `best_xi` selection in one `main()`. U1 lifts the math into an importable `engine/` package of pure functions; `scripts/compute_forecast.py` stays as a thin CLI wrapper that loads JSON, calls `engine`, and writes JSON. Every later unit builds on `engine/`.
2. **The model gains a sibling and an evaluation harness.** `engine/baseline.py` and `engine/model.py` are two projection functions over a shared feature frame. `engine/squad.py` ranks a squad against the pool over the 5-gameweek window. `scripts/log_predictions.py` and `scripts/score_predictions.py` write and then score a per-gameweek prediction log. `engine/backtest.py` replays archived seasons with a single leakage guard.
3. **The view becomes three columns.** `scripts/compute_forecast.py` emits a three-column structure into `data/forecast/gwNN.json`; `src/app/page.tsx` renders model / baseline / current-squad side by side with the running record.

### Key Technical Decisions

- KTD1. **`engine/` is a pure-Python package; `scripts/*` are thin CLI wrappers.** `engine/` functions take and return plain data structures and `pandas` frames, do no file I/O, call no network, and never `sys.exit`. Each `scripts/*.py` loads inputs from `data/`, calls one or more `engine` functions, and writes outputs to `data/`. This is the `engine/` + `app/` split the brainstorm cites. Instantiates KD7. Governs R6.
- KTD2. **The prediction log, running record, and historical archive are committed JSON under `data/`, keyed by gameweek, read statically.** `data/history/<season>/gwNN.json`, `data/predictions/gwNN.json`, `data/record/running.json`, `data/backtest/<run-id>.json`. (session-settled: user-directed — chosen over a database: the whole pipeline stays a git-committed file archive the static Next.js app reads at build time, with no runtime store and no new deploy dependency.) Governs R1, R3, R14, R15.
- KTD3. **The archive covers the last three completed seasons.** 2025-26, 2024-25, 2023-24 — the same list as `resolve_entities.py`'s `PAST_SEASONS`. (session-settled: user-directed — chosen over deeper history: it bounds the vaastav coverage-gap surface and the backtest replay cost, and keeps one season list across the codebase.) Governs R1, R16.
- KTD4. **The live composite baseline uses a within-season historical scoring average for v1.** The multi-season archive lands with the backtest; wiring the live baseline to it is Deferred to Follow-Up Work. (session-settled: user-directed — chosen over multi-season from v1: the live projection path stays unchanged while the archive is proven by the backtest first.) Governs R7.
- KTD5. **Tunable parameters live as named constants in `engine/config.py`, not scattered literals.** `ROLLING_WINDOW = 5` (KD8), the baseline component weights, the `MEANINGFUL_EDGE_PER_GW = 0.3` threshold (KD9), `ARCHIVE_SEASONS` (KTD3), the FDR multiplier coefficients, and the `MINUTES_RISK_PSTART` flag threshold (KTD9). `scripts/*` and `engine/*` import from this one module. Governs R7, R12, R16. The `ROLLING_WINDOW` value inherits KD8; the threshold value inherits KD9.
- KTD6. **The leakage guard is enforced in exactly one place.** `engine/backtest.py` builds each replayed gameweek's input frame by filtering the archive to rows whose gameweek is strictly less than the gameweek being projected, then runs the unmodified `engine.baseline` and `engine.model` functions over that frame. No projection function knows it is being backtested. Governs R17. Covers AE2.
- KTD7. **The prediction log and scoring record are append-only and gameweek-keyed.** `log_predictions.py` refuses to overwrite an existing `data/predictions/gwNN.json`. `score_predictions.py` records a gameweek with no stored file as `no_prediction` and never scores it from a projection generated after the deadline. Governs R14, R15. Covers AE4.
- KTD8. **Both projection functions are always constructed and always run in `compute_forecast.py`.** The three-column output is built by calling `engine.squad` three times — once with `engine.model`, once with `engine.baseline`, once with an identity projection over the current squad. No code path in the weekly computation or the view depends on a backtest artifact existing. Instantiates KD4. Governs R9. Covers AE3.
- KTD9. **Minutes risk is derived from the existing minutes model's start-probability buckets.** The model's minutes-risk *input* (R8) is `expectedMinutes / 90` from `data/minutes-model/`. The minutes-risk *flag* (R13) is raised when `pStart` is below `engine.config.MINUTES_RISK_PSTART`. Both come from the same `data/minutes-model/<date>.json` the scaffold already writes. Governs R8, R13.
- KTD10. **FDR stays the interim opponent-difficulty signal.** `engine.model` reuses the scaffold's `fdr_multiplier` and blank / double gameweek handling verbatim. The expected-goals λ model is Deferred to Follow-Up Work. Governs R8.
- KTD11. **Cold-start is a marker, not a number.** `engine/history.py` tags a player `cold_start` when entity resolution has no match for them and vaastav carries no prior-season row. `engine.baseline` and `engine.model` return a `cold_start` result object rather than a numeric projection; `engine.squad` and the view render "no history" and never rank a cold-start player into a recommendation. Governs R5. Covers AE1.

### High-Level Technical Design

Component topology. Boxes in `engine/` are pure; boxes in `scripts/` do I/O; the Action runs the scripts in order; the Next.js app reads the committed artifacts.

```mermaid
flowchart TB
  subgraph sources [Data sources]
    VA[vaastav archive CSVs]
    FPL[live FPL API]
  end
  subgraph scripts [scripts - CLI wrappers, I/O]
    ING[ingest_history.py]
    SNAP[snapshot.py - unchanged]
    RES[resolve_entities.py - unchanged]
    MIN[minutes_model.py - unchanged]
    CF[compute_forecast.py - now 3 columns]
    LOG[log_predictions.py]
    SCORE[score_predictions.py]
    BT[backtest.py]
  end
  subgraph engine [engine - pure library]
    CFG[config.py]
    HIST[history.py]
    FEAT[features.py]
    BASE[baseline.py]
    MODEL[model.py]
    SQ[squad.py]
    BTE[backtest.py]
  end
  subgraph data [data - committed JSON]
    DH[history season gwNN + coverage]
    DF[forecast gwNN - 3 columns]
    DP[predictions gwNN]
    DR[record running]
    DB[backtest run-id]
  end
  VA --> ING --> DH
  FPL --> SNAP
  DH --> HIST
  RES --> HIST
  MIN --> MODEL
  CFG --> BASE
  CFG --> MODEL
  CFG --> SQ
  CFG --> BTE
  HIST --> FEAT --> BASE
  FEAT --> MODEL
  BASE --> SQ
  MODEL --> SQ
  SQ --> CF --> DF
  BASE --> LOG
  MODEL --> LOG --> DP
  DP --> SCORE --> DR
  HIST --> BTE
  SQ --> BTE --> BT --> DB
  DF --> APP[src/app - three-column view]
  DR --> APP
```

Backtest leakage guard. One filter, applied once per replayed gameweek, to the same frame both projection functions consume.

```mermaid
flowchart TB
  A[backtest.py: for season in ARCHIVE_SEASONS] --> B[load full-season archive frame]
  B --> C[for gw in 1..38]
  C --> D["frame_before = archive rows with gw index below current gw (KTD6)"]
  D --> E[engine.model.project over frame_before]
  D --> F[engine.baseline.project over frame_before]
  E --> G[engine.squad over model projections -> squad points for gw]
  F --> H[engine.squad over baseline projections -> squad points for gw]
  G --> I[accumulate per-gw model pts and baseline pts]
  H --> I
  I --> C
  C --> J[per-season delta and pooled delta]
  J --> K["flag pooled mean delta at or above 0.3 pts per gw as meaningful (KD9)"]
  K --> L[write data/backtest/run-id.json]
```

### Assumptions

- vaastav's `gws/merged_gw.csv` exists for all three archive seasons and carries a gameweek column, a player id column, and `total_points` / `minutes` / ICT columns. Coverage flags (R3) record which of the richer columns (expected goals, defensive contribution) are present per season.
- The current-season live path (`snapshot.py` -> `minutes_model.py` -> `compute_forecast.py`) keeps working unchanged behind the extraction; U1 is behaviour-preserving.
- A `data/forecast/gwNN.json` fixture in the new three-column shape can be committed so `npm run build` is verifiable without a live pipeline run.
- The repo has no Python test runner today. This plan adds `pytest` and a top-level `tests/` directory.

### Sequencing

Six phases, dependency-ordered:

- **Phase A — Library extraction:** U1, U2.
- **Phase B — Multi-season history:** U3, U4.
- **Phase C — Projections:** U5, U6, U7.
- **Phase D — Weekly view computation and evaluation harness:** U8, U9, U10.
- **Phase E — Backtest:** U11.
- **Phase F — Integration:** U12 (Action), U13 (UI).

---

## Output Structure

```text
engine/
  __init__.py
  config.py            # U2  - tunable constants (KTD5)
  history.py           # U4  - multi-season player series, cold-start tagging (KTD11)
  features.py          # U1 skeleton, U5 feature frame
  baseline.py          # U5  - composite baseline projection (R7)
  model.py             # U6  - model projection = baseline inputs + FDR + minutes risk (R8)
  squad.py             # U1 skeleton, U7 gap ranking over ROLLING_WINDOW (R12)
  backtest.py          # U11 - season replay with the single leakage guard (KTD6)
scripts/
  ingest_history.py    # U3  - vaastav per-GW archive -> data/history/ (R1, R3)
  compute_forecast.py  # U1 rewrite + U8 - thin wrapper, now emits 3 columns
  log_predictions.py   # U9  - pre-deadline prediction log (R14)
  score_predictions.py # U10 - post-final scoring pass (R15)
  backtest.py          # U11 - CLI wrapper around engine/backtest.py (R16)
tests/
  test_history.py  test_baseline.py  test_model.py  test_squad.py
  test_backtest.py  test_predictions.py  test_ingest_history.py
  test_compute_forecast.py
data/
  history/<season>/gwNN.json
  history/coverage.json
  forecast/gwNN.json          # shape changes in U8
  predictions/gwNN.json
  record/running.json
  backtest/<run-id>.json
```

The tree is a scope declaration, not a constraint. Per-unit `Files` lists are authoritative.

---

## Implementation Units

### Unit Index

| U-ID | Title | Key files | Depends on |
|---|---|---|---|
| U1 | Extract projection into `engine/`, `compute_forecast.py` becomes a wrapper | `engine/*.py`, `scripts/compute_forecast.py`, `tests/test_compute_forecast.py` | — |
| U2 | Add analysis dependencies and `engine/config.py` | `requirements.txt`, `engine/config.py` | U1 |
| U3 | Multi-season gameweek archive ingestion | `scripts/ingest_history.py`, `data/history/`, `tests/test_ingest_history.py` | U2 |
| U4 | Cross-season player series + cold-start tagging | `engine/history.py`, `tests/test_history.py` | U1, U3 |
| U5 | Shared feature frame + composite baseline | `engine/features.py`, `engine/baseline.py`, `tests/test_baseline.py` | U1, U4 |
| U6 | Projection model (baseline inputs + FDR + minutes risk) | `engine/model.py`, `tests/test_model.py` | U1, U4, U5 |
| U7 | Squad-vs-pool gap ranking over the 5-GW window | `engine/squad.py`, `tests/test_squad.py` | U1, U5, U6 |
| U8 | `compute_forecast.py` emits the three-column structure | `scripts/compute_forecast.py`, `src/lib/snapshots.ts`, `tests/test_compute_forecast.py` | U5, U6, U7 |
| U9 | Pre-deadline prediction log | `scripts/log_predictions.py`, `tests/test_predictions.py` | U5, U6 |
| U10 | Post-gameweek scoring pass + running record | `scripts/score_predictions.py`, `data/record/running.json`, `tests/test_predictions.py` | U9 |
| U11 | Backtest replay with leakage guard | `engine/backtest.py`, `scripts/backtest.py`, `tests/test_backtest.py` | U4, U5, U6, U7 |
| U12 | Wire the daily Action pipeline | `.github/workflows/snapshot.yml` | U8, U9, U10 |
| U13 | Three-column Next.js view + running record | `src/app/page.tsx`, `src/lib/snapshots.ts`, `src/app/TransferForm.tsx` | U8, U10 |

### U1. Extract projection into `engine/`, `compute_forecast.py` becomes a wrapper

- **Goal:** Move the projection math out of `scripts/compute_forecast.py` into an importable `engine/` package of pure functions, with no behaviour change to the current best-XI output.
- **Requirements:** R6; KD7.
- **Dependencies:** none.
- **Files:**
  - create `engine/__init__.py`
  - create `engine/features.py` (skeleton — the per-player projection assembly currently built inline in `main()`, plus `availability_multiplier`, `team_fixture_multiplier`, `fdr_multiplier`)
  - create `engine/squad.py` (skeleton — `best_xi` and `VALID_FORMATIONS` and the captain / vice selection moved verbatim from the script)
  - modify `scripts/compute_forecast.py` (keep every `load_*` helper and the `out` dict assembly; replace the projection and selection blocks with `engine` calls)
  - create `tests/test_compute_forecast.py`
- **Approach:**
  1. Identify the pure region of `compute_forecast.py:main()` — everything between building `elements_by_id` and writing `out` that reads no file: the per-`pick` projection loop, `best_xi`, and the captain / vice selection.
  2. Move `best_xi` and `VALID_FORMATIONS` into `engine/squad.py` unchanged. Move `availability_multiplier`, `team_fixture_multiplier`, `fdr_multiplier` into `engine/features.py` unchanged.
  3. Expose one `engine.features` entry point that takes already-loaded dicts (bootstrap elements, minutes-model predictions, rolling averages, fixtures, picks, target gameweek) and returns the `squad` list of projection dicts.
  4. `compute_forecast.py` keeps every `load_*` helper and the `out` assembly; its body becomes: load, call `engine.features`, call `engine.squad.best_xi`, assemble `out`, write.
  5. The written `data/forecast/gwNN.json` shape is unchanged in this unit.
- **Execution note:** Characterization-first. Capture the current `data/forecast/gwNN.json` for the committed snapshot as a golden file before moving code; the unit is done when the wrapper reproduces it byte-for-byte.
- **Patterns to follow:** `scripts/minutes_model.py` module shape (module docstring, `from __future__ import annotations`, small pure helpers). `engine/` functions carry no `print` and no `sys.exit`.
- **Test scenarios:**
  - Happy path: given the committed `data/bootstrap-static`, `data/minutes-model`, `data/fixtures`, and `data/picks-1168513` fixtures, `engine.features` returns a projection list whose `projected` values match the pre-refactor script output for every player.
  - Happy path: `engine.squad.best_xi` on a known 15-player projection list returns the same starting XI and bench as the pre-refactor `best_xi`.
  - Edge case: a `pick` whose `element` id is absent from `bootstrap.elements` is skipped, as today.
  - Edge case: a player with no minutes-model entry falls back to the rolling average, as today.
  - Edge case: a blank gameweek (no fixture for the team) yields a `0.0` `fdrMultiplier` and a zeroed projection.
  - Integration: running `scripts/compute_forecast.py` end-to-end against the committed fixtures writes a `data/forecast/gwNN.json` identical to the committed golden file.
- **Verification:** `python -m pytest tests/test_compute_forecast.py` passes; `python scripts/compute_forecast.py` reproduces the golden `data/forecast/gwNN.json`; `rg "print|sys\\." engine/` returns nothing.

### U2. Add analysis dependencies and `engine/config.py`

- **Goal:** Add `pandas` and `pytest`, and create the single module of tunable constants.
- **Requirements:** supports R7, R12, R16 (KTD5).
- **Dependencies:** U1.
- **Files:**
  - modify `requirements.txt` (add `pandas`, `pytest`; keep the existing comment intent)
  - create `engine/config.py`
- **Approach:**
  1. `engine/config.py` holds `ROLLING_WINDOW = 5` (KD8), `ARCHIVE_SEASONS = ["2025-26", "2024-25", "2023-24"]` (KTD3), `MEANINGFUL_EDGE_PER_GW = 0.3` (KD9), `MINUTES_RISK_PSTART` (default `0.65`), `BASELINE_WEIGHTS` (a named dict over historical-average / ICT / form), and the `FDR_MULTIPLIER` coefficients lifted from `compute_forecast.fdr_multiplier`.
  2. `scripts/compute_forecast.py` and `scripts/minutes_model.py` import `ROLLING_WINDOW` from `engine.config` instead of defining their own literal.
  3. Each constant carries a one-line comment citing its owning KD / KTD.
- **Patterns to follow:** module-level uppercase constants with comments, as in `scripts/*` today.
- **Test scenarios:** `Test expectation: none -- pure constants and a dependency bump; behaviour is covered where the constants are consumed (U5, U7, U11).`
- **Verification:** `pip install -r requirements.txt` succeeds; `python -c "import engine.config"` succeeds; `rg "ROLLING_WINDOW = 5" scripts/` returns nothing.

### U3. Multi-season gameweek archive ingestion

- **Goal:** Ingest per-gameweek player rows for the three archive seasons from vaastav, and record per-season field availability.
- **Requirements:** R1, R3.
- **Dependencies:** U2.
- **Files:**
  - create `scripts/ingest_history.py`
  - create `data/history/` output (`data/history/<season>/gwNN.json`, `data/history/coverage.json`)
  - create `tests/test_ingest_history.py`
- **Approach:**
  1. For each season in `engine.config.ARCHIVE_SEASONS`, fetch `data/<season>/gws/merged_gw.csv` from `VAASTAV_BASE` (reuse the `urllib` + `User-Agent` pattern from `resolve_entities.py`).
  2. Normalise each row to `season`, `gw`, `historical_id`, `web_name`, `minutes`, `total_points`, `ict_index`, `was_home`, `opponent_team`, plus the richer columns (`expected_goals`, `expected_assists`, `defensive_contribution`) when present.
  3. Write one file per gameweek: `data/history/<season>/gwNN.json` as `{"season", "gw", "rows": [...]}`, keyed by gameweek and never rewritten once present (mirrors `snapshot.py`'s finished-gameweek rule).
  4. Write `data/history/coverage.json`: per season, the list of columns actually found, so downstream logic can tell an absent field from a real zero (R3).
  5. A season whose CSV 404s or is short is logged and skipped, not fatal — same degradation as `resolve_entities.py`.
  6. Row-count assertion: total rows written equals total data rows read across all seasons.
- **Patterns to follow:** `scripts/resolve_entities.py` — `fetch_text`, graceful per-season `HTTPError` handling, the "never silently drop rows" assertion discipline.
- **Test scenarios:**
  - Happy path: given a mocked two-gameweek `merged_gw.csv`, the script writes `data/history/<season>/gw1.json` and `gw2.json` with row counts matching the CSV.
  - Happy path: `coverage.json` lists `expected_goals` for a season whose CSV has that column and omits it for a season whose CSV does not. Covers R3.
  - Edge case: an existing `data/history/<season>/gw1.json` is not overwritten on a re-run.
  - Edge case: a player row with an empty `ict_index` cell is written with `null`, not `0`.
  - Error path: a 404 on one season's CSV logs a warning and still writes the other seasons.
  - Error path: a row-count mismatch between CSV rows read and JSON rows written raises `RuntimeError`.
- **Verification:** `python -m pytest tests/test_ingest_history.py` passes; a real run writes non-empty `data/history/2025-26/` and a `coverage.json` naming at least `total_points`, `minutes`, `ict_index` for every season.

### U4. Cross-season player series + cold-start tagging

- **Goal:** Given a current-season player, return their gameweek history across the archive seasons as one ordered series, and tag players with no resolvable history as cold-start.
- **Requirements:** R2, R5; KTD11.
- **Dependencies:** U1, U3.
- **Files:**
  - create `engine/history.py`
  - create `tests/test_history.py`
- **Approach:**
  1. `load_history(data_dir)` reads all `data/history/<season>/gwNN.json` into one `pandas` frame indexed by `(season, gw, historical_id)`.
  2. `player_series(current_id, resolved_map, history_frame)` uses `data/entity-resolution/<date>.json`'s `bySeason` map to collect that player's rows across seasons into one frame ordered by `(season, gw)`.
  3. `classify(current_id, resolved_map, history_frame, bootstrap_element)` returns `cold_start` when the resolved map has no `bySeason` entry for the player AND no archive row exists for any mapped id. Otherwise it returns `has_history` with the row count.
  4. A `cold_start` result is a small dataclass / dict with `status="cold_start"`, never a number (KTD11).
  5. `available_fields(season)` exposes `coverage.json` so callers branch on field presence rather than treating missing as zero (R3).
- **Patterns to follow:** `scripts/minutes_model.py`'s `load_entity_resolution` and `personal_prior` — same `resolved` / `bySeason` traversal, same "no entry -> fall through" posture.
- **Test scenarios:**
  - Happy path: a player resolved to all three seasons returns a series whose length equals the sum of their per-season gameweek rows, ordered oldest to newest.
  - Happy path: a player resolved to one season only returns just that season's rows.
  - Edge case: a player in the resolved map but with zero archive rows classifies as `cold_start`. Covers AE1.
  - Edge case: a promoted-team player absent from the resolved map classifies as `cold_start`. Covers AE1.
  - Edge case: `available_fields("2023-24")` omits a column that `coverage.json` did not record for that season.
  - Error path: a `historical_id` recorded as ambiguous (name collision) for a season is excluded from the series, not guessed.
- **Verification:** `python -m pytest tests/test_history.py` passes; `engine.history.classify` returns `cold_start` for a known promoted player and `has_history` for a known ever-present player using the committed `data/entity-resolution` and `data/history` fixtures.

### U5. Shared feature frame + composite baseline

- **Goal:** Build the per-player feature frame the projections share, and implement the composite baseline that uses only historical scoring average, ICT, and recent form.
- **Requirements:** R7; KD1, KTD4, KTD5, KTD11.
- **Dependencies:** U1, U4.
- **Files:**
  - modify `engine/features.py` (add `build_feature_frame`)
  - create `engine/baseline.py`
  - create `tests/test_baseline.py`
- **Approach:**
  1. `build_feature_frame(players, live_snapshot, history, rolling_window)` returns one row per player with `hist_scoring_avg` (mean `total_points` per appearance — within-season for v1 per KTD4), `ict_recent` (mean `ict_index` over the last `rolling_window` finished gameweeks), `form_recent` (mean `total_points` over the same window), and a `cold_start` flag from `engine.history.classify`.
  2. `engine.baseline.project(feature_row)` returns `points = w_hist * hist_scoring_avg + w_ict * ict_recent + w_form * form_recent` using `engine.config.BASELINE_WEIGHTS`. No fixture term, no minutes term (R7).
  3. A `cold_start` feature row returns a `cold_start` result object, not a number (KTD11).
  4. `project_pool(feature_frame)` maps `project` over every player and returns a frame of `(player_id, points, cold_start)`.
  5. Weights default to an equal split documented in `engine/config.py`; per-season weight tuning is Deferred to Follow-Up Work.
- **Patterns to follow:** `scripts/minutes_model.py`'s recent-window mean style; guard against a zero-length window.
- **Test scenarios:**
  - Happy path: a player with `hist_scoring_avg=4`, `ict_recent=6`, `form_recent=5` and equal weights returns `points = 5.0`.
  - Happy path: `project_pool` over a 3-player frame returns 3 rows with `cold_start=False`.
  - Edge case: a player with fewer than `rolling_window` finished gameweeks averages over the gameweeks available, not a divide-by-`rolling_window`.
  - Edge case: a `cold_start` feature row returns `status="cold_start"` and no `points` key. Covers AE1.
  - Edge case: an absent `ict_index` for a season (per `coverage.json`) contributes no term rather than a zero term.
  - Error path: `BASELINE_WEIGHTS` that do not sum to a positive number raises at import of `engine.config`, not silently.
- **Verification:** `python -m pytest tests/test_baseline.py` passes; `rg "fdr|minutes|expectedMinutes" engine/baseline.py` returns nothing.

### U6. Projection model

- **Goal:** Implement the model projection: the baseline's inputs plus fixture difficulty and minutes risk.
- **Requirements:** R8, R13; KTD9, KTD10.
- **Dependencies:** U1, U4, U5.
- **Files:**
  - create `engine/model.py`
  - create `tests/test_model.py`
- **Approach:**
  1. `engine.model.project(feature_row, fixtures, minutes_model, target_gw)` starts from `engine.baseline.project(feature_row)`, then multiplies by the FDR multiplier (`engine.features.team_fixture_multiplier`, KTD10) and by `expectedMinutes / 90` from `data/minutes-model/` (KTD9).
  2. `minutes_risk_flag(feature_row, minutes_model)` returns `True` when the player's `pStart` is below `engine.config.MINUTES_RISK_PSTART`. This is the R13 flag; it is separate from the `expectedMinutes/90` scaling that is the R8 input.
  3. The availability veto is applied after the projection, unchanged from the scaffold's `availability_multiplier`.
  4. A `cold_start` feature row returns a `cold_start` result (KTD11).
  5. A blank gameweek zeroes the projection; a double gameweek sums both legs — reuse `team_fixture_multiplier` verbatim.
- **Patterns to follow:** `scripts/compute_forecast.py`'s current `base * availability_multiplier(el) * fdr_mult` assembly — the model is that formula with the baseline output as `base` and an added minutes-model scaling.
- **Test scenarios:**
  - Happy path: a player with baseline `5.0`, FDR multiplier `1.2`, `expectedMinutes=81` projects `5.0 * 1.2 * 0.9 = 5.4`.
  - Happy path: `minutes_risk_flag` is `True` for `pStart=0.4` and `False` for `pStart=0.9` at the default threshold.
  - Edge case: a blank gameweek (`team_fixture_multiplier` returns `0.0`) projects `0.0`.
  - Edge case: a double gameweek projects roughly twice a single game via the summed multiplier, with no special-casing.
  - Edge case: an injured player (`status` in the unavailable set) projects `0.0` after the availability veto.
  - Edge case: a `cold_start` feature row returns `status="cold_start"` with no `points`. Covers AE1.
  - Integration: `engine.model.project` and `engine.baseline.project` over the same feature row differ only by `fdr_mult * expectedMinutes/90` (a test asserts the ratio).
- **Verification:** `python -m pytest tests/test_model.py` passes; a golden case with fixed inputs matches a hand-computed projection.

### U7. Squad-vs-pool gap ranking over the 5-GW window

- **Goal:** Rank the fifteen squad players against the best available alternative at a comparable price over the rolling window, and surface the largest projected gaps.
- **Requirements:** R12, R13; KD8, KTD5.
- **Dependencies:** U1, U5, U6.
- **Files:**
  - modify `engine/squad.py` (add `rank_against_pool` and `window_points`)
  - create `tests/test_squad.py`
- **Approach:**
  1. `window_points(project_fn, feature_frame, fixtures, minutes_model, start_gw, window)` sums each player's projection over `start_gw .. start_gw + window - 1` (`window = engine.config.ROLLING_WINDOW = 5`, KD8). Captaincy is scored on `start_gw` only.
  2. `rank_against_pool(squad_ids, pool_frame, project_fn, price_by_id, window_points_by_id)`: for each squad player, find the pool player at the same position within a price band of plus or minus `0.3m` with the highest window points; the gap is `best_alt_window_pts - squad_player_window_pts`.
  3. Return the fifteen `(squad_player, best_alternative, gap)` rows sorted by gap descending; the caller takes the top N for display.
  4. Attach `minutes_risk` (from `engine.model.minutes_risk_flag`) to any player returned as a recommended alternative (R13).
  5. Cold-start pool players are never returned as a best alternative (KTD11).
- **Patterns to follow:** `scripts/compute_forecast.py`'s `best_xi` position bucketing and `element_type` -> position mapping.
- **Test scenarios:**
  - Happy path: a squad forward projecting 4.0 window points against a same-price pool forward projecting 7.0 yields a gap of 3.0, ranked above a defender with a 1.0 gap.
  - Happy path: the result has exactly fifteen rows, one per squad player.
  - Edge case: a squad player who is already the best option at their position and price band yields a gap of 0 or negative and sorts last.
  - Edge case: a pool player 0.5m more expensive than the squad player is outside the band and not considered.
  - Edge case: the captaincy score for a squad player uses only `start_gw`, verified where the window total and the single-GW value diverge.
  - Edge case: a `cold_start` pool player projecting high on a stub is never returned as the best alternative. Covers AE1.
  - Edge case: `minutes_risk` is set on a recommended alternative whose `pStart` is below threshold. Covers R13.
- **Verification:** `python -m pytest tests/test_squad.py` passes; a test imports `engine.config.ROLLING_WINDOW` and asserts the window length used is 5.

### U8. `compute_forecast.py` emits the three-column structure

- **Goal:** Replace the single best-XI output with a three-column structure — model, baseline, current squad — plus a captain line and a running-record summary.
- **Requirements:** R10, R11; KD2, KTD8.
- **Dependencies:** U5, U6, U7.
- **Files:**
  - modify `scripts/compute_forecast.py`
  - modify `src/lib/snapshots.ts` (update the `Forecast` / `ForecastPlayer` types and reader to the new shape)
  - modify `tests/test_compute_forecast.py`
- **Approach:**
  1. `compute_forecast.py` builds the feature frame once (`engine.features.build_feature_frame`), then calls `engine.squad.rank_against_pool` three times: with `engine.model.project`, with `engine.baseline.project`, and with an identity projection over the current squad's own recent form (KTD8).
  2. Output `data/forecast/gwNN.json`: `{ "basedOnGameweek", "targetGameweek", "columns": { "model": [...], "baseline": [...], "currentSquad": [...] }, "captain": { "webName", "id", "column": "model" }, "runningRecord": <data/record/running.json summary or null> }`.
  3. Each column entry: `{ "squadPlayer", "bestAlternative", "gapPoints", "minutesRisk" }`, top N by gap.
  4. The team id is read from `FPL_TEAM_ID` config exactly as `snapshot.py` does; no login (R10).
  5. All three columns are always written; no branch omits a column when a backtest is absent (KTD8, AE3).
  6. `src/lib/snapshots.ts` — replace the `Forecast` / `ForecastPlayer` types with the three-column shape; `loadLatestForecast` returns it; keep the file-scan logic.
- **Execution note:** Start with a failing test for the new `data/forecast/gwNN.json` contract, then reshape the wrapper.
- **Patterns to follow:** the existing `out` dict assembly and `data/forecast/` write path in `compute_forecast.py`; keep `sort_keys=True`.
- **Test scenarios:**
  - Happy path: the output has all three keys under `columns`, each a non-empty list, given the committed fixtures.
  - Happy path: `captain` names the model column's highest single-GW projected starter.
  - Edge case: with no `data/record/running.json`, `runningRecord` is `null` and the file still writes.
  - Edge case: with `data/backtest/` absent entirely, all three columns still render. Covers AE3.
  - Edge case: a cold-start squad player appears in the `currentSquad` column marked no-history and is given no numeric gap. Covers AE1.
  - Integration: `npm run build` succeeds against a committed `data/forecast/gwNN.json` in the new shape.
- **Verification:** `python -m pytest tests/test_compute_forecast.py` passes; `python scripts/compute_forecast.py` writes the three-column file; `npm run build` passes against the committed fixture.

### U9. Pre-deadline prediction log

- **Goal:** Before a gameweek deadline, store that gameweek's model and baseline per-player projections, and never overwrite an existing entry.
- **Requirements:** R14; KD3, KTD7.
- **Dependencies:** U5, U6.
- **Files:**
  - create `scripts/log_predictions.py`
  - create `tests/test_predictions.py` (shared with U10)
- **Approach:**
  1. Determine the upcoming gameweek from `bootstrap-static` `events` — the first not-finished event whose deadline has not passed.
  2. If `data/predictions/gw<upcoming>.json` already exists, exit 0 without writing (KTD7).
  3. Otherwise build the feature frame and write `{ "gameweek", "generatedAt", "deadline", "model": { "<player_id>": points, ... }, "baseline": { ... } }` for the whole player pool.
  4. A cold-start player is written with `null`, not a number (KTD11).
  5. Runs from the daily Action; the pre-deadline window is whichever daily runs land before the deadline (U12).
- **Patterns to follow:** `scripts/snapshot.py`'s `finished_gameweeks` / event inspection and its "file exists -> skip" guard for gameweek-keyed files.
- **Test scenarios:**
  - Happy path: given upcoming gameweek 7 and no existing file, the script writes `data/predictions/gw7.json` with `model` and `baseline` maps covering the pool.
  - Edge case: `data/predictions/gw7.json` already present -> the script exits 0 and the file is byte-identical.
  - Edge case: a cold-start player's entry is `null` in both maps.
  - Edge case: the deadline for the upcoming gameweek has already passed -> no file is created for it. Covers AE4.
  - Error path: no not-finished event in `bootstrap-static` (season over) -> the script logs and exits 0.
- **Verification:** `python -m pytest tests/test_predictions.py -k log` passes; a second run in the same gameweek is a no-op.

### U10. Post-gameweek scoring pass + running record

- **Goal:** Once a gameweek's results are final, score the stored projections against actual points and update the running model-versus-baseline record.
- **Requirements:** R15; KD3, KTD7.
- **Dependencies:** U9.
- **Files:**
  - create `scripts/score_predictions.py`
  - create / populate `data/record/running.json`
  - modify `tests/test_predictions.py`
- **Approach:**
  1. For each finished gameweek with a `data/event-live/gwNN.json` and no entry yet in `data/record/running.json`:
     - If `data/predictions/gwNN.json` is missing, append `{ "gameweek": N, "status": "no_prediction" }` and continue (KTD7, AE4).
     - Otherwise compute a squad-level score for the model column and the baseline column against actual `total_points`, and append `{ "gameweek": N, "modelPoints", "baselinePoints", "delta" }`.
  2. `data/record/running.json`: `{ "entries": [...], "summary": { "gameweeksScored", "modelTotal", "baselineTotal", "pooledDeltaPerGw", "meaningful": <pooledDeltaPerGw >= engine.config.MEANINGFUL_EDGE_PER_GW> } }` (KD9).
  3. Idempotent: a gameweek already in `entries` is never re-scored.
  4. Squad-level scoring reuses the same `engine.squad` selection the weekly view uses, so the record measures the same thing the columns show.
- **Patterns to follow:** `scripts/snapshot.py`'s per-gameweek keyed files and "already present -> skip"; `compute_forecast.py`'s squad selection.
- **Test scenarios:**
  - Happy path: gameweek 5 with a stored prediction and final results -> `running.json` gains a gameweek-5 entry with `modelPoints`, `baselinePoints`, `delta`, and `summary.gameweeksScored` increments.
  - Happy path: `summary.meaningful` is `true` when the pooled per-gameweek delta is 0.35 and `false` when it is 0.2.
  - Edge case: gameweek 6 finished with no `data/predictions/gw6.json` -> entry is `{ "gameweek": 6, "status": "no_prediction" }` and is not counted in `gameweeksScored`. Covers AE4.
  - Edge case: re-running the pass does not duplicate or change any existing entry.
  - Edge case: a gameweek whose `event-live` is present but not yet final is not scored.
  - Integration: after U9 logs gameweek 7 and results later land, the scoring pass produces a gameweek-7 entry whose `modelPoints` matches an independent hand computation over the fixture.
- **Verification:** `python -m pytest tests/test_predictions.py` passes; two consecutive runs of `score_predictions.py` leave `data/record/running.json` unchanged after the first.

### U11. Backtest replay with leakage guard

- **Goal:** Replay each archive season gameweek by gameweek under a single knowable-before-deadline input filter, and report model and baseline squad-level outcomes over the same period.
- **Requirements:** R16, R17; KD9, KTD3, KTD6.
- **Dependencies:** U4, U5, U6, U7.
- **Files:**
  - create `engine/backtest.py`
  - create `scripts/backtest.py`
  - create `tests/test_backtest.py`
- **Approach:**
  1. `engine.backtest.replay(season, history_frame, project_fns)`: for each `gw` in that season, build `frame_before = history_frame[history_frame.gw < gw]` (KTD6), run each projection function over `frame_before`, run `engine.squad` to pick a squad-level XI, and record model points and baseline points for `gw` from `history_frame[history_frame.gw == gw]` actual results.
  2. No projection function receives the gameweek index or an "is-backtest" flag; the only guard is the frame filter, in one place (KTD6).
  3. `scripts/backtest.py` loops `engine.config.ARCHIVE_SEASONS`, calls `replay`, aggregates per-season deltas and a pooled delta, and writes `data/backtest/<run-id>.json`: `{ "runId", "generatedAt", "seasons": { "<season>": { "modelPoints", "baselinePoints", "delta", "gameweeks" }, ... }, "pooled": { "modelPoints", "baselinePoints", "deltaPerGw", "meaningful" } }`.
  4. `meaningful` is `pooled.deltaPerGw >= engine.config.MEANINGFUL_EDGE_PER_GW` (KD9). The report always exits 0, including on a losing model (KD4, AE3).
  5. Field availability (R3) is respected: a season missing a column contributes no term for it in both model and baseline, keeping the comparison like-for-like.
- **Execution note:** Start with a failing leakage test (AE2) — assert that a projection for gameweek 12 is unchanged when gameweek 12+ rows are deleted from the input frame.
- **Patterns to follow:** `engine.squad` selection from U7; `engine.history.load_history` from U4.
- **Test scenarios:**
  - Happy path: a two-season synthetic archive produces a `data/backtest/<run-id>.json` with a `seasons` entry per season and a `pooled` block.
  - Happy path: `pooled.deltaPerGw` equals `(model total - baseline total) / total gameweeks scored`.
  - Leakage guard: projecting gameweek 12 over `frame_before` yields an identical result whether or not gameweek 12–38 rows are present in the full frame. Covers AE2, R17.
  - Leakage guard: no function in `engine/backtest.py` passes `gw` or a backtest flag into `engine.model.project` or `engine.baseline.project` (asserted by signature inspection or a spy).
  - Edge case: a season whose `coverage.json` lacks `expected_goals` still replays, and neither model nor baseline uses that column for that season.
  - Edge case: a model that loses on every season still writes the report and exits 0. Covers AE3.
  - Edge case: `meaningful` is `false` at `deltaPerGw = 0.29` and `true` at `0.31`.
- **Verification:** `python scripts/backtest.py` runs to completion over the three archived seasons and writes a report with per-season and pooled deltas; `python -m pytest tests/test_backtest.py` passes, including the leakage test.

### U12. Wire the daily Action pipeline

- **Goal:** Run ingestion, prediction logging, scoring, and the three-column computation in the daily Action, in dependency order.
- **Requirements:** supports R1, R14, R15 in the automated pipeline.
- **Dependencies:** U8, U9, U10.
- **Files:**
  - modify `.github/workflows/snapshot.yml`
- **Approach:**
  1. Keep the existing order: `snapshot.py` -> `resolve_entities.py` -> `minutes_model.py` -> `compute_forecast.py`.
  2. Add `ingest_history.py` once near the top; it is cheap when `data/history/` is populated because it skips existing gameweek files.
  3. Add `log_predictions.py` after `minutes_model.py` and before `compute_forecast.py` (the prediction log captures the pre-deadline state).
  4. Add `score_predictions.py` after `snapshot.py` (needs fresh `event-live`) and before `compute_forecast.py` (so `runningRecord` in the forecast is current).
  5. `pip install -r requirements.txt` replaces the "stdlib only" assumption in the workflow.
  6. Each step fails loud per-endpoint as the existing steps do; one failing step does not silently skip the rest.
- **Patterns to follow:** the current `snapshot.yml` step structure and its per-step failure reporting.
- **Test scenarios:**
  - Integration: a sequential run of all steps on a clean checkout completes with `data/history/`, `data/predictions/`, `data/record/`, and the three-column `data/forecast/` all written or updated.
  - Integration: with `data/history/` already populated, the `ingest_history.py` step is a no-op and adds no commit churn.
  - Edge case: `log_predictions.py` running twice in one gameweek (two daily runs before the deadline) produces one prediction file.
  - `Test expectation: workflow YAML has no unit tests; correctness is the integration run above.`
- **Verification:** a manual end-to-end run of the steps in order on a clean checkout completes without error and produces the expected `data/` artifacts.

### U13. Three-column Next.js view + running record

- **Goal:** Replace the best-XI / captain page with three parallel columns and make the running out-of-sample record readable at a glance.
- **Requirements:** R11, R12, R13; KD2, and the second Success Criterion.
- **Dependencies:** U8, U10.
- **Files:**
  - modify `src/app/page.tsx`
  - modify `src/lib/snapshots.ts` (consume the new `Forecast` shape from U8)
  - modify `src/app/TransferForm.tsx` (squad prop now comes from the `currentSquad` column)
- **Approach:**
  1. Render three columns for the target gameweek: model, baseline, current squad. Each lists the top gap rows (`squadPlayer` -> `bestAlternative`, `gapPoints`), with a minutes-risk marker on any recommended alternative (R13).
  2. A header line shows the running record from `runningRecord`: gameweeks scored, model total, baseline total, pooled delta per gameweek, and the `meaningful` flag — visible without scrolling (Success Criterion 2).
  3. The captain line (from the model column, single upcoming gameweek) stays near the top.
  4. Cold-start players in the current-squad column render "no history" instead of a projection (KTD11, AE1).
  5. Keep `export const dynamic = "force-static"` and the `data/` file reads; keep the transfer form.
  6. Preserve the single deliberate light theme and the existing card / position-badge styling.
- **Patterns to follow:** the existing `Card`, `PlayerRow`, `PositionBadge`, and `Header` components in `src/app/page.tsx`; the `loadLatestForecast` file-scan in `src/lib/snapshots.ts`.
- **Test scenarios:**
  - Happy path: given a committed three-column `data/forecast/gwNN.json` fixture, the page renders three column sections each with their gap rows.
  - Happy path: the running-record header shows `meaningful` as a visible badge when `runningRecord.summary.meaningful` is true.
  - Edge case: `runningRecord` null (no scored gameweeks yet) -> the header shows "no out-of-sample record yet" and the columns still render. Covers AE3.
  - Edge case: a cold-start player in `currentSquad` renders "no history" and no gap number. Covers AE1.
  - Edge case: no `data/forecast/` file yet -> the existing "no forecast yet" fallback still renders.
- **Verification:** `npm run build` succeeds; `npm run lint` is clean; the three columns and the running-record line are visible in the built app against the committed fixture.

---

## Verification Contract

| Command | Applies to | Gate |
|---|---|---|
| `pip install -r requirements.txt` | U2 | dependencies resolve; `import engine.config`, `import pandas` succeed |
| `python -m pytest tests/` | U1, U3–U11 | all engine and script unit tests pass, including the AE1–AE4 scenario tests |
| `python scripts/compute_forecast.py` | U1, U8 | writes `data/forecast/gwNN.json` — byte-identical golden shape for U1, three-column shape for U8 — against committed fixtures, no error |
| `python scripts/log_predictions.py` (twice) | U9 | second run is a no-op; `data/predictions/gwNN.json` unchanged |
| `python scripts/score_predictions.py` (twice) | U10 | second run leaves `data/record/running.json` unchanged |
| `python scripts/backtest.py` | U11 | completes over the three archived seasons; writes `data/backtest/<run-id>.json` with per-season and pooled deltas and the `meaningful` flag; exits 0 even on a losing model |
| `npm run build` | U8, U13 | Next.js static build succeeds against a committed three-column `data/forecast/gwNN.json` fixture |
| `npm run lint` | U13 | eslint clean |
| manual pipeline run | U12 | the daily Action's steps run in order on a clean checkout and produce `data/history/`, `data/predictions/`, `data/record/`, `data/forecast/` |

Acceptance examples are gated by named tests: AE1 in `tests/test_history.py`, `tests/test_baseline.py`, `tests/test_model.py`, and `tests/test_compute_forecast.py`; AE2 in `tests/test_backtest.py`; AE3 in `tests/test_backtest.py` and `tests/test_compute_forecast.py`; AE4 in `tests/test_predictions.py`.

---

## Definition of Done

**Global**

- All thirteen units are landed as dependency-ordered commits on the default branch.
- `python -m pytest tests/` is green; `npm run build` and `npm run lint` are green.
- `engine/` contains no `print`, no `sys.exit`, no file I/O, and no network call.
- The daily Action runs the full pipeline in order on a clean checkout without failure and commits the new `data/` artifacts.
- The three-column view renders from committed data, with the running model-versus-baseline record visible without scrolling.
- `scripts/backtest.py` produces a report over the three archived seasons with the leakage guard applied identically to model and baseline.
- AE1–AE4 each have a passing test.
- No dead-end or experimental code remains in the tree. Interim shims — old single-column `data/forecast` readers, any U1 characterization golden files kept only for the extraction step — are removed once their successor unit lands.
- `README.md`'s "Status" section is updated to list the shipped components (headless `engine/`, composite baseline, three-column view, prediction log, scoring pass, backtest) and the still-deferred items (λ model, live multi-season baseline, transfer budget arithmetic).

**Per unit**

- Each unit's `Verification` block is its definition of done. A unit is not complete until its own tests pass and its verification commands produce the stated outputs.
