# Experience roadmap: xP breakdown, shareable links, deadline checklist

Status: planned, not started. Written 2026-09-28.
Build order: 1 → 2 → 3. Each phase is its own PR and ships on its own.

## Why these three

Picked from the 2026-09-28 brainstorm as the best value for effort:

| # | Feature | What it does | Effort |
|---|---|---|---|
| 1 | xP breakdown on tap | Makes the model's number explainable, the thing paid tools don't show | S |
| 2 | Shareable team links | Lets a team view be sent to someone, needed for a public launch | S |
| 3 | Deadline-day checklist | Gives a reason to open the app every gameweek | M |

---

## Phase 1: xP breakdown on tap

### Problem
The pitch shows one projected number per player. The forecast JSON already
holds why: `ForecastPlayer.breakdown.components` (appearance, goals,
assists, cleanSheet, goalsConceded, saves, defensiveContribution, bonus,
cards), plus `expectedMinutes`, `availabilityMultiplier`, `rateSource` and
`provisional`. `Pitch.tsx` passes `breakdown` into each token (`Tok`) and
never renders it.

### Approach
Tapping a player token opens a bottom sheet (full width on phone, popover
on desktop) with:
- Projected points for the shown gameweek, with the floor–ceiling range if present
- A stacked bar plus rows, one per non-zero component (e.g. "Goals 1.8", "Clean sheet 1.2")
- Context lines: expected minutes, availability %, data source ("PL history" / "price prior" / "Understat: La Liga"), a provisional flag
- Opponent(s) and FDR (already in `OppChip`)

No backend change. The data is already in `data/forecast/gwN.json`.

### Files
- `src/app/PlayerBreakdownSheet.tsx`: new. Takes a `ForecastPlayer` plus the shown gameweek; renders the sheet.
- `src/app/Pitch.tsx`: make `PlayerToken` a `<button>` (44px minimum tap target, per adapt.md); lift "selected player id" state into `Pitch`; render the sheet.
- `src/lib/snapshots.ts`: no type change needed (`ProjectionComponents` exists).

### Watch-outs
- Gameweeks other than the first on the rail: components are target-gameweek only. When another gameweek is selected, show just the total and "breakdown available for GW{target} only" instead of a stale split.
- Components can sum to slightly more than the total because `availabilityMultiplier` scales the total afterwards. Show the multiplier as its own line so the maths reconciles.
- The sheet must close on Escape, on a backdrop tap and via a close button, and return focus to the token (see the Dropdown focus fix from the polish pass).

### Done when
- [ ] Tapping any XI or bench player opens the sheet; the component rows plus the multiplier line reconcile to the shown xP within ±0.1
- [ ] Works for a guest team (the forecast comes from `api/forecast.py`, same shape)
- [ ] Keyboard: Enter opens, Escape closes, focus returns
- [ ] `tsc`, `eslint`, `npm run build` clean

---

## Phase 2: Shareable team links

### Problem
The viewed team ID lives only in the `fpl_team_id` cookie
(`src/lib/teamId.ts`). A link to a team can't be sent; the recipient
always gets the team-ID prompt.

