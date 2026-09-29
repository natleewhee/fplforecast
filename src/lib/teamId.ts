/** Which FPL team the current visitor is looking at. Defaults to this app's
 * own team (the pre-cached, git-committed daily forecast) so nothing
 * changes for a plain visit; a visitor who enters a different team ID gets
 * it stored in a cookie, and every API route that's per-team reads it from
 * there instead of hardcoding `TEAM_ID`.
 *
 * `/api/transfers` (the one route that writes to this repo) is the
 * exception -- it never accepts a guest's team ID, see its own route.ts. */

export const OWNER_TEAM_ID = process.env.FPL_TEAM_ID || "1168513";

export const TEAM_ID_COOKIE = "fpl_team_id";

/** Server-side: read the cookie off a request/response's cookie jar shape
 * (works with both `NextRequest.cookies` and `next/headers`'s `cookies()`,
 * which both expose `.get(name)?.value`). Falls back to the owner's own
 * team for a plain visit or a malformed cookie value. */
export function resolveTeamId(cookieJar: { get(name: string): { value: string } | undefined }): string {
  const raw = cookieJar.get(TEAM_ID_COOKIE)?.value;
  if (!raw) return OWNER_TEAM_ID;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return OWNER_TEAM_ID;
  return raw;
}

export function isOwnerTeam(teamId: string): boolean {
  return teamId === OWNER_TEAM_ID;
}

function isValidTeamId(raw: string | null | undefined): raw is string {
  if (!raw) return false;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0;
}

/** Server-side, for the per-team read routes (/api/live, /api/league,
 * /api/league/squad): prefers an explicit `?teamId=` query param over the
 * cookie. The client sends that param when viewing a shared link (`?team=`
 * on the page URL) that differs from the saved cookie, so those tabs follow
 * the link's team rather than whatever's saved -- see teamId's own module
 * doc and AppShell.tsx's isViewingSharedLink.
 *
 * Never used by /api/transfers, which stays strictly cookie-scoped to the
 * owner (see that route's own guard) -- a query param must never be able to
 * write to this repo on someone else's behalf. */
export function resolveTeamIdFromRequest(req: {
  nextUrl: { searchParams: URLSearchParams };
  cookies: { get(name: string): { value: string } | undefined };
}): string {
  const queryRaw = req.nextUrl.searchParams.get("teamId");
  if (isValidTeamId(queryRaw)) return queryRaw;
  return resolveTeamId(req.cookies);
}

/** Client-side: read the cookie directly from `document.cookie` (no library
 * needed for one flat cookie). `null` means "no override set" -- the owner's
 * own team, same as the server-side default. */
export function getClientTeamId(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${TEAM_ID_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/** `null` clears the override (back to the owner's own team). 180 days: long
 * enough that picking a team once "sticks", short enough that an abandoned
 * browser doesn't hold it forever. */
export function setClientTeamId(teamId: string | null): void {
  if (typeof document === "undefined") return;
  if (teamId == null) {
    document.cookie = `${TEAM_ID_COOKIE}=; path=/; max-age=0`;
  } else {
    document.cookie = `${TEAM_ID_COOKIE}=${encodeURIComponent(teamId)}; path=/; max-age=${60 * 60 * 24 * 180}`;
  }
}

// The page-URL query param for a shareable team link (`/?team=123`) --
// deliberately a different name from the cookie/API's `teamId`, so a
// shared page link and an API request are never visually confusable.
const URL_TEAM_PARAM = "team";

/** Client-side: the `?team=` on the current page URL, if any and valid.
 * `null` means no link-supplied team -- fall back to the cookie. */
export function getUrlTeamId(): string | null {
  if (typeof window === "undefined") return null;
  const raw = new URLSearchParams(window.location.search).get(URL_TEAM_PARAM);
  if (!isValidTeamId(raw)) return null;
  return raw;
}

/** Client-side: reflects the currently-viewed team in the address bar via
 * `history.replaceState` (no navigation/reload) so the URL is always
 * shareable as-is. `null` removes the param (e.g. after "Switch team"). */
export function setUrlTeamId(teamId: string | null): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (teamId == null) url.searchParams.delete(URL_TEAM_PARAM);
  else url.searchParams.set(URL_TEAM_PARAM, teamId);
  window.history.replaceState(null, "", url.toString());
}
