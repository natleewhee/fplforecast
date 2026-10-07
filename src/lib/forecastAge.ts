/** A forecast is rebuilt daily at 03:00 UTC, so anything older than this means
 * the daily job has missed at least one run (the allowance covers a slow run). */
export const STALE_AFTER_HOURS = 36;

export function forecastAgeHours(generatedAt: string, nowMs: number): number | null {
  const built = Date.parse(generatedAt);
  return Number.isFinite(built) ? Math.max(0, (nowMs - built) / 3_600_000) : null;
}

export function describeAge(hours: number): string {
  return hours >= 48 ? `${Math.floor(hours / 24)} days` : `${Math.floor(hours)} hours`;
}
