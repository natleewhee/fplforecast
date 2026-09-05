---
title: Transfer Scenarios, Free Hit and Wildcard Optimiser - Plan
type: feature
date: 2026-09-05
topic: transfer-scenarios-chip-optimiser
execution: code
---

# Transfer Scenarios, Free Hit and Wildcard Optimiser - Plan

## Goal Capsule

- **Objective:** Replace the 486-row pool table with a *decision* surface. Instead of "here is
  every player, go find the move yourself", the page answers: **given my free transfers, what are
  my best three options over the next 1 / 3 / 5 gameweeks — and what would a Free Hit or Wildcard
  buy me?**
- **Why now:** The planning table is a research tool, not a decision tool. Every ranking it shows
  is single-player and price-blind to the rest of the squad — it can tell you player X out-scores
  player Y, but never whether you can *afford* X once the rest of the squad is paid for, nor
  whether two cheaper moves beat one expensive one.
- **Scope:** `engine/optimise.py` (new), `engine/config.py`, `scripts/compute_forecast.py`,
  `src/lib/snapshots.ts`, `src/app/page.tsx`, new `src/app/Scenarios.tsx`; deletes
  `src/app/PlanningTable.tsx`.
- **Not in scope:** Changing the xP model itself. Scenarios consume `perGameweek` exactly as the
  model already produces it. The three open audit findings from
  `2026-09-05-xp-model-audit.md` are tracked separately and will improve these scenarios for
  free once fixed.

---

## What exists today (verified against `data/forecast/gw4.json`, not assumed)

Four findings that shape the whole design:

| Finding | Consequence |
|---|---|
| `pool` holds **all 486 players**, and **all 15 squad players are in it** (`15/15` verified) | One unified table drives everything. No need to join squad and pool projections from different sources. |
| Each pool row carries `perGameweek` — exactly **5 values, GW4–GW8** — and `total == sum(perGameweek)` | The 1 / 3 / 5-gameweek horizons are **prefix sums** of data already on disk. No model re-run per horizon. |
| `data/history-<id>/*.json` carries `chips: []` and per-GW `event_transfers` | Both Wildcard and Free Hit are **unused**, and free-transfer balance is **derivable** (with a staleness caveat — see KD5). |
| `poolUpgrades` / `loadPool` are consumed **only** by `PlanningTable` | Deleting the table makes `poolUpgrades` dead code. The `pool` array itself stays — it's the optimiser's input. |

Existing reusable pieces: `engine/squad.py::best_xi` (brute-force formation search over a fixed 15)
and `VALID_FORMATIONS`. Both stay; `best_xi` becomes the *verification oracle* the ILP is
checked against (see Verification Contract).

**Budget available:** squad value £100.1m + bank £0.0m = **£100.1m** for a Free Hit or Wildcard
rebuild.

---

## Key Decisions

Settled with you before drafting:

- **KD1. Hits are allowed only when net-positive.** A `-4` is proposed only when the projected
  gain over the *selected horizon* clears the 4-point cost. Every scenario shows its hit cost
  explicitly and ranks on **net** points. Over a 1-GW horizon this will almost never fire; over
  5 GWs it opens up genuinely good aggressive moves.
- **KD2. Free Hit and Wildcard produce a legal 15, and surface the XI.** Full FPL constraints —
  £100.1m, 2 GKP / 5 DEF / 5 MID / 3 FWD, max 3 per club — with the 15 chosen so the resulting
  *starting XI* maximises points. The XI leads the display, bench underneath. This is a squad you
  can actually field.
- **KD3. Exact ILP via PuLP.** `requirements.txt` already anticipates PuLP as a later-phase
  dependency, so this is the planned path, not a new direction. Gives provably optimal squads and
  expresses every constraint declaratively — far easier to trust and extend than hand-rolled
  greedy search.
- **KD4. The full pool table is removed entirely.** Scenarios fully replace it.
  `PlanningTable.tsx` is deleted, `loadPool`/`PoolData`/`poolUpgrades` go with it, and
  `pool_upgrades()` in `engine/squad.py` plus its `poolUpgrades` JSON block are removed.

Decisions I am making in the drafting, flagged for your review:

