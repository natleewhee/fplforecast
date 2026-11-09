# Backlog

Deferred, agreed-on work not yet scheduled into a PR.

## Direction (decided)

A tool for one manager making decisions about their own team: a planning view
before the deadline, a live view after it. Not a league product. Decided
against: league routes/invite links/league recaps, saving transfers for guests,
a deadline reminder push, and more share-card variants.

Still open from the last review:
- [ ] Capture real finished gameweeks for the reconciliation test (a normal
  week, a week with a hit, a double gameweek). That also settles whether FPL's
  `points` is gross or net of the hit.
- [ ] Whether the par line (the gameweek average) is net or gross of hits;
  until known, the band compares the gross projection.
- [ ] Postponed after kickoff: blank gameweeks and matches postponed before
  kickoff are handled in `liveBlend.ts` (the club counts as not played); a
  match called off after it has started is not.
- [ ] A stale or failed FPL response shows the last good data with its age;
  the season-rollover case (no current gameweek) is not handled specially.
- [ ] Free Hit week should plan from the squad that comes back, not the
  one-week Free Hit squad.
- [ ] Price-change watch (risers/fallers) from FPL's own projection fields
  (`price_change_percent`, `price_change_hourly_rate`,
  `price_change_projections`), which every bootstrap snapshot now carries.
- [ ] Flag suspension and loan-ban risk from `scout_risks`.
- [ ] A guest's par line and rank describe next week's forecast, not the
  current gameweek; say so or fix it.

## 3D players for all players (in progress)

Built: club kit table, Wikidata height lookup, the loader with overrides and a neutral
fallback, and the `/appearance` review page. Still to do, in this order:
- [ ] Run `scripts/ingest_heights.py` and read the match rate (I could not reach Wikidata
  from the build sandbox, so the real rate is unknown).
- [ ] Skin tone and hair colour measured from each official headshot, checked against the
  15 hand-set players first. Measuring only: a suggestion, never final until checked.
- [ ] Hair style, last, from photo shapes plus your corrections ("bald" and "beard" as
  their own options). Needs a decision on how it is read (shape rules or a model).

## Design/quality skills to run next (from the impeccable/taste-skill/ui-ux-pro-max/compound-engineering review)

Evaluated four external skill/plugin repos against fplforecast's current state (already run: impeccable's `detect` audit, `animate`, `colorize`, `typeset`, `layout`, `delight`, `critique`).

- [x] **impeccable `harden`** — done (stale-response race in LeaguesPage, note-field maxlength).
- [x] **impeccable `adapt`** — done (Carousel touch targets below 44×44px).
- [x] **impeccable `polish`** — done (Dropdown lost keyboard focus on close).

Skip, with reasons:
- **taste-skill** (Leonxlnx) — same mission as impeccable (stop generic AI-looking UI), same target surface. Redundant with passes already run; risk of conflicting rules, not new findings.
- **ui-ux-pro-max-skill** — built for generating a design system from scratch (palettes/fonts/79 styles) for new products. fplforecast already has an established "match-centre HUD" identity; running this risks replacing it, which impeccable's own typeset checklist explicitly warns against.
- **compound-engineering-plugin** (EveryInc) — not a UI/UX skill; it's a planning/review/knowledge-capture workflow (`/ce-plan`, `/ce-code-review`, `/ce-compound`). Kept just the `docs/solutions/` knowledge-capture idea (see `docs/solutions/`), skipped the plugin itself — too much workflow overhead for a single-maintainer app.

## Benchmark vs. major FPL third-party tools

Compared fplforecast against Fantasy Football Scout, LiveFPL, FPL Review, and Fantasy Football Fix — the established players in this space. **Could not verify against the live sites**: this sandbox's network egress blocks all of them (same block that covers fantasy.premierleague.com), so this is from general knowledge of their long-standing, well-documented feature sets, not a fresh look. Flagging that explicitly rather than presenting it as verified.

Where fplforecast already has real parity (a lot of what FPL Review/Fantasy Football Fix charge a subscription for): multi-gameweek xP projections, an ILP transfer/chip optimizer with wildcard/free-hit horizon selection, a live match tracker with a par-score line, mini-league live standings, and a running model-vs-baseline track record. That's a stronger planning core than most of these tools ship for free.

Gaps worth knowing about, ranked by value or built where the fix was genuinely small:

- [x] **Ownership % in the transfer search** — LiveFPL/Scout both foreground "% owned" as a differential-vs-template signal, and fplforecast's own `bootstrap-static` snapshot already carries `selected_by_percent` per player (compute_forecast.py was already piping it into `pool`, just never into the plain player list TransferForm searches, and never rendered anywhere). Built: now shows next to price in the "In" search results.
- [x] **A live overall-rank estimate** -- done (personal rank-calibration fit, surfaced in the live tracker).
- **Skipped, deliberately**: forums/community discussion, captaincy polls, article-driven pundit advice. This is a single-manager tool, not a media site — a social/content layer is out of scope, not a gap.

## Done

- [x] Tests for the API routes that call FPL (`tests/unit/apiRoutes.test.ts`
  covers live, recap, league, league/squad and photo).
- [x] Put the 3D layer into the Squad pitch behind a 2D/3D switch
  (`src/app/Pitch.tsx`, `ViewSwitch` in `src/app/pitch3d/Pitch3D.tsx`).
- [x] A visible "why" for the model's numbers: `PlayerBreakdownSheet` shows
  the forecast's components.
