# FPL Forecaster

Personal FPL decision tool. One user, no login, no app. Full plan lives in the
Ideaverse vault at `Efforts/Ongoing/FPL Forecaster/FPL Forecaster.md`.

## Status: Step zero

Only the snapshotter exists so far. A GitHub Action
(`.github/workflows/snapshot.yml`) runs daily, fetches FPL's `bootstrap-static`,
`fixtures` and `entry/{id}` endpoints — all mutated in place with no history
endpoint upstream — and commits them as dated JSON under `data/`.

No model, no app, no database yet. That's deliberate; see the plan doc for
the sequencing.

## Running the snapshotter locally

```bash
python scripts/snapshot.py
```

Set `FPL_TEAM_ID` to override the default team ID (currently 1168513).
