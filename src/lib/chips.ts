import type { ChipWindow } from "./snapshots";

/** Chip logic shared by the deadline checklist and the Scenarios chip-timing
 * card. Everything reads `forecast.chips` (per team, from FPL's own chip
 * rules plus that team's history); `null`/`undefined` means "unknown" and is
 * never replaced by a guess. */

export const CHIP_LABEL: Record<string, string> = {
  wildcard: "Wildcard",
  freehit: "Free Hit",
  bboost: "Bench Boost",
  "3xc": "Triple Captain",
};

export const chipLabel = (name: string) => CHIP_LABEL[name] ?? name;

const ORDER = ["wildcard", "freehit", "bboost", "3xc"];
const rank = (name: string) => (ORDER.includes(name) ? ORDER.indexOf(name) : ORDER.length);

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Where one chip stands at `targetGw`. */
export type ChipState =
  | { kind: "open"; expiresGw: number }
  // Not usable this week: `usedNow` = this half's one is spent; `nextFromGw` =
  // the first later window that is still unused (null = none left).
  | { kind: "closed"; usedNow: boolean; nextFromGw: number | null }
  | { kind: "unknown" };

export function chipState(
  chips: ChipWindow[] | null | undefined,
  name: string,
  targetGw: number,
): ChipState {
  if (!chips) return { kind: "unknown" };
  const mine = chips.filter((c) => c.name === name);
  if (mine.length === 0) return { kind: "unknown" };
  const open = mine.find((c) => c.availableNow);
  if (open) return { kind: "open", expiresGw: open.expiresGw };
  const current = mine.find((c) => c.window.start <= targetGw && targetGw <= c.window.stop);
  const next = mine
    .filter((c) => c.window.start > targetGw && !c.used)
    .sort((a, b) => a.window.start - b.window.start)[0];
  return { kind: "closed", usedNow: current?.used ?? false, nextFromGw: next ? next.window.start : null };
}

export type ChecklistSummary = { status: "info" | "amber"; detail: string };

/** The deadline-checklist row. Open chips are grouped by the gameweek they
 * expire ("2 first-half chips left (Free Hit, Triple Captain); use by GW19
 * (8 GWs)"), then chips that are spent or not open yet. */
export function chipChecklist(chips: ChipWindow[] | null | undefined, targetGw: number): ChecklistSummary {
  if (!chips || chips.length === 0) {
    return { status: "info", detail: "Chip status unavailable right now." };
  }
  const stops = [...new Set(chips.map((c) => c.window.stop))].sort((a, b) => a - b);
  const half = (stop: number) =>
    stops.length < 2 ? "" : stop === stops[0] ? "first-half " : stop === stops[stops.length - 1] ? "second-half " : "";

  const open = chips.filter((c) => c.availableNow).sort((a, b) => rank(a.name) - rank(b.name));
  const names = [...new Set(chips.map((c) => c.name))].sort((a, b) => rank(a) - rank(b));
  const parts: string[] = [];
  let status: "info" | "amber" = "info";

  const byExpiry = new Map<number, ChipWindow[]>();
  for (const c of open) byExpiry.set(c.expiresGw, [...(byExpiry.get(c.expiresGw) ?? []), c]);
  for (const [expiresGw, group] of [...byExpiry].sort((a, b) => a[0] - b[0])) {
    const left = expiresGw - targetGw + 1; // deadlines left, counting this week
    if (left <= 3) status = "amber";
    const deadline =
      left <= 1 ? `use this week (last chance, GW${expiresGw})` : `use by GW${expiresGw} (${left} GWs incl. this one)`;
    parts.push(
      `${plural(group.length, `${half(group[0].window.stop)}chip`)} left (${group
        .map((c) => chipLabel(c.name))
        .join(", ")}); ${deadline}`,
    );
  }
  if (open.length === 0) parts.push("No chips available this week");

  const closed = names
    .map((n) => ({ name: n, state: chipState(chips, n, targetGw) }))
    .filter((c) => c.state.kind === "closed") as { name: string; state: Extract<ChipState, { kind: "closed" }> }[];
  const spent = new Map<string, string[]>(); // "next from GW20" | "none left" -> chip labels
  for (const { name, state } of closed) {
    if (!state.usedNow && state.nextFromGw == null) continue; // nothing to say
    if (!state.usedNow && state.nextFromGw != null) {
      const key = `next from GW${state.nextFromGw}`;
      spent.set(key, [...(spent.get(key) ?? []), chipLabel(name)]);
      continue;
    }
    const key = state.nextFromGw != null ? `used, next from GW${state.nextFromGw}` : "used, none left";
    spent.set(key, [...(spent.get(key) ?? []), chipLabel(name)]);
  }
  const spentText = [...spent].map(([why, labels]) => `${labels.join(", ")} ${why}`).join("; ");
  return { status, detail: spentText ? `${parts.join("; ")}. ${spentText}.` : `${parts.join("; ")}.` };
}

export type TimingPick<T> = { pick: T; seesAllOfWindow: boolean; lastGwSeen: number };

/** Best gameweek for a hold-the-squad chip (Bench Boost / Triple Captain),
 * restricted to gameweeks at or before the chip window's last gameweek.
 * `seesAllOfWindow` is false when the window runs past the last forecast
 * gameweek — the forecast only looks a few GWs ahead, so a better week may
 * come later. Returns null when no forecast gameweek is inside the window. */
export function bestWithinWindow<T extends { gameweek: number }>(
  ranked: T[],
  expiresGw: number,
  lastForecastGw: number,
): TimingPick<T> | null {
  const eligible = ranked.filter((r) => r.gameweek <= expiresGw);
  if (eligible.length === 0) return null;
  return { pick: eligible[0], seesAllOfWindow: expiresGw <= lastForecastGw, lastGwSeen: lastForecastGw };
}
