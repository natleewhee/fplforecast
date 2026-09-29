/** A short "Nd Nh" / "Nh Nm" / "Nm" / "deadline passed" countdown string --
 * shared by LiveTracker.tsx's idle-state deadline display and
 * DeadlineChecklist.tsx's own countdown row. */
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
