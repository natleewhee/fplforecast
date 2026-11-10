import type { PriceWatch } from "./snapshots";

/** How close FPL's own progress figure must be to +/-100 before we call a move
 * "near". A judgement call, not an FPL rule: in a typical build only a handful
 * of the ~670 players sit beyond +/-90. */
export const NEAR_PERCENT = 90;

export type PriceSignal = "rise" | "fall" | null;

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** FPL's own signal for one player: "rise" or "fall" when its progress figure
 * is near +/-100, or its next-update bucket is +/-4 or beyond. Null otherwise
 * (including malformed or absent data). */
export function priceSignal(w: PriceWatch | null | undefined): PriceSignal {
  if (!w || !finite(w.percent)) return null;
  const lk = finite(w.likelihood) ? w.likelihood : 0;
  if (w.percent >= NEAR_PERCENT || lk >= 4) return "rise";
  if (w.percent <= -NEAR_PERCENT || lk <= -4) return "fall";
  return null;
}

/** True when the forecast was built with FPL's price fields. A forecast built
 * before they existed has none on any player, which must not read as "no change". */
export function hasPriceData(players: { priceWatch?: PriceWatch | null }[]): boolean {
  return players.some((p) => p.priceWatch != null && finite(p.priceWatch.percent));
}

const compact = (n: number) => {
  const a = Math.abs(n);
  const v = a >= 1000 ? `${(a / 1000).toFixed(a >= 10000 ? 0 : 1)}k` : `${a}`;
  return `${n < 0 ? "-" : "+"}${v}`;
};

export type PriceRow = { status: "info" | "amber" | "ok"; detail: string };

/** The one checklist row: which of the squad FPL's data says are near a rise or
 * fall, quoted with the numbers; what it does show otherwise. */
export function priceRow(
  players: { webName: string; priceWatch?: PriceWatch | null }[]
): PriceRow {
  if (!hasPriceData(players)) return { status: "info", detail: "Not in this build yet; arrives with tonight's update." };
  const line = (p: { webName: string; priceWatch?: PriceWatch | null }) => {
    const w = p.priceWatch!;
    const net = finite(w.netTransfers) ? `, ${compact(w.netTransfers)} net transfers this GW` : "";
    return `${p.webName} (${w.percent > 0 ? "+" : ""}${w.percent}%${net})`;
  };
  const flagged = (s: PriceSignal) => players.filter((p) => priceSignal(p.priceWatch) === s);
  const rises = flagged("rise");
  const falls = flagged("fall");
  const moved = players.filter((p) => finite(p.priceWatch?.changeThisGw) && p.priceWatch!.changeThisGw !== 0);
  const parts: string[] = [];
  if (falls.length) parts.push(`FPL data suggests ${falls.map(line).join(", ")} may fall.`);
  if (rises.length) parts.push(`FPL data suggests ${rises.map(line).join(", ")} may rise.`);
  if (moved.length)
    parts.push(
      `Already moved this GW: ${moved
        .map((p) => `${p.webName} ${p.priceWatch!.changeThisGw > 0 ? "+" : "-"}£${(Math.abs(p.priceWatch!.changeThisGw) / 10).toFixed(1)}m`)
        .join(", ")}.`
    );
  if (!parts.length) return { status: "ok", detail: "FPL data shows none of your 15 near a price change." };
  return { status: falls.length ? "amber" : "info", detail: parts.join(" ") };
}
