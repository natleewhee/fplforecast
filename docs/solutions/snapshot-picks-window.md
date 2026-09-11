# The daily snapshot can't see your squad until the gameweek finishes

`scripts/snapshot.py`'s `snapshot_picks()` only ever fetches picks for the
last *finished* gameweek:

```python
gws = finished_gameweeks(bootstrap)
...
gw = gws[-1]
```

This isn't an oversight -- the comment above it says why: "Pre-deadline
picks need auth cookies we don't have -- only the last completed
gameweek's picks are public." The FPL API's `/entry/{id}/event/{gw}/picks/`
endpoint only returns unauthenticated data for gameweeks that have already
been played.

**The consequence:** if you make transfers, change captaincy, or play a
chip after a gameweek's deadline but before it finishes, the daily cron
(and `data/picks-<TEAM_ID>/gwN.json`) won't reflect it -- it's still
showing your squad as of the last finished gameweek. This isn't a bug to
fix; it's a real API limitation. A manually-triggered `workflow_dispatch`
run of `snapshot.yml` doesn't help either, since it hits the same
endpoint.

**What to do about it:** use the existing overrides mechanism
(`data/overrides/transfers.json`, written by the live `/api/transfers`
route and read by `load_overrides`/`apply_overrides` in
`scripts/compute_forecast.py`). It's keyed by `basedOnGw` and is
self-cleaning: once the gameweek actually finishes and the cron produces
a real `gwN.json` picks snapshot, the staleness check
(`basedOnGw != based_on_gw`) makes the override a no-op automatically --
no manual cleanup needed.

For a single transfer, the deployed "Make a transfer" form already does
this. For something bigger the form doesn't cover (a wildcard -- most of
the 15-man squad turning over at once), the same file format can be
hand-built: map each player name to their stable element ID via the
current `bootstrap-static` snapshot, diff the old and new 15-man squads
to get the out/in pairs, write them to `data/overrides/transfers.json`,
then run `python scripts/compute_forecast.py` locally to regenerate
`data/forecast/gwN.json` -- Vercel's build doesn't run the Python
pipeline itself, so this step doesn't happen automatically outside the
daily cron.

**One more wrinkle:** a `workflow_dispatch`-triggered `snapshot.yml` run
pushes straight to the production branch (`git push` at the end of the
job, no PR). If another push lands on that branch between the run
starting and that final push (e.g. a PR merging), it's a plain
non-fast-forward rejection -- the run's job log will show `[rejected]
... (fetch first)` even though every earlier step (including the actual
data fetch and forecast recompute) succeeded. Re-running the workflow
fresh fixes it; the fetched data doesn't go stale in the few minutes
that takes.