- **KD5. Free-transfer balance is derived, but overridable in the UI.** *This one needs your
  eye.* The rule is 1 FT per gameweek, banked up to a cap, minus transfers used. But the entry
  history snapshot currently reaches only **GW2 while the forecast targets GW4** — so a purely
  derived number risks being silently stale and wrong. Rather than pretend to certainty, the
  scenario panel derives a default, *shows its working* ("2 FT — 1/GW since GW1, capped at 5,
  minus 0 used"), and gives you a 1–5 toggle to correct it, which instantly re-ranks the
  scenarios. Cheap to build, and removes an entire class of silent-wrongness.
- **KD6. The banked-FT cap is a config constant, not a hardcoded 5.** **Confirmed with Nat
  2026-09-05: the cap is still 5 this season.** Still lands as `FT_MAX_BANKED = 5` in
  `engine/config.py` rather than a literal, with a comment saying it needs re-confirming each
  season — the cap has changed before (it was 2 pre-2024/25).
- **KD7. The three transfer scenarios are structurally different, not three variants of one
  move.** Rather than returning the top 3 solutions of a single search (which tend to be
  near-identical — swap the same player for three similar alternatives), solve the *best possible
  plan at each transfer count* `k = 0, 1, 2, …` up to `FT + 1`, then rank those by net points and
  show the top 3. `k = 0` — "roll your transfer, do nothing" — is always evaluated as an explicit
  comparator, so you can see what standing pat actually costs. This gives you genuinely different
  options ("roll", "one move", "two moves, take the -4") rather than three flavours of the same
  idea.
- **KD8. Scenarios assume optimal captaincy and optimal XI selection each week.** The projected
  totals pick the best starting XI and captain *per gameweek* within the scenario's squad. This
  is the right basis for comparing squads, but it means a scenario's headline number is what
  you'd score playing it perfectly — it will read slightly high versus reality. Stated plainly in
  the UI rather than buried.

---

## Method

This is the part worth your scrutiny — everything else is plumbing.

### The objective

For a candidate 15-man squad `S` over a horizon of gameweeks `H`:

```
points(S, H) = Σ         [ Σ  xP[p][gw] · start[p][gw]  +  Σ xP[p][gw] · captain[p][gw] ]
               gw ∈ H      p                               p
```

The second term is the captain's *doubling* — the captain scores once as a starter and once
again as captain. `xP[p][gw]` comes straight from `pool[p].perGameweek[gw]`.

### The ILP

Solved once per scenario with PuLP/CBC.

**Variables**

| Variable | Meaning |
|---|---|
| `x[p] ∈ {0,1}` | player `p` is in the 15-man squad |
| `start[p][gw] ∈ {0,1}` | player `p` starts in gameweek `gw` |
| `cap[p][gw] ∈ {0,1}` | player `p` is captain in gameweek `gw` |
| `hits ≥ 0`, integer | transfers taken beyond the free allowance |

**Constraints**

```
Σ x[p] = 15                                    squad size
Σ x[p] · isGKP[p] = 2,  isDEF = 5,  isMID = 5,  isFWD = 3
Σ x[p] · isTeam[p][t] ≤ 3     for every club t      max 3 per club

start[p][gw] ≤ x[p]                            can't field who you don't own
Σ start[p][gw] = 11                            for each gw
Σ start[p][gw] · isGKP[p] = 1                  for each gw
3 ≤ Σ start·isDEF ≤ 5,  2 ≤ Σ start·isMID ≤ 5,  1 ≤ Σ start·isFWD ≤ 3
cap[p][gw] ≤ start[p][gw],   Σ cap[p][gw] = 1   captain must start

Σ      price[p] · x[p]  ≤  bank + Σ        sellPrice[p] · (1 - x[p])
 p ∉ held                          p ∈ held
                                               budget: buys ≤ bank + sales

hits ≥ Σ (1 - x[p]) − freeTransfers            for p ∈ held
 p ∈ held
```

The formation bounds encode `VALID_FORMATIONS` implicitly — any assignment satisfying them is a
legal shape, which is cleaner than enumerating the seven formations explicitly.

**Objective**

```
maximise   points(S, H)  −  4 · hits
```

That single `− 4·hits` term is the whole of KD1: the solver takes a hit *if and only if* it buys
back more than 4 points over the horizon. No threshold logic needed — it falls out of the
arithmetic.

### The four scenario families

| Scenario | Transfers | Budget | Horizon | Hit cost |
|---|---|---|---|---|
| **Transfer, k = 0…FT+1** | `Σ(1−x[p]) = k` pinned | bank + sales | 1 / 3 / 5 GW (toggle) | `4·max(0, k−FT)` |
| **Free Hit** | unlimited | £100.1m | **1 GW only** | none |
| **Wildcard** | unlimited | £100.1m | **5 GW** | none |

Free Hit is deliberately single-gameweek: the squad reverts afterwards, so optimising it over 5
gameweeks would be modelling a team you don't get to keep. Wildcard is permanent, so 5 GW is the
right basis.

Both chips are offered only while `chips: []` shows them unused — once played, the card
disappears rather than showing a stale recommendation.

**Solve count per forecast build:** 3 horizons × 4 transfer counts (k=0..3) + Free Hit + Wildcard
= **14 solves**. At ~486 players × 5 gameweeks the model is roughly 5k binaries — CBC territory
of seconds, not minutes. If the build gets slow, the fallback is to shortlist candidates (top ~40
per position by horizon xP, plus all held players) for the *transfer* scenarios only, keeping the
full pool for Free Hit and Wildcard. That trades global optimality for speed, so it stays a
fallback, not the default.

### Where it runs

All of it at **forecast-build time** in `scripts/compute_forecast.py`, written into the forecast
JSON as a `scenarios` block. The browser never solves anything — it renders precomputed results
and switches between horizons. PuLP in the browser is not an option, and the page must stay fast.

---

## Phase 1 — The optimiser core

- **Files:** `engine/optimise.py` (new), `engine/config.py`, `requirements.txt`,
  `tests/test_optimise.py` (new).
- **Approach:**
  1. `solve_squad(players, held, bank, free_transfers, horizon_gws, *, max_transfers=None,
     unlimited=False) -> ScenarioResult` — one function, all four scenario families, driven by
     its arguments. `ScenarioResult` carries the chosen 15, per-GW XI and captain, projected
     points, transfers in/out, hit cost and net points.
  2. `FT_MAX_BANKED`, `HIT_COST = 4`, and the squad-composition/club-limit constants into
     `engine/config.py` — no magic numbers in the solver.
  3. `derive_free_transfers(history_current, chips, target_gw)` — the KD5 derivation, returning
     both the number *and* the working ("1/GW since GW1, capped at 5, minus 0 used") so the UI can
     show it.
- **Test scenarios:**
  - A hand-built 20-player pool where the optimal 15 is known by inspection — solver must find it.
  - **Cross-check against `best_xi`:** for a fixed 15, the ILP's chosen XI and captain must match
    `engine.squad.best_xi` plus the highest-xP starter. This is the key test — it pins the new
    solver to the existing, already-trusted implementation.
  - Budget binds: a pool containing an outstanding but unaffordable player must not select them.
  - Club limit binds: 5 elite players from one club → at most 3 chosen.
  - Hit arithmetic: a move worth +3.0 over the horizon is rejected at a -4 cost; one worth +6.0
    is taken. Boundary at exactly 4.0.
  - `derive_free_transfers` caps at `FT_MAX_BANKED` and floors at 1.
- **Verification:** `python -m pytest -q` green, plus a timing check that the 14-solve set
  completes inside a stated budget on the real 486-player pool.

## Phase 2 — Scenarios into the forecast

- **Files:** `scripts/compute_forecast.py`, `engine/squad.py` (remove `pool_upgrades`),
  `tests/test_compute_forecast.py` or equivalent.
- **Approach:** After the pool is built, run the 14 solves and emit a `scenarios` block:
  `{ freeTransfers: {value, derivation}, chipsAvailable: {...}, byHorizon: {1: [...], 3: [...],
  5: [...]}, freeHit: {...}, wildcard: {...} }`. Drop `poolUpgrades` from the payload and delete
  `pool_upgrades()` and its tests.
- **Verification:** regenerate `data/forecast/gw4.json`; hand-check that the top 1-transfer
  scenario is a move that reads sensibly against the squad, and that `k = 0` reports the current
  squad's real projected total.

## Phase 3 — The UI

- **Files:** `src/app/Scenarios.tsx` (new), `src/app/page.tsx`, `src/lib/snapshots.ts`; delete
  `src/app/PlanningTable.tsx`.
- **Approach:** A scenario panel where the planning table was. A 1 / 3 / 5-gameweek segmented
  toggle at the top re-ranks instantly (all three are precomputed). Three scenario cards showing
  transfers in/out with prices, net points versus rolling, and hit cost where one applies. Below
  them, Free Hit and Wildcard cards — each showing the projected XI on the pitch layout, bench,
  and the gain over your current squad. The FT override control sits with its derivation note.
  Mobile-first, in line with the two-line row treatment that fixed the live tracker.
- **Verification:** `npx tsc --noEmit`, `npm run lint`, `npm run build`, and a real check at phone
  width that nothing overflows — the failure mode from PR #13.

---

## Verification Contract

| Gate | Command | Applies to |
|---|---|---|
| Python unit tests | `python -m pytest -q` | Phases 1, 2 |
| ILP-vs-`best_xi` agreement | `tests/test_optimise.py` | Phase 1 |
| Solve-time budget on the real pool | timing assertion in Phase 1 | Phase 1 |
| Regenerated forecast reads sensibly | `PYTHONPATH=. python scripts/compute_forecast.py`, manual inspection | Phase 2 |
| Type check / lint / build | `npx tsc --noEmit`, `npm run lint`, `npm run build` | Phase 3 |
| Mobile width, no overflow | manual check at phone width | Phase 3 |

## Definition of Done

- Three structurally different transfer scenarios (including "roll") at each of 1 / 3 / 5
  gameweeks, ranked on net points, hits shown explicitly and only ever net-positive.
- Free Hit (1 GW) and Wildcard (5 GW) each produce a legal, affordable 15 with the XI surfaced,
  and are hidden once the chip is used.
- Free-transfer balance derived with visible working and overridable in the UI.
- The full pool table and `poolUpgrades` are gone.
- Every gate in the Verification Contract passes.

## Resolved before implementation (2026-09-05)

1. **Banked-FT cap is 5.** Confirmed — see KD6.
2. **Wildcard is a full rebuild.** Confirmed. It ignores the existing squad entirely and picks
   the best legal 15 for the money, even if that means replacing most of the squad. No
   "keep at least N of your current players" constraint is to be added.

## Open Questions

1. **Sell-price accuracy.** The forecast already notes `bankNote: "sell prices assume each player
   was bought at today's price"`. If you've held risers, real sell prices differ and the budget
   line will be slightly off — always in the conservative direction. Worth a manual
   purchase-price override later if it bites; not in this plan.
