import type { Availability, PoolPlayer } from "./snapshots";
import type { PendingTransfer } from "./transfers";

/* The rules behind "replace this player" on the pitch: who can legally come in
 * for a given player, given the budget, the three-per-club limit, the squad's
 * fixed shape (a swap keeps the position) and any transfers already saved but
 * not yet applied by the next rebuild. Pure, so it can be checked on its own. */

export const MAX_PER_CLUB = 3;
export type Horizon = 1 | 3 | 5;

/** The bits of a squad member the rules need. */
export type Held = { id: number; team: string; position: string; sellPrice: number };
/** The bits of any player (for a pending incoming one) the rules need. */
export type Known = { id: number; team: string; position: string; priceMillions: number };

export type ReplaceOption = {
  player: PoolPlayer;
  xp: number; // expected points over the horizon
  delta: number; // vs the player being replaced
  left: number; // £m left in the bank after the swap
};

const sum = (xs: number[], n: number) => xs.slice(0, n).reduce((a, b) => a + b, 0);

export function xpOver(p: Pick<PoolPlayer, "perGameweek">, horizon: Horizon): number {
  return sum(p.perGameweek, horizon);
}

/** The squad as it will look once the saved transfers are applied. */
export function squadAfterPending(held: Held[], pending: PendingTransfer[], known: Map<number, Known>): Held[] {
  const squad = [...held];
  for (const t of pending) {
    const idx = squad.findIndex((h) => h.id === t.out);
    const incoming = known.get(t.in);
    if (idx === -1 || !incoming) continue;
    squad[idx] = { id: incoming.id, team: incoming.team, position: incoming.position, sellPrice: incoming.priceMillions };
  }
  return squad;
}

/** Bank after saved-but-unapplied transfers: each sells the outgoing player at
 * their sell price and buys the incoming one at today's price. */
export function bankAfterPending(bank: number, held: Held[], pending: PendingTransfer[], known: Map<number, Known>): number {
  let b = bank;
  for (const t of pending) {
    const out = held.find((h) => h.id === t.out);
    const incoming = known.get(t.in);
    if (out && incoming) b += out.sellPrice - incoming.priceMillions;
  }
  return b;
}

const isOut = (a: Availability | undefined | null) => a?.status === "i" || a?.status === "s" || a?.status === "u" || a?.status === "n";

export function replaceOptions(args: {
  out: Held;
  outXp: number;
  squad: Held[]; // the squad after pending transfers
  pool: PoolPlayer[];
  bank: number; // after pending transfers
  horizon: Horizon;
  query?: string;
  limit?: number;
}): ReplaceOption[] {
  const { out, outXp, squad, pool, bank, horizon, query = "", limit = 12 } = args;
  const inSquad = new Set(squad.map((h) => h.id));
  const clubCount = (team: string) => squad.filter((h) => h.id !== out.id && h.team === team).length;
  const budget = bank + out.sellPrice;
  const q = query.trim().toLowerCase();

  return pool
    .filter(
      (p) =>
        p.position === out.position &&
        !inSquad.has(p.id) &&
        p.price <= budget + 1e-9 &&
        clubCount(p.team) < MAX_PER_CLUB &&
        !isOut(p.availability) &&
        (q === "" || p.webName.toLowerCase().includes(q)),
    )
    .map((p) => {
      const xp = xpOver(p, horizon);
      return { player: p, xp, delta: xp - outXp, left: budget - p.price };
    })
    .sort((a, b) => b.xp - a.xp)
    .slice(0, limit);
}
