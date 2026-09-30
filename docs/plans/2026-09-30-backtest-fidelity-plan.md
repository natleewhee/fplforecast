# Backtest fidelity: make the backtest measure the model that's actually live

Status: planned, not started. Written 2026-09-30.
Follows from: [[2026-09-30-xp-model-residual-analysis]].
Build order: 1 → 2 → 3 → 4. Phases 1–3 are each their own PR; Phase 4 is analysis, not code.

## Why

The residual analysis found GKP and DEF underprojected in the backtest
(bias +0.277 and +0.136 pts/GW). Root cause: the backtest is not scoring
the same model the app runs. Three gaps:

| # | Gap | Effect in backtest | Affects live app? |
|---|---|---|---|
| A | `_adapt_history()` drops `defensive_contribution` | DC component always 0 | No (live reads event-live) |
| B | Archive never ingests `saves`, `bonus`, `yellow_cards`, `goals_conceded` | Saves, bonus and cards components always 0 | Partly: no prior-season priors for these rates |
| C | Backtest uses `team_strength_table` (FPL admin ratings); live uses `team_goal_rate_table` (real goals) | Opponent-strength effect measured with the coarser, stale signal | No |

Until all three are fixed, no backtest number (including the "model beats
baseline" edge) can be trusted as a read on the live model.

---

## Phase 1: Pass `defensive_contribution` through the backtest (gap A)

### Problem
`engine/backtest.py:_adapt_history()` (lines 79–97) builds a synthetic
event-live payload with only `total_points`, `minutes`, `ict_index`,
`expected_goals`, `expected_assists`. `engine/features.py:_LIVE_RATE_STATS`
reads `dc90` from `stats["defensive_contribution"]`, finds nothing, and
returns 0. The 2025-26 archive does carry the field (`coverage.json`).

### Approach
Add `defensive_contribution` to the stats dict. A missing column should
stay absent (`None`), not become 0, so seasons without it (2023-24,
2024-25) fall back to the position prior exactly as live does.

### Files
- `engine/backtest.py`: add the field to `_adapt_history()`'s stats dict.
- `tests/test_backtest.py`: a test that a 2025-26-shaped row with
  `defensive_contribution` yields a non-zero `dc90` in the feature frame, and
  a row without the column yields the prior, not 0.

### Watch-outs
- Before the 2025-26 rule, DC scored nothing. Don't let a zero-DC season
  drag the blended `dc90` down for a season where it scores; check how
  `_rate_features` blends across the window.

### Done when
- [ ] Backtest DEF/MID `defensiveContribution` component is non-zero for 2025-26
- [ ] `pytest` passes

---

## Phase 2: Ingest the missing per-GW stats (gap B)

### Problem
`scripts/ingest_history.py:GW_RICH_COLUMNS` (line 51) only lists
`expected_goals`, `expected_assists`, `defensive_contribution`. So `saves`,
`bonus`, `yellow_cards` and `goals_conceded` are never in the archive, and
the backtest scores those four rates as 0 for every player in every season.
The earlier GKP output confirms it: `saves`, `bonus` and `cards` components
all averaged exactly 0.000.

### Approach
1. Confirm the vaastav `merged_gw.csv` source carries `saves`, `bonus`,
   `yellow_cards`, `goals_conceded` for each archived season. **Unverified**:
   I believe it does (they're standard FPL per-GW fields), but this sandbox
   can't reach the source, so check first.
2. Add them to `GW_RICH_COLUMNS` and to `_INT_FIELDS` for coercion. Keep the
   existing R3 rule: only kept for seasons whose CSV has the column.
3. Re-run `scripts/ingest_history.py`, commit the regenerated
   `data/history/` and `coverage.json`.
4. Pass all four through `_adapt_history()` (same edit site as Phase 1).

### Files
- `scripts/ingest_history.py`: four new rich columns.
- `engine/backtest.py`: four more stats fields in `_adapt_history()`.
- `data/history/**`: regenerated archive (large diff, data only).
- `tests/test_ingest_history.py`: the new columns survive normalisation;
  coverage lists them only when present.

### Watch-outs
- The regenerated archive diff will be large. Keep it in its own commit,
  separate from code, so review stays readable.
- Deploy size: check `scripts/compress_deploy_data.py` / `data-deploy/`
  still fits after the archive grows.
- Live impact is small but real: `engine/features.py:_ARCHIVE_RATE_NAMES`
  is currently `("xg90", "xa90", "dc90")`. Adding `saves90` etc. to it would
  give keepers a prior-season blend. That is a **model change**, not a
  backtest fix, so leave it out of this phase and decide after Phase 4.

### Done when
- [ ] `coverage.json` lists the four new fields for every season the source carries them
- [ ] Backtest GKP `saves`, and all positions' `bonus`/`cards`, are non-zero
- [ ] `pytest` passes; deploy bundle still builds

---

## Phase 3: Backtest with the live team-strength table (gap C)

### Problem
Live forecasts build opponent strength from real goals
(`engine.team_goals.team_goal_rate_table`, called at
`scripts/compute_forecast.py:795`). The backtest still uses FPL's admin
ratings (`engine.strength.team_strength_table`, `engine/backtest.py:145`),
which its own docstring says barely separate elite and weak teams.

### Approach
Switch `replay()` to `team_goal_rate_table`, rebuilt **per replayed
gameweek**, not once per season, from:
- every *earlier* archived season's finished fixtures, in full, and
- the replayed season's fixtures with `kickoff_time` strictly before that
  gameweek's deadline.

Fixture rows already carry `kickoff_time`, `finished` and scores, so the
same leakage rule as `_frame_before` applies.

### Files
- `engine/backtest.py`: `replay()` takes the other seasons' fixtures/teams;
  builds the goal-rate table inside the gameweek loop from a leak-filtered
  fixture list.
- `scripts/backtest.py`: load all seasons' fixtures and teams once, pass
  them in (reuse the loaders in `compute_forecast.py`).
- `tests/test_backtest.py`: a leakage test — a fixture kicking off after
  the deadline must not change the table (mirror the existing
  `_frame_before` test).

### Watch-outs
- **Leakage is the main risk.** Live pools every season including later
  ones; the backtest must not. Replaying 2023-24 must not see 2024-25 or
  2025-26 fixtures. `ARCHIVE_SEASONS` is ordered newest first; filter by
  season order explicitly, not list position.
- The earliest season has no prior season, so early GWs will lean on
  shrinkage toward 1.0 (`TEAM_GOALS_SHRINKAGE_MATCHES`). That's honest, not
  a bug, but expect a slightly weaker early-2023-24 read.
- Runtime: rebuilding per GW is ~114 table builds over a few thousand
  fixtures each. Cheap, but check the backtest still runs in minutes.

### Done when
- [ ] Backtest uses `team_goal_rate_table`, leak-filtered per gameweek
- [ ] Leakage test passes
- [ ] `scripts/backtest.py` still completes and writes its report

---

## Phase 4: Re-run the residual analysis and decide

Not a code change. Re-run the per-component residual analysis from
[[2026-09-30-xp-model-residual-analysis]] against the fixed backtest and
compare:

| Question | If yes | If no |
|---|---|---|
| Does GKP/DEF bias fall to MID/FWD's near-zero level? | The live model was fine; gap was measurement only | A real model gap remains; look at `engine/model.py`'s saves/DC formulas |
| Does the model-vs-baseline edge in `scripts/backtest.py` change? | Update the headline claim wherever it's shown | Note it's now confirmed on a faithful backtest |
| Do attackers vs leaky defences show a smaller residual than under the old table? | Evidence the goal-rate table earns its place | Look at `TEAM_GOALS_SHRINKAGE_MATCHES` |

Commit the analysis script this time (`scripts/residual_analysis.py`) so
the comparison can be repeated after any future model change.

Only after this phase: decide whether to add `saves90`/`bonus90`/
`yellow90` to `_ARCHIVE_RATE_NAMES` (a live-model change, see Phase 2
watch-outs).

---

## Cross-cutting

- **Checks per PR:** `pytest`, then `git status` for incidental changes to
  `data/pool-context/*.pkl` / `data/forecast/*.json` from the test fixture;
  revert any before committing (known repo issue).
- **No live forecast change in Phases 1–3.** Every edit is in the backtest
  or archive. Confirm by regenerating one `data/forecast/gwN.json` before and
  after and diffing: it should be identical.
- **Out of scope:** changing any model formula, weight or constant. That
  waits for Phase 4's evidence.

## Open decisions for Nat
1. Phase 2 regenerates the whole history archive (large data commit). OK
   to commit it, or keep the archive regeneration out of git?
2. Phase 4: commit the residual-analysis script as a permanent tool, or
   keep it ad hoc?
