import type { LeagueSquadResponse } from "@/app/api/league/squad/route";
import { readJson, removeItem, writeJson } from "./storage.ts";

/* Shared by the Leagues tab's duel and the Live tab's one-line shortcut: how
 * to load a squad, and which mate you last picked a duel with. */

export type Rival = { myEntryId: number; entryId: number; name: string };

const RIVAL_KEY = "gaffer-duel-rival";

export function readRival(): Rival | null {
  const raw = readJson<Partial<Rival> | null>(RIVAL_KEY, null);
  if (
    raw &&
    Number.isInteger(raw.myEntryId) &&
    Number.isInteger(raw.entryId) &&
    typeof raw.name === "string" &&
    raw.entryId !== raw.myEntryId
  ) {
    return raw as Rival;
  }
  return null;
}

export function saveRival(rival: Rival): void {
  writeJson(RIVAL_KEY, rival);
}

export function clearRival(): void {
  removeItem(RIVAL_KEY);
}

export async function loadSquad(entryId: number, teamId?: string | null): Promise<LeagueSquadResponse> {
  const qs = teamId ? `&teamId=${teamId}` : "";
  const res = await fetch(`/api/league/squad?entryId=${entryId}${qs}`, { cache: "no-store" });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json as LeagueSquadResponse;
}

/** Ask the tab bar to switch tabs (it listens for this on `window`). */
export function goToTab(id: string): void {
  window.dispatchEvent(new CustomEvent("gaffer:goto-tab", { detail: id }));
}
