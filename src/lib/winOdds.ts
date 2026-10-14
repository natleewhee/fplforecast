import type { LeagueSquadResponse, LeagueSquadRow } from "@/app/api/league/squad/route";

/** Overdispersion of a player's remaining points. FPL scoring is lumpy (most
 * players return 2-3 pts, a few haul), so the spread of what's still to come
 * is wider than a plain Poisson at the same mean. Remaining points are
 * modelled as `c * Poisson(mean / c)`, which keeps the mean at the app's xP
 * and gives variance `c * mean` -- c = 2.5 puts a 5 xP player at roughly
 * sd 3.5, close to a typical outfield returns spread. This is an assumption,
 * not a fit to the forecast model's own floor/ceiling band (that band is
 * only computed for the owner's squad, so it can't be used for a rival). */
export const OVERDISPERSION = 2.5;

export type Side = {
  /** Points already banked by the effective XI. */
  banked: number;
  /** Remaining-points means (already captain-multiplied) of players still to come. */
  pending: { mean: number; mult: number }[];
};

export function effectiveRows(squad: Pick<LeagueSquadResponse, "rows" | "chip">): LeagueSquadRow[] {
  if (squad.chip === "BB") return squad.rows;
  return squad.rows.filter((r) => (!r.isBench && !r.subbedOut) || r.subbedIn);
}

export function sideFrom(squad: Pick<LeagueSquadResponse, "rows" | "chip">): Side {
  const rows = effectiveRows(squad);
  const captainMult = squad.chip === "TC" ? 3 : 2;
  return {
    banked: rows.reduce((s, r) => s + r.pointsSoFar, 0),
    pending: rows
      .filter((r) => (r.status === "notStarted" || r.status === "playing") && r.remainingXp > 0)
      .map((r) => ({ mean: r.remainingXp, mult: r.isArmband ? captainMult : 1 })),
  };
}

/** Small deterministic PRNG so the same inputs always show the same odds
 * (no flicker between polls that changed nothing). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function poisson(lambda: number, rand: () => number): number {
  if (lambda <= 0) return 0;
  const limit = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rand();
  } while (p > limit);
  return k - 1;
}

function draw(side: Side, rand: () => number): number {
  let total = side.banked;
  for (const p of side.pending) {
    const base = p.mean / p.mult;
    total += p.mult * OVERDISPERSION * poisson(base / OVERDISPERSION, rand);
  }
  return total;
}

export type DuelOdds = {
  /** Chance A finishes strictly above B. */
  win: number;
  draw: number;
  lose: number;
  meanA: number;
  meanB: number;
};

export function simulateDuel(a: Side, b: Side, runs = 4000, seed = 1): DuelOdds {
  const rand = mulberry32(seed);
  let win = 0;
  let tie = 0;
  let sumA = 0;
  let sumB = 0;
  for (let i = 0; i < runs; i++) {
    const x = draw(a, rand);
    const y = draw(b, rand);
    sumA += x;
    sumB += y;
    if (x > y) win++;
    else if (x === y) tie++;
  }
  return {
    win: win / runs,
    draw: tie / runs,
    lose: (runs - win - tie) / runs,
    meanA: sumA / runs,
    meanB: sumB / runs,
  };
}

/** Players only one side holds (ignoring bench). */
export function differentials(a: LeagueSquadResponse, b: LeagueSquadResponse) {
  const ax = effectiveRows(a);
  const bx = effectiveRows(b);
  const bIds = new Set(bx.map((r) => r.id));
  const aIds = new Set(ax.map((r) => r.id));
  return {
    onlyA: ax.filter((r) => !bIds.has(r.id)),
    onlyB: bx.filter((r) => !aIds.has(r.id)),
  };
}

export function oddsLine(odds: DuelOdds, rivalName: string): string {
  const pct = Math.round(odds.win * 100);
  if (pct >= 99) return `Basically done: you beat ${rivalName}`;
  if (pct <= 1) return `${rivalName} has this one`;
  if (pct >= 50) return `${pct}% you finish above ${rivalName}`;
  return `${pct}% you overtake ${rivalName}`;
}
