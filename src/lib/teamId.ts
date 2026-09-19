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
