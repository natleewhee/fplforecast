/** Plain-language messages for a guest's /api/forecast lookup, each with a next step.
 * The server's own error text is for logs and debugging; this is what a person typing a
 * team ID for the first time reads. Kept free of React so it can be unit-tested. */

/** FPL team IDs are positive integers; 9 digits is far beyond any real one and stops
 * a pasted phone number or URL from being sent. */
export const TEAM_ID_PATTERN = /^[1-9][0-9]{0,8}$/;

export function isValidTeamIdInput(raw: string): boolean {
  return TEAM_ID_PATTERN.test(raw);
}

export const INVALID_TEAM_ID_MESSAGE =
  "A team ID is 1 to 9 digits, with no leading zero. Copy it from your FPL page address: fantasy.premierleague.com/entry/ the number /event/…";

/** Shown after a guest forecast has been loading for a few seconds (cold start). */
export const SLOW_LOAD_NOTE = "Building your forecast, about 10 seconds the first time.";

/** After how long the slow-load note appears. */
export const SLOW_LOAD_AFTER_MS = 3000;

export const TIMEOUT_MESSAGE =
  "This is taking too long. Try again in a minute; the first request after a quiet spell is the slowest.";

export const NETWORK_MESSAGE = "Couldn't reach the server. Check your connection and try again.";

export function forecastErrorMessage(status: number, teamId: string): string {
  switch (status) {
    case 400:
      return INVALID_TEAM_ID_MESSAGE;
    case 404:
      return `FPL has no team with ID ${teamId}. Check the number in your FPL page address and try again.`;
    case 422:
      return `Team ${teamId} has no squad recorded for the last finished gameweek yet. That's usual for a team that joined after it. Check back once the next gameweek finishes.`;
    case 503:
      return "There's nothing to forecast yet: either the first gameweek of the season hasn't finished, or FPL is updating. Try again in a few minutes.";
    default:
      return "Couldn't get your forecast from FPL just now. Try again in a minute.";
  }
}
