import type { Availability, AvailabilityRisk } from "./snapshots";

/** Color + label for FPL's own doubt signal, for a badge/dot in the UI.
 * `null` means nothing worth flagging (fully fit, no doubt on record). */
export function availabilityFlag(
  a: Availability | null | undefined
): { color: string; label: string } | null {
  if (!a) return null;
  if (a.status === "i" || a.status === "s" || a.status === "u" || a.status === "n") {
    return { color: "var(--danger)", label: a.news || "Unavailable" };
  }
  if (a.status === "d" || (a.chance != null && a.chance < 100)) {
    const pct = a.chance != null ? `${a.chance}% chance of playing` : "Doubtful";
    return { color: "var(--warn)", label: a.news || pct };
  }
  return null;
}

/** FPL's scout risks that bear on the coming gameweek: ones with no gameweek
 * (a yellow-card ban warning) and ones for exactly that gameweek (a loan-clause
 * fixture). Later-gameweek loan entries are left out so the list stays about
 * this deadline. */
export function risksForGameweek(
  a: Availability | null | undefined,
  gameweek: number
): AvailabilityRisk[] {
  return (a?.risks ?? []).filter((r) => r.gameweek == null || r.gameweek === gameweek);
}
