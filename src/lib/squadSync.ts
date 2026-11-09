/* The Squad pitch shows the model's last build, which starts from the squad you held when the last
 * gameweek finished. A transfer made since then (Hall -> Van Hecke) is already in your live squad, so
 * the two lists differ. This finds the differences and pairs each player who left with one who came in
 * at the same position, so the pitch can show your squad as it is now.
 * Pure, so it can be tested without the app. */

export type SquadEntry = { id: number; position: string; webName?: string };
export type PoolEntry = { id: number; position: string; webName: string };

export type AppliedSwap<P extends PoolEntry> = { outId: number; outName: string; incoming: P };

export type SquadSync<P extends PoolEntry> = {
  /** Each player who left, with the one who came in for him (only where we have projections for him). */
  swaps: AppliedSwap<P>[];
  /** Names of players now in the squad that the model has no projections for, so they cannot be shown. */
  unresolved: string[];
};

/** Compare the model's squad with the live one. Null live squad (not loaded, or failed) means no change. */
export function squadSync<P extends PoolEntry>(model: SquadEntry[], live: SquadEntry[] | null, pool: P[]): SquadSync<P> {
  if (!live || live.length === 0) return { swaps: [], unresolved: [] };
  const liveIds = new Set(live.map((p) => p.id));
  const modelIds = new Set(model.map((p) => p.id));
  const out = model.filter((p) => !liveIds.has(p.id));
  const incoming = live.filter((p) => !modelIds.has(p.id));
  const byId = new Map(pool.map((p) => [p.id, p]));
  const swaps: AppliedSwap<P>[] = [];
  const unresolved: string[] = [];
  const free = [...out];
  for (const inn of incoming) {
    const at = free.findIndex((o) => o.position === inn.position);
    const proj = byId.get(inn.id);
    if (at < 0 || !proj) {
      unresolved.push(inn.webName ?? proj?.webName ?? `#${inn.id}`);
      if (at >= 0) free.splice(at, 1);
      continue;
    }
    const [leaver] = free.splice(at, 1);
    swaps.push({ outId: leaver.id, outName: leaver.webName ?? `#${leaver.id}`, incoming: proj });
  }
  return { swaps, unresolved };
}

export type LiveSquadFeed = { gameweek: number; chip: string | null; squad: SquadEntry[] };

/** The live squad, if it can be compared with the model's. The model starts from the squad of gameweek
 * `basedOnGameweek` (plus any transfers saved in this app), so a live squad for that same gameweek is not
 * newer and would only undo the saved ones; and a Free Hit squad lasts one gameweek, so it says nothing
 * about the squad you keep. */
export function usableLiveSquad(feed: LiveSquadFeed | null, basedOnGameweek: number): SquadEntry[] | null {
  if (!feed || feed.squad.length === 0) return null;
  if (feed.gameweek <= basedOnGameweek) return null;
  if (feed.chip === "freehit") return null;
  return feed.squad;
}
