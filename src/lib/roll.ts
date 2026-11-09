/* A number that rolls to a new value instead of jumping. Pure, so it can be tested. */

export const ROLL_MS = 900;

/** The value to show `progress` (0 to 1) of the way from `from` to `to`: fast at first, easing to a stop. */
export function rollValue(from: number, to: number, progress: number): number {
  const p = progress < 0 ? 0 : progress > 1 ? 1 : progress;
  const eased = 1 - (1 - p) ** 3;
  return Math.round(from + (to - from) * eased);
}
