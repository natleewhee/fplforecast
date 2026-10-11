/** Where FPL serves a player's headshot, newest known location first. The
 * image is 110x140 with the head and shoulders on a transparent background.
 * The code comes from bootstrap-static (`element.code`, the same number as
 * the `photo` filename). A token tries each URL in turn and falls back to the
 * shirt if none loads, so a changed path degrades the look, never the data. */
export function photoUrls(code: number | null | undefined): string[] {
  if (!code) return [];
  return [
    `https://resources.premierleague.com/premierleague25/photos/players/110x140/${code}.png`,
    `https://resources.premierleague.com/premierleague/photos/players/110x140/p${code}.png`,
  ];
}
