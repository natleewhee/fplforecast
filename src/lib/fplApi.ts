const FPL = "https://fantasy.premierleague.com/api";

/** Shown when FPL is between seasons or mid-update. */
export const FPL_UPDATING_TEXT = "FPL is updating for the new season";

/** FPL answers 503, or an HTML page with a 200, while it rebuilds its data
 * (the summer rollover and some mid-season updates). Distinct from a plain
 * failure so the app can say "try later" instead of "something broke". */
export class FplUpdatingError extends Error {
  constructor(path: string) {
    super(`${FPL_UPDATING_TEXT} (${path})`);
    this.name = "FplUpdatingError";
  }
}

/** The status and JSON body a route should return for an upstream failure. */
export function upstreamFailure(err: unknown): { status: number; body: { error: string; updating?: true } } {
  if (err instanceof FplUpdatingError) return { status: 503, body: { error: FPL_UPDATING_TEXT, updating: true } };
  return { status: 502, body: { error: (err as Error).message } };
}

/** GET one FPL endpoint, cached upstream for `revalidate` seconds (40 by
 * default: client polling at ~60s then costs at most a couple of FPL calls a
 * minute however many tabs are open, and the league routes fan out to one
 * request per entry on top). Throws on any non-2xx so each route's own
 * try/catch reports it. */
export async function fpl<T>(path: string, revalidate = 40): Promise<T> {
  const res = await fetch(`${FPL}${path}`, {
    next: { revalidate },
    headers: { "User-Agent": "fplforecast-live/1.0" },
  });
  if (res.status === 503) throw new FplUpdatingError(path);
  if (!res.ok) throw new Error(`FPL ${path} -> ${res.status}`);
  try {
    return (await res.json()) as T;
  } catch {
    throw new FplUpdatingError(path); // a non-JSON 200 is FPL's maintenance page
  }
}
