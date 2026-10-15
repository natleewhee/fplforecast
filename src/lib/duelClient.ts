import type { LeagueSquadResponse } from "@/app/api/league/squad/route";

/* Shared by the Leagues tab's duel and the Live tab's one-line shortcut: how
 * to load a squad, and which mate you last picked a duel with. */

export type Rival = { myEntryId: number; entryId: number; name: string };

const RIVAL_KEY = "gaffer-duel-rival";

export function readRival(): Rival | null {
  try {
    const raw = JSON.parse(localStorage.getItem(RIVAL_KEY) ?? "null");
    if (
      raw &&
      Number.isInteger(raw.myEntryId) &&
      Number.isInteger(raw.entryId) &&
      typeof raw.name === "string" &&
      raw.entryId !== raw.myEntryId
    ) {
      return raw as Rival;
    }
  } catch {
    // unreadable: treat as no rival
  }
  return null;
}

export function saveRival(rival: Rival): void {
  try {
    localStorage.setItem(RIVAL_KEY, JSON.stringify(rival));
  } catch {
    // not remembering just means picking again next time
  }
}

export function clearRival(): void {
  try {
    localStorage.removeItem(RIVAL_KEY);
  } catch {
    // ignore
  }
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
