# GafferFPL

FPL decision tool for one manager at a time, as a mobile webapp. It gives a
quick view of the current week: the planning view (captain, transfer, chips,
doubts) before the deadline, and the live view (score, projection, what is
still to come) after it. It is built for the owner's own team (`OWNER_TEAM_ID`);
anyone can look up their own team by ID for the planning and live views, but
only the owner can save transfers or start a rebuild. There are no league
features by design (see `BACKLOG.md`). Full plan lives in the Ideaverse vault
at `Efforts/Ongoing/FPL Forecaster/FPL Forecaster.md`.

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
- `src/` — Next.js app. The Squad and Scenarios tabs render the committed
  `data/`; the Live tab and the league/recap views call FPL's public API live
  through `src/app/api/*` (live, league, recap, photo) and blend it with the
  forecast (`src/lib/liveBlend.ts`). A guest's forecast is computed on demand
  (`/api/forecast`).
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

## Live scoring

`src/lib/liveBlend.ts` builds the Live tab: autosubs, captain (x2, x3 on Triple
Captain), Bench Boost (all 15 count), double gameweeks (fixtures kept per
club), and the transfer hit (shown net, with the gross figure beside it).
Autosubs are provisional until the gameweek is data-checked, and the app says
so. To check the maths against FPL, capture finished gameweeks with
`node scripts/capture-reconcile.mjs <teamId> <gameweek>` (a normal week, a
week with a hit, a double gameweek); `tests/unit/reconcile.test.ts` then
asserts the computed score equals FPL's own.

## Transfers

`/api/transfers` (used by the form on the page) commits a manual override to
`data/overrides/transfers.json` via the GitHub API, which triggers a
redeploy. It does **not** validate budget or selling-price arithmetic — the
plan doc calls that out as the single largest silent-corruption surface in
the project, and it's deferred rather than gotten wrong. Treat the result as
directionally right, not budget-verified.

Both write routes (`/api/transfers`, `/api/rebuild`) are owner-only. They
need an `OWNER_SECRET` env var in Vercel; the first time you save a transfer or
press "Rebuild now" in a browser, the app asks for that key and remembers it in
an httpOnly cookie. With `OWNER_SECRET` unset, both routes refuse everyone.

Requires a `GITHUB_TOKEN` env var in Vercel: a fine-grained personal access
token scoped to `natleewhee/fplforecast` with **Contents: read and write**
and **Actions: read and write** permissions. Contents lets the app save a
transfer; Actions lets it start a forecast rebuild straight away (after a
saved transfer, and from the "Rebuild now" button on the Squad tab). Without
Actions the app still saves, but the squad only updates at the daily 03:00 UTC
rebuild, and the app says so. Optionally set `FPL_REPO_BRANCH` if the app should commit to a
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
and `OWNER_SECRET` (see Transfers above) to the project's environment variables
for the transfer form and "Rebuild now" to work — everything else runs without
env vars.
