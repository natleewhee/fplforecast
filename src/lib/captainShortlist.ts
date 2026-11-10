/* The captain shortlist: the three starters with the highest expected points for the target gameweek,
 * with the numbers that help choose between them. Works from any forecast payload (the owner's committed
 * file or a guest's), using only fields both carry. Every claim shown comes from a comparison made here,
 * never from text the model wrote. */

import type { Forecast, PoolPlayer } from "./snapshots";

export type CaptainCandidate = {
  id: number;
  webName: string;
  team: string;
  xp: number;
  floor: number | null;
  ceiling: number | null;
  /** FPL's overall ownership; not effective ownership */
  ownedPct: number | null;
  form: number | null;
  isDouble: boolean;
  isModelPick: boolean;
};

export type SecondPickKind = "differential" | "safe";

export type CaptainShortlist = {
  gameweek: number;
  candidates: CaptainCandidate[];
  /** why the second candidate is a differential or a safe pick, with the numbers; null when they do not support one */
  secondNote: { kind: SecondPickKind; text: string } | null;
  /** captain vs vice, as the model labels it; only when both are unchanged by transfers */
  edge: { label: string; points: number; viceName: string } | null;
};

/** A difference smaller than this is noise, not a reason to call a player a differential or a safe pick. */
export const MIN_OWNERSHIP_GAP = 5; // percentage points
export const MIN_FLOOR_GAP = 0.5; // points

const f1 = (n: number) => n.toFixed(1);
const pct = (n: number) => `${n < 10 ? n.toFixed(1) : n.toFixed(0)}%`;

/** Why the second candidate might be worth a look instead of the pick, or null if the numbers say nothing. */
export function secondPickNote(pick: CaptainCandidate, second: CaptainCandidate): CaptainShortlist["secondNote"] {
  if (
    pick.ownedPct != null && second.ownedPct != null && pick.ownedPct - second.ownedPct >= MIN_OWNERSHIP_GAP &&
    pick.ceiling != null && second.ceiling != null && second.ceiling > pick.ceiling
  ) {
    return {
      kind: "differential",
      text: `${second.webName} is the differential: ${pct(second.ownedPct)} owned vs ${pct(pick.ownedPct)}, ceiling ${f1(second.ceiling)} vs ${f1(pick.ceiling)}.`,
    };
  }
  if (pick.floor != null && second.floor != null && second.floor - pick.floor >= MIN_FLOOR_GAP) {
    return {
      kind: "safe",
      text: `${second.webName} is the safer pick: floor ${f1(second.floor)} vs ${f1(pick.floor)}${pick.xp > second.xp ? `, for ${f1(pick.xp - second.xp)} fewer expected points` : ""}.`,
    };
  }
  return null;
}

export function buildCaptainShortlist(
  forecast: Pick<Forecast, "squad" | "upcoming" | "pool" | "captainEdge" | "viceCaptain">,
  swaps: Map<number, PoolPlayer>,
  appliedOut: Set<number>,
  size = 3,
  /** the XI and armband to use (slot ids), from lineupFor; defaults to the model's own */
  lineup?: { xi: number[]; captain: number | null; armbandAdjusted?: boolean } | null,
): CaptainShortlist | null {
  const target = forecast.upcoming[0];
  if (!target) return null;
  const byId = new Map(forecast.squad.players.map((p) => [p.id, p]));
  const poolById = new Map((forecast.pool ?? []).map((p) => [p.id, p]));
  const shown = (id: number | null | undefined) => (id == null ? null : (swaps.get(id)?.id ?? id));

  // the armband, the way the Squad pitch places it: a captain sold in FPL passes it to the vice, if he is still there
  const captainSold = target.captainId != null && appliedOut.has(target.captainId);
  const viceSold = target.viceCaptainId != null && appliedOut.has(target.viceCaptainId);
  const pickId = lineup
    ? shown(lineup.captain)
    : captainSold ? (viceSold ? null : shown(target.viceCaptainId)) : shown(target.captainId);
  const xiSlots = lineup?.xi ?? target.startingXi;

  const all: CaptainCandidate[] = [];
  for (const slot of xiSlots) {
    const swap = swaps.get(slot);
    const base = byId.get(slot);
    if (!base) continue;
    const id = swap?.id ?? slot;
    const xp = swap ? swap.perGameweek[0] : target.players.find((p) => p.id === slot)?.projectedPoints;
    if (xp == null) continue;
    // the model never gives the armband to a player projected from a prior alone
    if (!swap && (target.players.find((p) => p.id === slot)?.provisional || base.provisional)) continue;
    const pool = poolById.get(id);
    const legs = swap ? swap.opponents[0] : target.players.find((p) => p.id === slot)?.opponents;
    all.push({
      id,
      webName: swap?.webName ?? base.webName,
      team: swap?.team ?? base.team,
      xp,
      // a transferred-in player has no band in the squad list
      floor: swap ? null : (base.floorCeiling?.floor ?? null),
      ceiling: swap ? null : (base.floorCeiling?.ceiling ?? null),
      ownedPct: pool?.selectedByPercent ?? swap?.selectedByPercent ?? null,
      form: pool?.form ?? swap?.form ?? null,
      isDouble: (legs?.length ?? 0) > 1,
      // only the model's own player carries the label, not someone a saved transfer put in his place
      isModelPick: id === pickId && !swap && !lineup?.armbandAdjusted,
    });
  }
  all.sort((a, b) => b.xp - a.xp);
  let top = all.slice(0, size);
  const pick = all.find((c) => c.isModelPick);
  // the model's pick always appears, even if a tie or a transfer left it just outside the top three
  if (pick && !top.includes(pick)) top = [...top.slice(0, size - 1), pick];
  if (top.length === 0) return null;
  // model's pick first, then by xP
  top.sort((a, b) => Number(b.isModelPick) - Number(a.isModelPick) || b.xp - a.xp);

  const secondNote = top.length >= 2 && top[0].isModelPick ? secondPickNote(top[0], top[1]) : null;
  const edge =
    forecast.captainEdge && forecast.viceCaptain && !lineup?.armbandAdjusted && !captainSold && !viceSold &&
    !swaps.has(target.captainId ?? -1) && !swaps.has(target.viceCaptainId ?? -1) &&
    xiSlots.includes(forecast.viceCaptain.id)
      ? { label: forecast.captainEdge.label, points: forecast.captainEdge.points, viceName: forecast.viceCaptain.webName }
      : null;
  return { gameweek: target.gameweek, candidates: top, secondNote, edge };
}
