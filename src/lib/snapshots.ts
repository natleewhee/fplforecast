import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");

const POSITIONS: Record<number, string> = {
  1: "GKP",
  2: "DEF",
  3: "MID",
  4: "FWD",
};

export type Player = {
  id: number;
  webName: string;
  team: string;
  position: string;
  priceMillions: number;
  epNext: number;
  status: string;
  chanceOfPlayingNextRound: number | null;
};

export type BootstrapSnapshot = {
  date: string;
  players: Player[];
};

function latestFile(endpointDir: string): { date: string; filePath: string } | null {
  const dir = path.join(DATA_DIR, endpointDir);
  if (!fs.existsSync(dir)) return null;
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort();
  if (files.length === 0) return null;
  const latest = files[files.length - 1];
  return { date: latest.replace(".json", ""), filePath: path.join(dir, latest) };
}

export function latestSnapshotDate(endpointDir: string): string | null {
  return latestFile(endpointDir)?.date ?? null;
}

export function loadBootstrapSnapshot(): BootstrapSnapshot | null {
  const found = latestFile("bootstrap-static");
  if (!found) return null;

  const raw = JSON.parse(fs.readFileSync(found.filePath, "utf-8"));
  const teamsById = new Map<number, string>(
    raw.teams.map((t: { id: number; short_name: string }) => [t.id, t.short_name])
  );

  const players: Player[] = raw.elements.map((el: Record<string, unknown>) => ({
    id: el.id as number,
    webName: el.web_name as string,
    team: teamsById.get(el.team as number) ?? "???",
    position: POSITIONS[el.element_type as number] ?? "???",
    priceMillions: (el.now_cost as number) / 10,
    epNext: parseFloat((el.ep_next as string) ?? "0"),
    status: el.status as string,
    chanceOfPlayingNextRound: (el.chance_of_playing_next_round as number | null) ?? null,
  }));

  return { date: found.date, players };
}
