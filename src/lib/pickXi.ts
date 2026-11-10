/* The lineup the Squad pitch, the fixture ticker and the captain shortlist all show. The model picks its
 * XI from the squad held when the last gameweek finished. When a transfer has since been made (in FPL, or
 * saved in this app) the newcomer stands in the leaver's slot, which can leave a better player on the bench
 * (Van Hecke 4.9 on the bench while Calafiori 3.6 starts). So with swaps, this re-picks the best legal XI
 * from the fifteen using the xP already shown. With no swaps it returns the model's own lineup untouched.
 * Pure, so it can be tested without the app. */

export type Slot = {
  /** the model-squad id this slot started as (the id the model's lists use) */
  slot: number;
  position: string; // GKP | DEF | MID | FWD
  /** target-gameweek xP of whoever stands in this slot now (a joiner's, if swapped); null = unknown */
  xp: number | null;
  /** projected from a prior alone (no history): may start, but the model never gives such a player the armband */
  provisional?: boolean;
};

export type LineupInput = {
  slots: Slot[];
  modelXi: number[];
  modelBench: number[];
  modelCaptain: number | null;
  modelVice: number | null;
  /** slots whose player was transferred out (made in FPL or saved here): the armband does not pass to the joiner */
  swappedSlots: Set<number>;
  /** whether any transfer (made or saved) is shown */
  hasSwaps: boolean;
};

export type Lineup = {
  /** slot ids */
  xi: number[];
  bench: number[];
  captain: number | null;
  vice: number | null;
  /** the app re-picked the XI because of transfers (not the model's choice) */
  repicked: boolean;
  /** the armband differs from the model's because its holder was transferred out or benched */
  armbandAdjusted: boolean;
  captainChanged: boolean;
  viceChanged: boolean;
  /** XI xP with the captain counted twice, like the model's headline */
  points: number;
};

/** A re-pick must gain at least this much xP over the model's lineup with the joiners dropped in, or the
 * model's choice stands. Below it the difference is noise, and flip-flopping a player is worse than a
 * few tenths of a point. */
export const MIN_REPICK_GAIN = 0.3;

const NEED = { GKP: [1, 1], DEF: [3, 5], MID: [2, 5], FWD: [1, 3] } as const;

export function isLegalXi(positions: string[]): boolean {
  if (positions.length !== 11) return false;
  return (Object.keys(NEED) as (keyof typeof NEED)[]).every((k) => {
    const n = positions.filter((p) => p === k).length;
    return n >= NEED[k][0] && n <= NEED[k][1];
  });
}

// A missing xP counts as 0 (harmless for choosing the XI; the headline counts it as 0 too, unflagged).
const val = (s: Slot) => s.xp ?? 0;

export function pickLineup(input: LineupInput): Lineup {
  const by = new Map(input.slots.map((s) => [s.slot, s]));
  const total = (ids: number[]) => ids.reduce((n, id) => n + (by.get(id) ? val(by.get(id)!) : 0), 0);

  let xi = input.modelXi.filter((id) => by.has(id));
  let bench = input.modelBench.filter((id) => by.has(id));
  let repicked = false;

  if (input.hasSwaps && input.slots.length === 15) {
    const byPos = (pos: string) => input.slots.filter((s) => s.position === pos).sort((a, b) => val(b) - val(a));
    const gk = byPos("GKP"), def = byPos("DEF"), mid = byPos("MID"), fwd = byPos("FWD");
    let best: { ids: number[]; sum: number } | null = null;
    if (gk.length >= 1) {
      for (let d = NEED.DEF[0]; d <= NEED.DEF[1]; d++)
        for (let m = NEED.MID[0]; m <= NEED.MID[1]; m++) {
          const f = 10 - d - m;
          if (f < NEED.FWD[0] || f > NEED.FWD[1] || d > def.length || m > mid.length || f > fwd.length) continue;
          const pick = [gk[0], ...def.slice(0, d), ...mid.slice(0, m), ...fwd.slice(0, f)];
          const sum = pick.reduce((n, s) => n + val(s), 0);
          if (!best || sum > best.sum) best = { ids: pick.map((s) => s.slot), sum };
        }
    }
    // Keep the model's XI (with the joiners in) unless the re-pick clearly beats it.
    if (best && best.sum - total(xi) >= MIN_REPICK_GAIN) {
      const chosen = new Set(best.ids);
      // keep the model's order where players stay, so the pitch does not shuffle needlessly
      xi = [...xi.filter((id) => chosen.has(id)), ...best.ids.filter((id) => !xi.includes(id))];
      // bench the way the model does: backup keeper first, then outfielders by xP, highest first
      bench = input.slots
        .filter((s) => !chosen.has(s.slot))
        .sort((a, b) => Number(b.position === "GKP") - Number(a.position === "GKP") || val(b) - val(a))
        .map((s) => s.slot);
      repicked = true;
    }
  }

  // Armband: the model's holder keeps it while he is still starting and was not transferred out (a joiner
  // never inherits it). Otherwise the highest-xP starter takes it (and the vice likewise), flagged as adjusted.
  // Provisional (prior-only) players may start but never wear the armband, as in the model.
  const ranked = [...xi].sort((a, b) => val(by.get(b)!) - val(by.get(a)!));
  const eligible = ranked.filter((id) => !by.get(id)!.provisional);
  const ok = (id: number | null) => id != null && xi.includes(id) && !input.swappedSlots.has(id);
  const captain = ok(input.modelCaptain) ? input.modelCaptain : input.hasSwaps ? (eligible[0] ?? null) : input.modelCaptain;
  const vice = ok(input.modelVice) && input.modelVice !== captain
    ? input.modelVice
    : input.hasSwaps ? (eligible.find((id) => id !== captain) ?? null) : input.modelVice;
  const captainChanged = input.hasSwaps && captain !== input.modelCaptain;
  const viceChanged = input.hasSwaps && vice !== input.modelVice;
  const armbandAdjusted = captainChanged || viceChanged;
  const points = total(xi) + (captain != null && by.has(captain) ? val(by.get(captain)!) : 0);
  return { xi, bench, captain, vice, repicked, armbandAdjusted, captainChanged, viceChanged, points };
}
