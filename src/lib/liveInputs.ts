import { forecastLiveInputs, poolLiveInputs, type LiveProjectionInputs } from "@/lib/liveBlend";
import { loadForecastFor, loadLatestForecast, type Forecast } from "@/lib/snapshots";

/** The committed forecast whose components belong to the gameweek being played:
 * data/forecast/gw{liveGw}.json, else the newest file. The newest file is built
 * for NEXT week once the daily build has run mid-gameweek, so using it for the
 * live view would price this week's remaining minutes with next week's xP. */
export function forecastForLiveGameweek(liveGw: number): Forecast | null {
  return loadForecastFor(liveGw) ?? loadLatestForecast();
}

/** Inputs for /api/live. Per-player components are per player, not per squad, so
 * both the owner and guests read them from the committed file (squad merged with
 * pool, so a player transferred in since the squad snapshot still gets xP). Only
 * the per-team par/rank inputs differ: the owner's come from the newest forecast,
 * a guest's from their own on-demand forecast. */
export function liveInputsFor(args: {
  liveGw: number;
  guestForecast?: Forecast | null;
  owner: boolean;
}): LiveProjectionInputs | null {
  // A guest with no forecast of their own has no par/rank inputs: don't invent them.
  if (!args.owner && !args.guestForecast) return null;
  const file = forecastForLiveGameweek(args.liveGw);
  const teamForecast = args.owner ? loadLatestForecast() : args.guestForecast ?? null;
  if (!file && !teamForecast) return null;
  const base = teamForecast ? forecastLiveInputs(teamForecast) : forecastLiveInputs(file!);
  if (!file) return base;
  return { ...base, componentXpByElement: poolLiveInputs(file).componentXpByElement };
}

/* Guests: /api/forecast runs the whole model, and the Live tab polls every 60s,
 * so keep each guest's forecast for 15 minutes. The fetch also asks Next's data
 * cache for the same window; this map covers instances/runtimes where that cache
 * is cold or absent. Only successful responses are stored. */
export const GUEST_FORECAST_TTL_S = 900;
const MAX_ENTRIES = 200;
const guestForecasts = new Map<string, { at: number; forecast: Forecast }>();

export async function guestForecast(teamId: string | number, url: URL, nowMs = Date.now()): Promise<Forecast | null> {
  const hit = guestForecasts.get(String(teamId));
  if (hit && nowMs - hit.at < GUEST_FORECAST_TTL_S * 1000) return hit.forecast;
  const res = await fetch(new URL(`/api/forecast?teamId=${teamId}`, url), {
    next: { revalidate: GUEST_FORECAST_TTL_S },
  });
  if (!res.ok) return null;
  const forecast = (await res.json()) as Forecast;
  guestForecasts.delete(String(teamId));
  if (guestForecasts.size >= MAX_ENTRIES) guestForecasts.delete(guestForecasts.keys().next().value!);
  guestForecasts.set(String(teamId), { at: nowMs, forecast });
  return forecast;
}

/** Test hook. */
export function clearGuestForecastCache() {
  guestForecasts.clear();
}
