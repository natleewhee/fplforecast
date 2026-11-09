import fs from "fs";
import path from "path";
import {
  resolveAppearance,
  type AppearanceRecord,
  type KitTable,
  type Position,
  type Resolved,
} from "./appearance";

/* Server-side file reads for the appearance data. Kept apart from appearance.ts
 * so the rules there stay pure and testable. */

const DATA_DIR = path.join(process.cwd(), "data");
const POSITIONS: Record<number, Position> = { 1: "GKP", 2: "DEF", 3: "MID", 4: "FWD" };

export type RosterPlayer = {
  code: number;
  name: string; // FPL's web_name
  fullName: string;
  team: string; // short name, e.g. "ARS"
  position: Position;
  birthDate: string | null;
  ownership: number; // % of managers who own him
};

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

/** Every player in the newest bootstrap snapshot. */
export function loadRoster(): RosterPlayer[] {
  const dir = path.join(DATA_DIR, "bootstrap-static");
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  if (!files.length) return [];
  const raw = readJson<{
    teams: { id: number; short_name: string }[];
    elements: {
      code: number;
      web_name: string;
      first_name: string;
      second_name: string;
      team: number;
      element_type: number;
      birth_date: string | null;
      selected_by_percent: string;
    }[];
  }>(path.join(dir, files[files.length - 1]), { teams: [], elements: [] });
  const teams = new Map(raw.teams.map((t) => [t.id, t.short_name]));
  return raw.elements.map((e) => ({
    code: e.code,
    name: e.web_name,
    fullName: `${e.first_name} ${e.second_name}`.trim(),
    team: teams.get(e.team) ?? "???",
    position: POSITIONS[e.element_type] ?? "MID",
    birthDate: e.birth_date ?? null,
    ownership: Number(e.selected_by_percent) || 0,
  }));
}

export function loadKitTable(): KitTable | null {
  return readJson<KitTable | null>(path.join(DATA_DIR, "kits.json"), null);
}

export type AppearanceRow = RosterPlayer & { look: Resolved };

/** The whole roster with each player's look resolved (override > auto > default). */
export function loadAppearanceRows(): AppearanceRow[] {
  const auto = readJson<{ players?: Record<string, AppearanceRecord> }>(
    path.join(DATA_DIR, "appearance", "players.json"),
    {},
  ).players ?? {};
  const overrides = readJson<{ players?: Record<string, AppearanceRecord> }>(
    path.join(DATA_DIR, "appearance", "overrides.json"),
    {},
  ).players ?? {};
  return loadRoster().map((p) => ({
    ...p,
    look: resolveAppearance(p.position, auto[String(p.code)], overrides[String(p.code)]),
  }));
}
