import { forecastLiveInputs, poolLiveInputs, type LiveProjectionInputs } from "@/lib/liveBlend";
import { loadForecastFor, loadForecastUpTo } from "@/lib/snapshots";

/** The committed forecast built FOR the gameweek being played: data/forecast/gw{liveGw}.json,
 * else the newest file for an EARLIER gameweek. Never a later one: the newest file is built for
 * next week once the daily build has run mid-gameweek, which is the bug this avoids. */
export function forecastForLiveGameweek(liveGw: number) {
  return loadForecastFor(liveGw) ?? loadForecastUpTo(liveGw);
}

/** Inputs for /api/live.
 *
 * Per-player components are per player, not per squad, so both the owner and guests read them
 * from the committed gw{liveGw} file (its pool merged with its squad, so a player transferred in
 * since the squad snapshot still gets xP). Players outside that pool (it holds only available
 * players) fall back, for a guest, to their own forecast's squad components; those are built for
 * the NEXT deadline, so their ids are listed in `provisionalXpIds`.
 *
 * Par/rank inputs: the owner's come from the same gw{liveGw} file. A guest's come from their
 * on-demand /api/forecast, which targets the next deadline with the last finished gameweek's
 * picks, so they describe next week, not this one; the route cannot fix that from here. */
export function liveInputsFor(args: {
  liveGw: number;
  owner: boolean;
  guestInputs?: LiveProjectionInputs | null;
}): LiveProjectionInputs | null {
  const file = forecastForLiveGameweek(args.liveGw);
  if (!file) return null;
  const fromFile = poolLiveInputs(file);
  if (args.owner) {
    return { ...forecastLiveInputs(file), componentXpByElement: fromFile.componentXpByElement };
  }
  // A guest with no forecast of their own has no par/rank inputs: don't invent them.
  const guest = args.guestInputs;
  if (!guest) return null;
  const componentXpByElement = { ...fromFile.componentXpByElement };
  const provisionalXpIds: number[] = [];
  for (const [id, components] of Object.entries(guest.componentXpByElement)) {
    if (id in componentXpByElement) continue;
    componentXpByElement[id] = components;
    provisionalXpIds.push(Number(id));
  }
  return { ...guest, componentXpByElement, provisionalXpIds };
}

/* Guests: /api/forecast runs the whole model, and the Live tab polls every 60s, so keep each
 * guest's par/rank inputs and squad components (small) for 15 minutes. The fetch also asks Next's
 * data cache for the same window; this map covers instances where that cache is cold or absent.
 * Only successful responses are stored. */
export const GUEST_FORECAST_TTL_S = 900;
const MAX_ENTRIES = 200;
const guestCache = new Map<string, { at: number; inputs: LiveProjectionInputs }>();

export async function guestForecastInputs(
  teamId: string | number,
  url: URL,
  nowMs = Date.now(),
): Promise<LiveProjectionInputs | null> {
  const key = String(teamId);
  const hit = guestCache.get(key);
  if (hit && nowMs - hit.at < GUEST_FORECAST_TTL_S * 1000) return hit.inputs;
  const res = await fetch(new URL(`/api/forecast?teamId=${key}`, url), {
    next: { revalidate: GUEST_FORECAST_TTL_S },
  });
  if (!res.ok) return null;
  const inputs = forecastLiveInputs(await res.json());
  guestCache.delete(key);
  while (guestCache.size >= MAX_ENTRIES) guestCache.delete(guestCache.keys().next().value!);
  guestCache.set(key, { at: nowMs, inputs });
  return inputs;
}

/** Test hook. */
export function clearGuestForecastCache() {
  guestCache.clear();
}
