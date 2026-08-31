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
  lambdaFor?: number; // expected goals the player's team scores
  lambdaAgainst?: number; // expected goals conceded
  cleanSheetProb?: number; // exp(-lambdaAgainst)
  attackAdjust?: number; // scaling applied to the player's own xG/xA rate
};

export type ProjectionComponents = {
  appearance: number;
  goals: number;
  assists: number;
  cleanSheet: number;
  goalsConceded: number;
  saves: number;
  defensiveContribution: number;
  bonus: number;
  cards: number;
};

export type ProjectionBreakdown = {
  points: number | null;
  provisional?: boolean; // no PL history -> projected from a prior
  rateSource?: string; // "history" | "price" | "understat:<league>"
  components?: ProjectionComponents;
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
  price?: number; // £m
  projectedPoints: number | null;
  windowPoints?: number | null;
  provisional?: boolean;
  rateSource?: string;
  opponents: OpponentLeg[];
  breakdown: ProjectionBreakdown;
  gapPoints?: number | null; // present when this card is an alternative
  affordable?: boolean | null; // fits bank + sale of the held player
};

export type Upgrade = {
  alternative: AlternativeCard;
  gapPoints: number; // 5-GW window-points gain
  meaningful: boolean; // gain clears the (season-scaled) bar
  affordable?: boolean | null;
};

export type ForecastPlayer = AlternativeCard & {
  minutesRisk?: boolean;
  isCaptain: boolean;
  isViceCaptain?: boolean;
  role?: "start" | "bench";
  sellPrice?: number; // £m (assumes bought at today's price)
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
    bank: number; // £m
    bankNote?: string;
  };
  upgradeCount: { model: number; baseline: number; agree: number; meaningful: number };
  effectiveGap: number; // 5-GW gain a swap must clear to be recommended this week
  earlySeason: boolean; // effectiveGap raised because the season is young
  nextGw: {
    points: number; // recommended XI's projected total for the upcoming GW, captain doubled
    deltaVsNoChange: number; // vs keeping last week's XI + captain
    deltaVsBaselineXi: number; // vs the composite baseline's XI pick
  };
  captain: { webName: string; id: number; points?: number } | null;
  viceCaptain: { webName: string; id: number; points?: number } | null;
  captainEdge: { points: number; label: string } | null; // captain vs vice, single GW
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
