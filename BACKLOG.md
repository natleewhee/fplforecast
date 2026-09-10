# Backlog

Deferred, agreed-on work not yet scheduled into a PR.

## Design/quality skills to run next (from the impeccable/taste-skill/ui-ux-pro-max/compound-engineering review)

Evaluated four external skill/plugin repos against fplforecast's current state (already run: impeccable's `detect` audit, `animate`, `colorize`, `typeset`, `layout`, `delight`, `critique`).

- [ ] **impeccable `harden`** — error handling, i18n, text overflow, edge cases. Highest-value next pass: the transfer-save 404 bug we fixed manually was exactly this class of issue, and `/api/league`, `/api/live`, `/api/transfers` likely have more unaudited failure paths.
- [ ] **impeccable `adapt`** — responsive/device pass (narrow, wide, zoomed states). App is mobile-first but every responsive fix so far has been reactive to a bug report, never a dedicated sweep.
- [ ] **impeccable `polish`** — shipping-readiness pass, natural closer after the animate/colorize/typeset/layout/delight run.

Skip, with reasons:
- **taste-skill** (Leonxlnx) — same mission as impeccable (stop generic AI-looking UI), same target surface. Redundant with passes already run; risk of conflicting rules, not new findings.
- **ui-ux-pro-max-skill** — built for generating a design system from scratch (palettes/fonts/79 styles) for new products. fplforecast already has an established "match-centre HUD" identity; running this risks replacing it, which impeccable's own typeset checklist explicitly warns against.
- **compound-engineering-plugin** (EveryInc) — not a UI/UX skill; it's a planning/review/knowledge-capture workflow (`/ce-plan`, `/ce-code-review`, `/ce-compound`). Could be worth adopting separately for how development itself is run, but it's a different category of decision — not folded into this design backlog.
