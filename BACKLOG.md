# Backlog

Deferred, agreed-on work not yet scheduled into a PR.

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
- [ ] **A live overall-rank estimate** — LiveFPL's headline feature: projects your overall rank in real time during a gameweek by comparing your live score against the season's live average/percentile distribution. fplforecast's live tracker shows points vs. par but not a rank estimate. Genuinely valuable, but not small — needs a model of the live score distribution across all managers (or at least a reasonable proxy from `average_entry_score` + `highest_score`/percentile fields bootstrap-static exposes), not just an extra field to surface.
- [ ] **Price-change tracking (risers/fallers)** — LiveFPL/Scout both track this hourly. `bootstrap-static` already has `transfers_in_event`/`transfers_out_event`/`cost_change_event` per player (same snapshot as ownership above), so the raw signal exists — but turning net-transfer momentum into a "likely to rise/fall tonight" call needs a threshold model tuned against real price-change history, not a trivial display change.
- [ ] **A visible "why" for the model's numbers** — Scout's stats hub lets managers explore the underlying xG/xA/BPS data themselves. fplforecast's engine already ingests Understat data (`scripts/ingest_understat.py`) and computes a per-player component breakdown (`squadComponents` — appearance/goals/assists/bonus/etc., already used by the live tracker's blend), but that breakdown is never shown for the *forecast* number itself, only for live in-match points. Could reuse the same breakdown UI to make "why does the model rate this player" inspectable, not just trust-the-number.
- **Skipped, deliberately**: forums/community discussion, captaincy polls, article-driven pundit advice. This is a single-manager personal tool, not a media site — a social/content layer is out of scope, not a gap.
