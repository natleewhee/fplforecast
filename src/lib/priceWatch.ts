import type { PriceWatch } from "./snapshots";

/** How close FPL's own progress figure must be to +/-100 before we call a move
 * "near". A judgement call, not an FPL rule: in a typical build only a handful
 * of the ~670 players sit beyond +/-90. */
export const NEAR_PERCENT = 90;

export type PriceSignal = "rise" | "fall" | null;

/** Shown by the checklist when the forecast predates the price fields. */
export const NO_PRICE_DATA = "Not in this build yet; arrives with the next daily update.";

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

/** Net transfers as a short signed figure: 950, +10k, +1.2m. */
export const compact = (n: number) => {
  const a = Math.abs(n);
  let v: string;
  if (a >= 999_500) v = `${(a / 1_000_000).toFixed(1)}m`;
  else if (a >= 1000) v = `${Math.round(a / 1000)}k`;
  else v = `${Math.round(a)}`;
  return `${n < 0 ? "-" : "+"}${v}`;
};

export type PriceRow = { status: "info" | "amber" | "ok"; detail: string };

type Row = { webName: string; priceWatch?: PriceWatch | null };

/** The one checklist row: which of the squad FPL's data says are near a rise or
 * fall, quoted with the numbers; what it does show otherwise. The "near" state
 * comes from the flags alone. Moves already made this GW are summarised (a
 * list of every mover floods the row): only owned players who already fell are
 * named. FPL's figure is against today's price, not the manager's sell price. */
export function priceRow(players: Row[]): PriceRow {
  if (!hasPriceData(players)) return { status: "info", detail: NO_PRICE_DATA };
  const withData = players.filter((p) => p.priceWatch != null && finite(p.priceWatch.percent));
  const line = (p: Row) => {
    const w = p.priceWatch!;
    const net = finite(w.netTransfers) ? `, ${compact(w.netTransfers)} net transfers this GW` : "";
    return `${p.webName} (${w.percent > 0 ? "+" : ""}${w.percent}%${net})`;
  };
  const flagged = (s: PriceSignal) => withData.filter((p) => priceSignal(p.priceWatch) === s);
  const rises = flagged("rise");
  const falls = flagged("fall");
  const moved = withData.filter((p) => finite(p.priceWatch!.changeThisGw) && p.priceWatch!.changeThisGw !== 0);
  const fell = moved.filter((p) => p.priceWatch!.changeThisGw < 0);
  const parts: string[] = [];
  if (falls.length) parts.push(`FPL data suggests ${falls.map(line).join(", ")} price may fall.`);
  if (rises.length) parts.push(`FPL data suggests ${rises.map(line).join(", ")} price may rise.`);
  if (!falls.length && !rises.length)
    parts.push(`FPL data shows none of your ${withData.length} near a price change.`);
  if (fell.length) parts.push(`Already fell this GW: ${fell.map((p) => p.webName).join(", ")}.`);
  const others = moved.length - fell.length;
  if (others > 0) parts.push(`${others} other${others === 1 ? "" : "s"} moved this GW.`);
  const missing = players.length - withData.length;
  if (missing > 0) parts.push(`No price data for ${missing}.`);
  return { status: falls.length ? "amber" : rises.length ? "info" : "ok", detail: parts.join(" ") };
}
