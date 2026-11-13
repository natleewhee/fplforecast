/* Plain words for a failed Leagues load, decided from the /api/league reply's status and the
 * server's own flags (src/lib/fplApi.ts upstreamFailure), never by matching its error text. */

/** A failed /api/league reply, already turned into the message to show. */
export class LeaguesFetchError extends Error {}

/** The message for one failed reply: `status` and its JSON body (`{}` when it wasn't JSON). */
export function leaguesReplyCopy(status: number, body: { error?: string; updating?: boolean }): string {
  if (body.updating === true) return "FPL is updating right now. It’s usually back within a few minutes.";
  // upstreamFailure reports an FPL error as 502 with "FPL /path/ -> 404"
  if (status === 404 || / -> 404\b/.test(body.error ?? "")) return "FPL couldn’t find a league for this team.";
  if (status === 429 || / -> 429\b/.test(body.error ?? "")) return "FPL is getting too many requests. Try again in a minute.";
  if (status === 503) return "The forecast this needs isn’t ready yet. Try again in a moment.";
  if (status >= 500) return "FPL isn’t answering right now. It’s usually back within a few minutes.";
  return "Something went wrong on our side. Try again in a moment.";
}

/** What to show for anything the Leagues load threw. */
export function leaguesErrorCopy(err: unknown): string {
  if (err instanceof LeaguesFetchError) return err.message;
  if (err instanceof TypeError) return "The connection dropped. Check your signal and try again.";
  return "Something went wrong on our side. Try again in a moment.";
}
