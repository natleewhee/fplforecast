const FPL = "https://fantasy.premierleague.com/api";

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
  if (!res.ok) throw new Error(`FPL ${path} -> ${res.status}`);
  return (await res.json()) as T;
}
