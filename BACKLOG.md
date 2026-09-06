# Backlog

Deferred, agreed-on work not yet scheduled into a PR.

- **Leagues tab: split the live-count into three states.** Currently shows
  "X live · X to play" (live = already contributing to the score: playing,
  finished, or subbed off; to play = not yet kicked off). Change to a
  three-way split matching the official FPL gameweek view: **X played**
  (finished/subbed off), **X live** (currently mid-match), **X to play**
  (not yet kicked off). Touches `playersLive`/`playersToPlay` in
  `src/app/api/league/route.ts` (add a `playersPlayed` field) and the
  `LiveCell` rendering in `src/app/LeaguesPage.tsx`.
