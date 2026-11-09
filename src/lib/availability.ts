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

/** The risk kinds FPL publishes today and the row is labelled for. */
const KNOWN_RISK_KINDS = new Set(["suspension_risk", "loan_ineligible"]);

/** FPL's scout risks that bear on the coming gameweek: ones with no gameweek
 * (a yellow-card ban warning) and ones for exactly that gameweek (a loan-clause
 * fixture). Later-gameweek loan entries are left out so the list stays about
 * this deadline. Kinds the row is not labelled for are left out too. */
export function risksForGameweek(
  a: Availability | null | undefined,
  gameweek: number
): AvailabilityRisk[] {
  return (a?.risks ?? []).filter(
    (r) => KNOWN_RISK_KINDS.has(r.kind) && (r.gameweek == null || r.gameweek === gameweek)
  );
}

/** True when the forecast was built with FPL's risk data. A forecast built before
 * the field existed has no `risks` on any player, which must not read as "none". */
export function hasRiskData(players: { availability?: Availability | null }[]): boolean {
  return players.some((p) => Array.isArray(p.availability?.risks));
}
