# Backtest fidelity: make the backtest measure the model that's actually live

Status: in progress (Phases 1–2 built). Written 2026-09-30. Phase 1 revised the same day (see below).
Follows from: [[2026-09-30-xp-model-residual-analysis]].
Build order: 1 → 2 → 3 → 4. Each phase is its own PR.

## Why

The residual analysis found GKP and DEF underprojected in the backtest
(bias +0.277 and +0.136 pts/GW). Root cause: the backtest is not scoring
the same model the app runs. Three gaps:

| # | Gap | Effect in backtest | Affects live app? |
|---|---|---|---|
| ~~A~~ | ~~`_adapt_history()` drops `defensive_contribution`~~ **Not a real gap**: the backtest always passed it; my ad hoc analysis script didn't | n/a | n/a |
| B | Archive never ingests `saves`, `bonus`, `yellow_cards`, `goals_conceded` | Saves, bonus and cards components always 0 | Partly: no prior-season priors for these rates |
| C | Backtest uses `team_strength_table` (FPL admin ratings); live uses `team_goal_rate_table` (real goals) | Opponent-strength effect measured with the coarser, stale signal | No |

Until B and C are fixed, no backtest number (including the "model beats
baseline" edge) can be trusted as a read on the live model.

---

## Phase 1: A residual analysis that can't drift from the backtest

### Problem
The first residual analysis copied the backtest's replay loop by hand, left
out `defensive_contribution`, and reported a bug that isn't there (gap A
above). Any analysis that re-implements the replay can drift the same way.

### Approach
- Split `engine/backtest.py:replay()` into `replay_gameweeks()`, a generator
  yielding each leak-safe gameweek (feature frame, model context, actual
  rows), and a thin `replay()` that scores squads from it.
- Add `scripts/residual_analysis.py`, built on `replay_gameweeks()`, that
  reports per-player residuals by position, season, component (when played)
  and, for attackers, by the fixture's projected team goals (`lambdaFor`).
- Phase 3 then only has to change the team-strength table in one place.

### Files
- `engine/backtest.py`: `ReplayedGameweek`, `replay_gameweeks()`; `replay()` uses it.
- `scripts/residual_analysis.py`: new.
- `tests/test_backtest.py`, `tests/test_residual_analysis.py`.

### Done when
- [x] `replay()` output identical before and after the refactor (checked on the full archive)
- [x] Analysis runs on the real archive and reports the baseline below
- [x] `pytest` passes

### Phase 1 results (baseline for Phases 2–4)

| Position | n | bias | MAE |
|---|---|---|---|
| GKP | 9,229 | **+0.277** | 0.575 |
| DEF | 27,106 | −0.056 | 1.099 |
| MID | 36,524 | −0.135 | 1.058 |
| FWD | 9,650 | −0.021 | 1.127 |

Components when played: `saves`, `bonus` and `cards` are **0.000 for every
position** (gap B). `defensiveContribution` is non-zero (DEF 0.38, MID 0.28).

Attackers (MID/FWD, played) by the fixture's projected team goals:

| Tercile | avg λ for | bias | MAE |
|---|---|---|---|
| Low | 1.42 | +0.03 | 1.78 |
| Mid | 1.56 | +0.28 | 2.04 |
| High | 1.71 | **+0.50** | 2.19 |

Attackers are increasingly underprojected as the fixture gets better. The
opponent-strength bump is too weak in the backtest, consistent with gap C
(the admin-rating table compresses elite vs weak teams). Phase 3 tests this.

New lead, not acted on: MID is overprojected (−0.135), and 2025-26 overall
is −0.219, the season DC scores. A possible cause is
`engine/model.py`'s DC term, `min(1, dc90 / threshold)`, which treats a rate
ratio as a probability. Revisit in Phase 4.

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
   `yellow_cards`, `goals_conceded` for each archived season. **Checked
   2026-09-30: all three seasons carry all four.**
2. Add them to `GW_RICH_COLUMNS` and to `_INT_FIELDS` for coercion. Keep the
   existing R3 rule: only kept for seasons whose CSV has the column.
3. Re-run `scripts/ingest_history.py --rewrite` (new flag: existing GW
   files are otherwise never rewritten, so `coverage.json` would list fields
   the files lack), commit the regenerated `data/history/` and
   `coverage.json`. The daily cron's plain run keeps them consistent after.
4. Pass all four through `_adapt_history()`.

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
- [x] `coverage.json` lists the four new fields for every season the source carries them
- [x] Backtest GKP `saves`, and all positions' `bonus`/`cards`, are non-zero
- [x] `pytest` passes; deploy bundle still builds (history gzips to 2.3 MB)

### Phase 2 results

- Rebuild only added fields: all 114 GW files and 87,087 rows are otherwise identical.
- Live forecast unchanged: `compute_forecast.py` output identical before and after (excluding `generatedAt`).
- Archive 35 MB → 43 MB on disk.

| Position | bias before | bias after | MAE after |
|---|---|---|---|
| GKP | +0.277 | **−0.023** | 0.656 |
| DEF | −0.056 | −0.040 | 1.090 |
| MID | −0.135 | −0.136 | 1.058 |
| FWD | −0.021 | −0.111 | 1.162 |

GKP saves now average 0.92 pts per played GW. Squad backtest edge over the
baseline: **2.74 → 3.39 pts/GW** (model XI 5,333 → 5,405 over 111 GWs).

Still open: attackers by fixture λ, +0.00 (low) → +0.23 → **+0.45** (high).
MID/FWD now slightly overprojected overall, 2025-26 worst (−0.26).

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
- `engine/backtest.py`: `replay_gameweeks()` (Phase 1) takes the other
  seasons' fixtures/teams and builds the goal-rate table inside its gameweek
  loop from a leak-filtered fixture list.
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

Use `scripts/residual_analysis.py` (Phase 1) and compare against the
Phase 1 baseline.

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

## Decisions (Nat, 2026-09-30)
1. Phase 2: **commit** the regenerated history archive, in its own commit.
2. **Keep** the residual-analysis script in the repo as a permanent tool.
