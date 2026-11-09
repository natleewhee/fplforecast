/* How a player looks in 3D: height, hair and skin tone, with where each value
 * came from. Pure functions only (no file reads), so the 3D layer, the review
 * page and the tests all share one set of rules.
 *
 * Three sources, strongest first:
 *   1. overrides.json  hand-checked by the owner: always wins ("verified")
 *   2. players.json    looked up or measured by a script ("auto")
 *   3. neutral default for anyone with neither ("default")
 */

export const HAIR_STYLES = ["bald", "buzz", "crop", "sidepart", "curlytop", "curly", "bun", "waves"] as const;
export type HairStyle = (typeof HAIR_STYLES)[number];
export type Position = "GKP" | "DEF" | "MID" | "FWD";
export type TraitState = "verified" | "auto" | "default";

/** Six skin steps, lightest to deepest. A figure's skin is an index into this. */
export const SKIN_STEPS = ["#f3d5bb", "#ebc29c", "#d9a577", "#b9824f", "#8a5a3a", "#5e3d28"] as const;

/** Typical Premier League heights by position, used until a real one is found. */
export const TYPICAL_CM: Record<Position, number> = { GKP: 190, DEF: 184, MID: 178, FWD: 181 };

/** The middle skin step and a plain dark-brown crop: unremarkable on purpose, so a
 * missing player is obviously "not filled in yet" rather than looking random. */
export const NEUTRAL = {
  skin: 2,
  hair: { style: "crop" as HairStyle, color: "#3a2a1e" },
};

export const MIN_CM = 150;
export const MAX_CM = 215;

export type Hair = { style: HairStyle; color: string };
/** What players.json and overrides.json hold for one player (every field optional). */
export type AppearanceRecord = { cm?: number; skin?: number; hair?: Hair };

export type Resolved = {
  cm: { value: number; state: TraitState };
  skin: { value: number; state: TraitState };
  hair: { value: Hair; state: TraitState };
};

const HEX = /^#[0-9a-fA-F]{6}$/;

export function validCm(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= MIN_CM && v <= MAX_CM;
}
export function validSkin(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v < SKIN_STEPS.length;
}
export function validHair(v: unknown): v is Hair {
  if (!v || typeof v !== "object") return false;
  const h = v as Partial<Hair>;
  return typeof h.style === "string" && (HAIR_STYLES as readonly string[]).includes(h.style) && typeof h.color === "string" && HEX.test(h.color);
}

/** Pick each trait from the strongest source that has a valid value for it. */
export function resolveAppearance(position: Position, auto?: AppearanceRecord, override?: AppearanceRecord): Resolved {
  function pick<T>(
    ok: (v: unknown) => v is T,
    key: keyof AppearanceRecord,
    fallback: T,
  ): { value: T; state: TraitState } {
    const o = override?.[key];
    if (ok(o)) return { value: o, state: "verified" };
    const a = auto?.[key];
    if (ok(a)) return { value: a, state: "auto" };
    return { value: fallback, state: "default" };
  }
  return {
    cm: pick(validCm, "cm", TYPICAL_CM[position]),
    skin: pick(validSkin, "skin", NEUTRAL.skin),
    hair: pick(validHair, "hair", NEUTRAL.hair),
  };
}

/** How many of the three traits still need the owner's eye (0 = fully verified). */
export function unverified(r: Resolved): number {
  return [r.cm, r.skin, r.hair].filter((t) => t.state !== "verified").length;
}

/** Sort key for the review page: guesses before measurements, measurements before checked. */
export function reviewRank(r: Resolved): number {
  const defaults = [r.cm, r.skin, r.hair].filter((t) => t.state === "default").length;
  return defaults * 10 + unverified(r);
}

export type Kit = { shirt: string; shorts: string; socks: string };
export type ClubKits = Kit & { gk: Kit };
export type KitTable = { season: string; approximate: boolean; note: string; clubs: Record<string, ClubKits> };

/** The kit a player wears: his club's goalkeeper kit if he is a keeper, else the home kit. */
export function kitFor(table: KitTable, club: string, position: Position): Kit | null {
  const c = table.clubs[club];
  if (!c) return null;
  return position === "GKP" ? c.gk : { shirt: c.shirt, shorts: c.shorts, socks: c.socks };
}
