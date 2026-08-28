# FPL Forecaster

Personal FPL decision tool. One user, no login, mobile webapp. Full plan lives
in the Ideaverse vault at `Efforts/Ongoing/FPL Forecaster/FPL Forecaster.md`.

## How it fits together

- `.github/workflows/snapshot.yml` — daily GitHub Action, runs `scripts/snapshot.py`,
  commits dated JSON snapshots of FPL's `bootstrap-static`, `fixtures` and
  `entry/1168513` endpoints to `data/`. These endpoints are mutated in place
  upstream with no history endpoint, so this is the only record.
- `src/` — Next.js app that reads the latest committed snapshot and renders it.
  No server-side model fitting here — Vercel functions cap at 10–60s, far too
  short. All modelling stays a Python/Actions batch job that writes to `data/`;
  the webapp only reads.
- Each snapshot commit triggers a fresh Vercel deploy (git-push-triggered
  builds), so the site picks up new data automatically without a manual step.

## Status

Snapshotter is live. The webapp currently shows FPL's own `ep_next`, sorted,
as a placeholder — no forecast model exists yet. Replacing that with the
component-decomposed model is the next phase; see the plan doc.

## Local development

```bash
npm install
npm run dev       # needs data/bootstrap-static/<date>.json to show anything
python3 scripts/snapshot.py   # populate data/ locally (needs network access)
```

Set `FPL_TEAM_ID` to override the default team ID (currently 1168513) when
running the snapshotter.

## Deploying

Import the repo into Vercel, framework preset Next.js, no environment
variables required for the MVP. Point it at this branch/the default branch.
