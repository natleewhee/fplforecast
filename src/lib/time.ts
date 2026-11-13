/* Every way the app says "when" or "how long": a deadline countdown, how old
 * a forecast or a live poll is, and a clock time. */

/** A short "Nd Nh" / "Nh Nm" / "Nm" / "deadline passed" countdown string --
 * shared by the Live tab's idle state, the deadline checklist and the banner. */
export function countdown(deadline: string, nowMs: number): string {
  const diffMs = Date.parse(deadline) - nowMs;
  if (diffMs <= 0) return "deadline passed";
  const totalMinutes = Math.floor(diffMs / 60_000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

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

/** "just now" / "3 min ago" / "1h 15m ago", for how fresh live numbers are. */
export function ageText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${Math.max(1, m)} min ago`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m ago`;
}

/* The one place the app formats a date or time. Everything is shown in
 * Singapore Time (deadlines, kickoffs and build times are all read against it),
 * 24-hour, en-GB, so every screen says "Sat 21:00" the same way. */
const SG = "Asia/Singapore";
const fmtDay = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: SG });
const fmtTime = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: SG });
const fmtDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: SG });

function parsed(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "21:00" in SGT, or an em dash when there is no time. */
export function clockTime(iso: string | null): string {
  const d = parsed(iso);
  return d ? fmtTime.format(d) : "—";
}

/** "Sat 21:00" in SGT (the caller adds "SGT" where it helps), or an em dash. */
export function sgDayTime(iso: string | null): string {
  const d = parsed(iso);
  return d ? `${fmtDay.format(d)} ${fmtTime.format(d)}` : "—";
}

/** "13 Nov, 21:00 SGT", for when something was built, or an em dash. */
export function sgDateTime(iso: string | null | undefined): string {
  const d = parsed(iso);
  return d ? `${fmtDate.format(d)}, ${fmtTime.format(d)} SGT` : "—";
}
