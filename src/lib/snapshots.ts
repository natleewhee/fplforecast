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

export type OpponentLeg = {
  team: string | null;
  wasHome: boolean;
  fdrRating: number | null; // FPL's 1 (easiest) .. 5 (hardest) rating
  fdrMultiplier: number;
  strengthMultiplier: number; // opponent attack/defence adjustment, ~1.0
};

export type ProjectionBreakdown = {
  points: number | null;
  coldStart: boolean;
  base?: number;
  fixtureMultiplier?: number;
  minutesMultiplier?: number;
  availabilityMultiplier?: number;
  expectedMinutes?: number | null;
  minutesRisk?: boolean;
  opponents: OpponentLeg[];
};

export type AlternativeCard = {
  id: number;
  webName: string;
  team: string;
  position: string;
  elementType?: number | null;
  projectedPoints: number | null;
  windowPoints?: number | null;
  coldStart: boolean;
  opponents: OpponentLeg[];
  breakdown: ProjectionBreakdown;
  gapPoints?: number; // present when this card is an alternative
};

export type Upgrade = {
  alternative: AlternativeCard;
  gapPoints: number; // 5-GW window-points gain
  meaningful: boolean; // gain >= MEANINGFUL_UPGRADE_GAP
};

export type ForecastPlayer = AlternativeCard & {
  minutesRisk?: boolean;
  isCaptain: boolean;
  role?: "start" | "bench";
  modelUpgrade: Upgrade | null;
  baselineUpgrade: Upgrade | null;
  alternatives: AlternativeCard[];
};

export type RunningRecord = {
  gameweeksScored: number;
  modelTotal: number;
  baselineTotal: number;
  pooledDeltaPerGw: number;
  meaningful: boolean;
};

export type Forecast = {
  generatedAt: string;
  basedOnGameweek: number;
  targetGameweek: number;
  rollingWindow: number;
  overridesApplied: number;
  squad: {
    windowPoints: number;
    players: ForecastPlayer[];
    startingXi: number[];
    bench: number[];
  };
  upgradeCount: { model: number; baseline: number; agree: number; meaningful: number };
  captain: { webName: string; id: number } | null;
  runningRecord: RunningRecord | null;
};

export type ChipUsage = { name: string; event: number };

export type ChipStatus = {
  name: string;
  used: ChipUsage[];
  remaining: number;
};

const TEAM_ID = "1168513";

// Standard 2025/26 allocation (2x wildcard, one per half; 1x each of the
// others). Not re-verified against 2026/27's live bootstrap-static — see
// the plan doc's open question on rules drifting season to season.
const ASSUMED_CHIP_ALLOCATION: Record<string, number> = {
  wildcard: 2,
  freehit: 1,
  bboost: 1,
  "3xc": 1,
  manager: 1,
};

export function loadChipStatus(): ChipStatus[] | null {
  const dir = path.join(DATA_DIR, `history-${TEAM_ID}`);
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  if (files.length === 0) return null;
  const raw = JSON.parse(fs.readFileSync(path.join(dir, files[files.length - 1]), "utf-8"));
  const chips: { name: string; event: number }[] = raw.chips ?? [];

  const usedByName = new Map<string, ChipUsage[]>();
  for (const c of chips) {
    const list = usedByName.get(c.name) ?? [];
    list.push({ name: c.name, event: c.event });
    usedByName.set(c.name, list);
  }

  const allNames = new Set([...Object.keys(ASSUMED_CHIP_ALLOCATION), ...usedByName.keys()]);
  return [...allNames].map((name) => {
    const used = usedByName.get(name) ?? [];
    const allocation = ASSUMED_CHIP_ALLOCATION[name] ?? 1;
    return { name, used, remaining: Math.max(0, allocation - used.length) };
  });
}

export type PendingTransfer = { out: number; in: number; note?: string };

export type OverridesFile = {
  basedOnGw: number;
  transfers: PendingTransfer[];
};

export function loadOverrides(): OverridesFile | null {
  const filePath = path.join(DATA_DIR, "overrides", "transfers.json");
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

export function loadLatestForecast(): Forecast | null {
  const dir = path.join(DATA_DIR, "forecast");
  if (!fs.existsSync(dir)) return null;
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^gw\d+\.json$/.test(f))
    .sort((a, b) => parseInt(a.slice(2)) - parseInt(b.slice(2)));
  if (files.length === 0) return null;
  const latest = files[files.length - 1];
  return JSON.parse(fs.readFileSync(path.join(dir, latest), "utf-8"));
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
