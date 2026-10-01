# Model changes: prior-season rates, DC probability, team-strength tuning

Status: in progress (Phase 1 built; acceptance rule revision awaiting Nat). Written 2026-09-30.
Follows from: [[2026-09-30-backtest-fidelity-plan]] (Phase 4 leads).
Build order: 1 → 2 → 3 → 4. Each phase is its own PR. Phases 2–4 each change
live projections and ship only if they pass the acceptance rule below.

## Already shipped: the id-collision hotfix

[PR #63](https://github.com/natleewhee/fplforecast/pull/63), shipped ahead of this plan per Nat's call.
`archive_rates()` grouped history by player id alone; FPL reuses ids each
season, so prior-season rates mixed different players (a keeper was
projected 0.8 pts from goals). 200 of 487 players moved ≥0.1 xP. The
backtest couldn't score it because it never uses prior-season rates, which
is what Phase 1 fixes.

## Acceptance rule (Nat, 2026-09-30: tune on two seasons, confirm on one)

> Phase 1 found the XI-points metric below too noisy to decide anything; a
> revision is proposed under "Phase 1 results".

- **Tune** on 2023-24 + 2024-25. Pick any setting (a constant, a
  distribution parameter) using only these.
- **Confirm** on 2025-26, run once per candidate after tuning is done.
- **Accept** a change only if both hold:
  1. Tune seasons: model XI points improve, measured as the paired
     per-gameweek difference (new − old). Mean > 0 and the mean minus two
     standard errors > 0 (roughly: better by more than noise).
  2. Holdout: the paired per-GW mean is ≥ 0 (not worse), and the residual
     metric the change targets moves the right way.
- Report both even when a change is rejected. A rejected change is a
  result, not a failure.

Why paired per-GW: season totals swing with a few hauls (see the fat-tail
note in [[2026-09-30-xp-model-residual-analysis]]). Comparing the same
gameweek under old vs new model cancels most of that noise.

---

## Phase 1: Harness — prior-season rates in the backtest, plus holdout tooling

### Problem
Two gaps block honest measurement of Phases 2–4:
- The backtest calls `build_feature_frame` with no `archive_rates`, so the
  30%-weight prior-season slice of every rate is never exercised. The
  hotfix and Phase 4 both live in that slice.
- `scripts/backtest.py` and `scripts/residual_analysis.py` always run all
  seasons and only print totals. There's no season filter and no paired
  comparison between two model variants.

### Approach
1. **Move the pure part of `archive_rates` into `engine/history.py`**
   (`season_rates(frame) -> {(season, hid): {xg90, …}}` and
   `archive_rates_for(links, season_rates)`), so live and backtest share one
   implementation. `scripts/compute_forecast.py` keeps a thin wrapper. No
   live change; confirm by diffing a forecast.
2. **Link players across seasons inside the backtest.** Live uses
   `resolve_entities.py` (normalised first + last name via vaastav's
   `player_idlist.csv`). The archive carries the same full name in
   `web_name`. For a replayed season, link each player to earlier-season ids
   by normalised name (reuse `resolve_entities.normalize_name`); skip names
   that are ambiguous within a season, as live does.
3. **Leak-safe:** only seasons strictly before the replayed one. Prior
   seasons are complete, so no per-GW filter is needed.
4. **Holdout tooling:** `--seasons` on both scripts, and a paired
   comparison mode: `scripts/backtest.py --compare <variant>` runs old and
   new per gameweek and prints the per-GW mean difference ± 2 SE per
   season. Variants are selected by a config override, not by editing code.

### Files
- `engine/history.py`: `season_rates()`, `archive_rates_for()`, name linking.
- `engine/backtest.py`: `replay_gameweeks()` builds and passes `archive_rates`.
- `scripts/compute_forecast.py`: wrapper over the moved code.
- `scripts/backtest.py`, `scripts/residual_analysis.py`: `--seasons`, `--compare`.
- Tests: name linking (ambiguous skipped), no later-season leakage, live
  wrapper output unchanged.

### Watch-outs
- **2023-24 has no earlier season in the archive**, so it gets no prior
  rates. For prior-rate changes (Phase 4) the tune set is effectively
  2024-25 alone. Accept that, or ingest 2022-23 first (open decision 2).
- Name linking can mis-join two players with the same name across seasons
  (e.g. two "Danny Ward"s). Same risk live already carries; count and log
  ambiguous names rather than guess.

### As built
- 2022-23 is ingested as a **backtest-only** season (`PRIOR_ONLY_SEASONS`
  in `engine/config.py`). `load_history()` and the live fixture/team
  loaders skip it unless the caller opts in (`include_prior_only=True`,
  only the backtest scripts), so the live forecast is unchanged.
- Variants aren't selected by config override after all: constants are
  bound at import (some as default arguments), so patching them is
  fragile. Instead, save a run with `--out` on each version of the code and
  pair them with `--compare OLD NEW`.
- Every run also records per-gameweek **mean squared projection error**
  over all projected players (`mse`), alongside XI points.

### Done when
- [x] Backtest projections use prior-season rates; live forecast unchanged (verified identical)
- [x] New baseline recorded per season (below)
- [x] `--seasons`, `--out` and `--compare` work; paired output per season and holdout half
- [x] `pytest` passes (210)

### Phase 1 results

Model XI points (the new baseline for Phases 2–4):

| Season | Before | After | Edge over baseline |
|---|---|---|---|
| 2023-24 | 1,768 | 1,793 | 117 |
| 2024-25 | 1,952 | 1,910 | 113 |
| 2025-26 | 1,735 | 1,714 | 158 |
| Pooled edge | 3.84 pts/GW | **3.50 pts/GW** | |

Paired, new − old, per gameweek:

| | XI points | Squared error per player |
|---|---|---|
| Tune | −0.23 ± 1.07 | **−0.043 ± 0.014** |
| Holdout | −0.57 ± 1.40 | **−0.037 ± 0.013** |

Prior-season rates make projections clearly more accurate (≈3 SE on both
tune and holdout), which backs the live model's existing prior slice and
the id-collision hotfix. The XI-points change is noise.

### Finding: the acceptance rule's metric is too noisy

XI points have a paired standard error of ~1.1 pts/GW over the two tune
seasons, because each gameweek's result turns on eleven discrete picks. To
clear "mean − 2 SE > 0" a change would need to gain over 2 pts/GW; realistic
model changes move tenths. The rule as written rejects everything.

**Proposed revision (awaiting Nat):**
1. **Primary:** mean squared projection error per player (`mse`). It's the
   right score for an expected-points model, and has ~1/80th the noise.
   Accept if tune `mse` improves by more than 2 SE, and holdout `mse`
   improves (mean < 0).
2. **Guard:** XI points must not be clearly worse on tune
   (mean + 2 SE ≥ 0).

---

## Phase 2: Defensive contribution as a real probability

### Problem
`engine/model.py` scores DC as `min(1, dc90 / threshold) * mins90 * 2`.
The ratio isn't a probability: a defender averaging 9 actions per 90
against a threshold of 10 gets 0.9, but the real chance of hitting 10+ in
a match is nearer a coin flip. The residuals point the same way: MID bias
−0.139 and 2025-26 (the only season DC scores) at −0.27.

### Approach
- Expected actions in the match: `mu = dc90 * mins90`.
- `P(DC >= threshold)` from a count distribution. Start with Poisson; if
  real per-match DC counts are overdispersed (variance > mean), use a
  negative binomial with one dispersion parameter per position.
- Score: `P(hit) * DC_POINTS`. The existing `mins90` scaling is folded into
  `mu`, not applied twice.

### Calibration and the holdout problem
DC only scores from 2025-26, which is the holdout. Tuning the dispersion on
2025-26 then confirming on 2025-26 would be circular. Proposal (open
decision 1): **split 2025-26 by gameweek**. Fit dispersion on GW1–19,
confirm on GW20–38. Also check calibration directly: bucket player-matches
by predicted P(hit) and compare with the actual hit rate from the archive's
per-match `defensive_contribution`.

### Files
- `engine/model.py`: DC term.
- `engine/config.py`: dispersion per position (if negative binomial).
- `tests/test_model.py`: P(hit) monotonic in rate and minutes; ~0.5 near
  the threshold; 0 for GKP.

### Done when
- [ ] Calibration buckets: predicted vs actual hit rate within a few points
- [ ] Acceptance rule passes (holdout = 2025-26 GW20–38)
- [ ] MID bias moves toward 0

---

## Phase 3: Team-strength shrinkage and recency

### Problem
After the fidelity plan, attacker bias still rises with the fixture's
projected team goals (+0.13 → +0.30 across terciles), so strong-vs-weak
fixtures are still slightly under-separated. Two knobs in
`engine/team_goals.py`:
- `TEAM_GOALS_SHRINKAGE_MATCHES = 20` pulls every team toward average by
  20 matches' worth, which may be too strong.
- All seasons count equally. A team's 2023-24 results weigh the same as
  last month's.

### Approach
- Grid: shrinkage ∈ {5, 10, 15, 20, 30}; season decay ∈ {1.0, 0.7, 0.5}
  (weight per season back). 15 combinations.
- Pick on tune seasons with `--compare`; confirm the single pick on 2025-26.
- Decay needs a small change to `team_goal_rate_table` (weight each match
  by `decay ** seasons_ago`); shrinkage is a constant.

### Watch-outs
- 15 variants on two seasons invites picking noise. Prefer the simplest
  setting within 2 SE of the best, not the best point estimate.
- 2023-24 has no earlier seasons, so decay has nothing to act on there.

### Done when
- [ ] Grid results table recorded (tune seasons)
- [ ] Acceptance rule passes for the pick, or the plan records why the current values stay
- [ ] Attacker high − low λ spread falls below 0.17

---

## Phase 4: Prior-season saves, bonus, cards, goals conceded

### Problem
Prior-season rates cover only `xg90, xa90, dc90` (`_ARCHIVE_RATE_NAMES`).
Saves, bonus, cards and goals conceded start every season at the position
prior, so early-season and newly-transferred keepers look like an average
keeper until they've played. The archive has carried these since the
fidelity plan's Phase 2.

### Approach
- Extend `season_rates()` (Phase 1) with `saves90, bonus90, yellow90, gc90`.
- Add them to `_ARCHIVE_RATE_NAMES` in `engine/features.py`.

### Watch-outs
- `bonus` is partly a function of team strength, which changes between
  seasons (promoted/relegated, transfers). Its archive weight may need to
  be lower than the others; test with and without bonus.
- Tune set is 2024-25 only (see Phase 1 watch-outs).

### Done when
- [ ] Acceptance rule passes, with the effect visible mainly in GW1–10
- [ ] GKP early-season bias improves in the residual analysis

---

## Cross-cutting

- **One change per PR**, each scored against the latest accepted baseline,
  so effects don't get tangled.
- **Checks per PR:** `pytest`; revert incidental
  `data/pool-context/*.pkl` / `data/forecast/*.json` changes from the test
  fixture before committing.
- **Live impact note in every PR:** how many players move ≥0.1 xP, captain
  and XI changes, as in PR #63.
- **Out of scope:** the minutes model, new data sources, price-change
  modelling.

## Decisions (Nat, 2026-09-30)
1. Phase 2: split 2025-26 by gameweek (tune GW1–19, confirm GW20–38). Yes.
2. Phase 1: ingest 2022-23 so 2023-24 gets prior rates. Yes (backtest-only).

## Open decision for Nat
3. Switch the acceptance rule's primary metric to per-player squared
   projection error, with XI points as a guard (see Phase 1 results)?