### Approach
- `?team=<id>` in the URL takes precedence over the cookie on load.
- `AppShell`'s mount effect already runs `getClientTeamId()` → `loadTeam()`; extend it to read `new URLSearchParams(window.location.search).get("team")` first. Keep this client-side; don't make `page.tsx` dynamic, which would lose the `force-static` fast path.
- When a team loads, write it back to the URL with `history.replaceState` (no reload) so the address bar is always shareable.
- A "Copy link" button in `TeamIdBar` (Web Share API on mobile, clipboard fallback).
- A shared link shows a banner naming whose team it is (team and manager name from the forecast's `teamName`/`managerName`) with a "Make this my team" button.
- A link opened by a stranger does **not** overwrite their saved cookie unless they tap "Make this my team". Otherwise opening a friend's link would silently replace your own default team.

### Files
- `src/lib/teamId.ts`: `getUrlTeamId()` and `setUrlTeamId()` helpers with the same positive-integer validation as `resolveTeamId`.
- `src/app/AppShell.tsx`: URL-first resolution; separate "viewing" from "saved" team; a share button; a "Make this my team" action.
- Server routes (`/api/live`, `/api/league`, `/api/league/squad`) resolve the team from the cookie. While a URL team differs from the cookie, the client passes `?teamId=` explicitly; each route prefers the query param over the cookie, after validation.
- `/api/transfers` is unchanged. It stays owner-cookie-only (the 403 guard).

### Watch-outs
- Security: a `?team=` value is untrusted input. Validate it as a positive integer everywhere it's read. It only selects which public FPL data is shown, so there's no privilege risk, but `/api/transfers` must never honour it.
- Static page: the first paint still shows the prompt or skeleton until the effect runs. Acceptable, and consistent with the current cookie flow.

### Done when
- [ ] Opening `/?team=123` shows team 123 without the prompt, even with no cookie
- [ ] Opening it does not change a visitor's saved team unless they choose to
- [ ] "Copy link" produces a URL that reproduces the current view
- [ ] Live and League tabs follow the URL team, not the cookie, while viewing a shared link
- [ ] `/api/transfers` still 403s for any non-owner team

---

## Phase 3: Deadline-day checklist

### Problem
The decisions before a deadline are spread across the Squad tab (captain,
bench), Scenarios (transfers) and Live (countdown, only when idle). There's
no single "am I ready?" view.

### Approach
A "Before the deadline" card, shown at the top of the Squad tab whenever
the next deadline is within 24h (hidden otherwise):

| Row | Source (already exists unless noted) | Status rule |
|---|---|---|
| Countdown | **New**: `deadlineTime` for `targetGameweek` in the forecast JSON | red < 3h, amber otherwise |
| Captain / vice | `forecast.captain`, `viceCaptain`, `captainEdge` | amber if the edge is "coin flip" |
| Injury/doubt in XI | `availability` on each XI player | red if any `i`/`s`/`u`; amber if `d` |
| Bench order | `squad.bench` (GK-first rule already enforced) | amber if a doubtful starter's first sub is also doubtful |
| Transfers | `scenarios.freeTransfers.value`, top 1-GW scenario `netPoints` | "Use 1 FT: +X pts" or "Roll: no move clears the gap" |
| Chips | `chipsAvailable` + the existing BB/TC timing card | info only |

Each row links to where you act on it (Squad, Scenarios).

### Files
- `scripts/compute_forecast.py`: add `"deadlineTime"` (from `bootstrap["events"]` for `target_gw`) to the forecast dict in `build_personal_forecast`, so owner and guest forecasts both get it. Add a test to `tests/test_compute_forecast.py`.
- `src/lib/snapshots.ts`: `deadlineTime?: string | null` on `Forecast`.
- `src/app/DeadlineChecklist.tsx`: new. Pure function of `Forecast` plus `now`, and a 60s tick for the countdown (reuse `countdown()` from `LiveTracker.tsx`, moved to `src/lib/`).
- `src/app/AppShell.tsx`: render at the top of `squadTab`.

### Watch-outs
- The forecast is built daily at 03:00 UTC. The checklist reflects the last build, so show "as of {generatedAt}" and don't imply real-time injury news.
- Guest teams have no overrides or chips data (owner-only). Hide the chip row for guests rather than showing wrong data.
- The picks-window limitation (`docs/solutions/snapshot-picks-window.md`): after the deadline passes, the squad shown is last gameweek's until the gameweek finishes. Hide the card once the deadline has passed.

### Done when
- [ ] The card appears within 24h of the deadline, hides after it passes
- [ ] Every row's status matches the forecast data (unit-testable pure function)
- [ ] `pytest` passes, including the new `deadlineTime` test; TS checks clean
- [ ] Works for owner and guest teams (chip row hidden for guests)

---

## Cross-cutting

- **Testing.** The repo has no TS test runner. Phase 3's status rules should live in a pure function so they could be tested if one is added; for now, verify with `tsc`, `eslint`, build and manual checks on the Vercel preview.
- **Mobile first.** All three are used mostly on a phone: 44px tap targets, bottom sheets over popovers, no hover-only affordances.
- **Out of scope.** Price-change flags and the league differentials view stay in `BACKLOG.md`.

## Decisions (Nat, 2026-09-28)
1. Phase 1: the breakdown opens as a **bottom sheet**.
2. Phase 2: a shared link **says whose team it is** first (team and manager name, e.g. "You're viewing Little Gems (Barn Kan) — make it yours?"), with the "Make this my team" action on that banner.
3. Phase 3: the checklist appears **24h** before the deadline.
