# FPL Forecaster

Personal FPL decision tool. One user, no login, mobile webapp. Full plan lives
in the Ideaverse vault at `Efforts/Ongoing/FPL Forecaster/FPL Forecaster.md`.

## How it fits together

- `.github/workflows/snapshot.yml` — daily GitHub Action, runs the pipeline in order:
  1. `scripts/snapshot.py` — dated JSON snapshots of FPL's `bootstrap-static`,
     `fixtures`, `entry/1168513`, `entry/1168513/history` (mutated in place
     upstream, no history endpoint), plus per-GW `event-live` and squad
     `picks`, keyed by gameweek once finished
  2. `scripts/resolve_entities.py` — matches this season's player ids to the
     last 3 seasons' via vaastav's `player_idlist.csv` (FPL ids reset every
     season with no shared key)
  3. `scripts/minutes_model.py` — expected minutes and per-90 points per
     player, empirical-Bayes shrunk to a position prior
  4. `scripts/compute_forecast.py` — best XI + captain from your squad,
     applying any pending transfer overrides
- `src/` — Next.js app that reads the latest committed data and renders it.
  No server-side model fitting here — Vercel functions cap at 10–60s, far too
  short. All modelling stays a Python/Actions batch job that writes to `data/`;
  the webapp mostly reads, except the transfer form below.
- Each snapshot commit triggers a fresh Vercel deploy (git-push-triggered
  builds), so the site picks up new data automatically without a manual step.

## Status

Snapshotter, entity resolution, minutes model, and the dumb-slice XI/captain
picker are live. Not yet built: the rest of Phase 1's components (team
strength λ, attacking share, clean sheet, Defensive Contribution, BPS),
opponent-difficulty weighting (FDR is committed but unused so far), and the
budget/selling-price arithmetic for transfers (see below).

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
