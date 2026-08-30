# FPL Forecaster

Personal FPL decision tool. One user, no login, mobile webapp. Full plan lives
in the Ideaverse vault at `Efforts/Ongoing/FPL Forecaster/FPL Forecaster.md`.

## How it fits together

- `engine/` — pure projection library (no I/O, no network; the one sanctioned
  reader is `engine.history.load_history`). The scripts under `scripts/` are
  thin CLI wrappers that load `data/`, call `engine`, and write `data/` back.
- `.github/workflows/snapshot.yml` — daily GitHub Action, `pip install -e .`
  then the pipeline in order:
  1. `scripts/snapshot.py` — dated JSON snapshots of FPL's `bootstrap-static`,
     `fixtures`, `entry/1168513`, `entry/1168513/history`, plus per-GW
     `event-live` and squad `picks`, keyed by gameweek once finished
  2. `scripts/ingest_history.py` — vaastav's last-3-seasons per-GW archive,
     fixtures, and team strength ratings into `data/history/` (skips existing
     gameweek files)
  3. `scripts/resolve_entities.py` — matches this season's player ids to past
     seasons' via vaastav's `player_idlist.csv`
  4. `scripts/minutes_model.py` — expected minutes / per-90 points per player
  5. `scripts/log_predictions.py` — freezes the model + baseline projections
     inside the 48h window before a deadline (`data/predictions/gwNN.json`)
  6. `scripts/score_predictions.py` — scores frozen predictions once a
     gameweek is `data_checked`, updates `data/record/running.json`
  7. `scripts/compute_forecast.py` — the squad-anchored weekly view:
     `data/forecast/gwNN.json` with each held player's model + baseline
     suggested swap
- `scripts/backtest.py` — leakage-guarded replay over the three archived
  seasons (`data/backtest/<run-id>.json`, gitignored). Run on demand, not in
  the daily Action.
- `src/` — Next.js static app that reads the committed `data/` and renders it.
- Each snapshot commit triggers a fresh Vercel deploy.

## Status

Live: headless `engine/`, the composite baseline (historical scoring average +
recent ICT + form, position-shrunk), the projection model (baseline × FDR ×
minutes × availability) with a scoped opponent attack/defence strength term,
the squad-anchored three-way weekly view (your squad, plus the model's and the
baseline's suggested swap per player, with a hover breakdown), the pre-deadline
prediction log, the post-gameweek scoring pass and running record, and the
leakage-guarded backtest.

Still deferred: the full expected-goals λ team-strength model (FDR + the
current strength term are the interim signal); wiring the *live* baseline to
the multi-season archive (it is within-season for now); budget / selling-price
arithmetic for transfers (see below); a minutes term inside the backtest;
per-season tuning of the baseline component weights.

## Transfers

`/api/transfers` (used by the form on the page) commits a manual override to
`data/overrides/transfers.json` via the GitHub API, which triggers a
redeploy. It does **not** validate budget or selling-price arithmetic — the
plan doc calls that out as the single largest silent-corruption surface in
the project, and it's deferred rather than gotten wrong. Treat the result as
directionally right, not budget-verified.

Requires a `GITHUB_TOKEN` env var in Vercel: a fine-grained personal access
token scoped to `natleewhee/fplforecast` with **Contents: read and write**
permission. Optionally set `FPL_REPO_BRANCH` if the app should commit to a
branch other than `main` (defaults to `main`).

## Local development

```bash
npm install
npm run dev       # needs data/bootstrap-static/<date>.json to show anything

pip install -r requirements.txt
pip install -e .  # puts the engine/ package on the path for the scripts below
python3 scripts/snapshot.py            # populate data/ locally (needs network access)
python3 scripts/resolve_entities.py
python3 scripts/minutes_model.py
python3 scripts/compute_forecast.py
```

Set `FPL_TEAM_ID` to override the default team ID (currently 1168513) when
running the snapshotter.

## Deploying

Import the repo into Vercel, framework preset Next.js. Add `GITHUB_TOKEN`
(see Transfers above) to the project's environment variables for the
transfer form to work — everything else runs without env vars.
