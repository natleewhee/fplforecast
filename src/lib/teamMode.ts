export type TeamMode = "now" | "next";

/** Which half of the Team tab opens: `?tab=live` / `?tab=squad` (old links) pick it, else the
 * live view once the deadline has passed and the next week's plan while it is still ahead. */
export function initialTeamMode(search: string, deadline: string | null | undefined, nowMs: number): TeamMode {
  const tab = new URLSearchParams(search).get("tab");
  if (tab === "live") return "now";
  if (tab === "squad") return "next";
  const deadlineMs = deadline ? Date.parse(deadline) : NaN;
  return Number.isFinite(deadlineMs) && nowMs < deadlineMs ? "next" : "now";
}
