/* Who is in the squad right now, as the Squad pitch, the fixture ticker and the captain shortlist all
 * need to agree. The forecast's squad is the one held when the last gameweek finished; two things can
 * change it: transfers already made in FPL since (the live squad) and transfers saved in this app
 * (owner only). Each leaves a swap: the player who left maps to the one who came in.
 * Pure, so it can be tested without the app. */

import type { Forecast, PoolPlayer } from "./snapshots";
import { squadSync, type SquadSync } from "./squadSync";

export type PendingSwap = { out: number; in: number };

export type ResolvedSwaps = {
  /** leaver id -> the player now standing in his place */
  swaps: Map<number, PoolPlayer>;
  /** ids of leavers whose transfer is already made in FPL (as opposed to only saved here) */
  appliedOut: Set<number>;
  /** ids of the players who came in through those transfers */
  appliedIn: Set<number>;
  /** how many saved-here transfers are shown */
  pendingShown: number;
  sync: SquadSync<PoolPlayer>;
};

export function resolveSwaps(
  forecast: Pick<Forecast, "squad" | "pool">,
  liveSquad: { id: number; position: string }[] | null | undefined,
  pending: PendingSwap[] | undefined,
  /** the pool saved transfers are looked up in (the owner's transfer tools carry their own) */
  pendingPool?: PoolPlayer[],
): ResolvedSwaps {
  const byId = new Map(forecast.squad.players.map((p) => [p.id, p]));
  const poolById = new Map((pendingPool ?? forecast.pool ?? []).map((p) => [p.id, p]));
  const swaps = new Map<number, PoolPlayer>();
  // Transfers already made in FPL come first: they are your squad now.
  const sync = squadSync(
    forecast.squad.players.map((p) => ({ id: p.id, position: p.position, webName: p.webName })),
    liveSquad ?? null,
    forecast.pool ?? [],
  );
  const appliedOut = new Set<number>();
  for (const a of sync.swaps) {
    swaps.set(a.outId, a.incoming);
    appliedOut.add(a.outId);
  }
  const appliedIn = new Set(sync.swaps.map((a) => a.incoming.id));
  let pendingShown = 0;
  for (const t of pending ?? []) {
    if (appliedOut.has(t.out) || appliedIn.has(t.in)) continue;
    const incoming = poolById.get(t.in);
    const outgoing = byId.get(t.out);
    if (incoming && outgoing && incoming.position === outgoing.position) {
      swaps.set(t.out, incoming);
      pendingShown += 1;
    }
  }
  return { swaps, appliedOut, appliedIn, pendingShown, sync };
}
