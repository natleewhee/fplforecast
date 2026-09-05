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

export type FloorCeiling = {
  floor: number;
  ceiling: number;
  bandProvisional: boolean; // too little realised history for this position -> band widened
};

// FPL's own doubt signal: status letter (a/d/i/s/u/n), the % chance it
// publishes of playing the next round for doubtful/returning players, and
// its news blurb. Distinct from breakdown.availabilityMultiplier, which
// already folds this into projected points -- this is for "is there an
// immediate risk this player doesn't play at all", independent of xP.
export type Availability = {
  status: "a" | "d" | "i" | "s" | "u" | "n";
  chance: number | null;
  news: string | null;
};

export type PlayerCard = {
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
  floorCeiling?: FloorCeiling | null;
  availability?: Availability;
};

export type ForecastPlayer = PlayerCard & {
  minutesRisk?: boolean;
  isCaptain: boolean;
  isViceCaptain?: boolean;
  role?: "start" | "bench";
  rationale?: string; // one-line "why" for this player's start/bench/armband
  sellPrice?: number; // £m (assumes bought at today's price)
};

export type RunningRecord = {
  gameweeksScored: number;
  modelTotal: number;
  baselineTotal: number;
  pooledDeltaPerGw: number;
  meaningful: boolean;
};

export type ParCalibration = {
  gameweeksScored: number;
  hitRate: number | null;
  hitRateByVerdict: { green: number | null; amber: number | null; red: number | null };
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
    baselineXi: number[]; // lineup the composite baseline would pick from the same 15
    baselineBench: number[];
    baselineCaptainId: number | null;
    yourXi: number[]; // last week's lineup, untouched
    yourBench: number[];
    yourCaptainId: number | null;
    bank: number; // £m
    bankNote?: string;
  };
  lineupAgreement: number; // starters the model XI and baseline XI share, of 11
  effectiveGap: number; // 5-GW gain a swap must clear to be recommended this week
  earlySeason: boolean; // effectiveGap raised because the season is young
  nextGw: {
    points: number; // recommended XI's projected total for the upcoming GW, captain doubled
    deltaVsNoChange: number; // vs keeping last week's XI + captain
    deltaVsBaselineXi: number; // vs the composite baseline's XI pick
  };
  xiFloorCeiling: FloorCeiling; // safety-score band for nextGw.points (Part A)
  captain: { webName: string; id: number; points?: number } | null;
  viceCaptain: { webName: string; id: number; points?: number } | null;
  captainEdge: { points: number; label: string } | null; // captain vs vice, single GW
  runningRecord: RunningRecord | null;
  parCalibration: ParCalibration | null;
  lastGameweek: GameweekReview | null;
  upcoming: UpcomingGameweek[]; // suggested XI for each GW in the rolling window
  history: SeasonHistory | null;
  pool: PoolPlayer[]; // whole available pool, 5-GW projections (optimiser input)
  scenarios: Scenarios;
  squadComponents: Record<string, Record<string, number>>; // held id -> target-GW component xP
  parMargin: number; // points above the GW average that hold the manager's rank
  marginProvisional: boolean; // too few completed GWs -> margin is 0, buffer widens
  parBuffer: number;
  parBufferProvisional: number;
};

export type PoolPlayer = {
  id: number;
  webName: string;
  team: string;
  elementType: number | null;
  position: string;
  price: number;
  sellPrice: number;
  selectedByPercent: number;
  form: number;
  perGameweek: number[]; // one xP value per gameweek in the window
  total: number;
  opponents: OpponentLeg[][]; // one leg group per gameweek in the window
  availability: Availability;
};

// A scenario's transfer-in/out player, as it should be shown in the UI.
export type ScenarioPlayerRef = {
  id: number;
  webName: string | null;
  position: string | null;
  team: string | null;
  availability: Availability | null;
  price: number | null;
};

// One gameweek's detail within a scenario's horizon: the XI that week, each
// player's opponent(s)/FDR and that week's xP, and the week's total (captain
// doubled).
export type ScenarioWeekPlayer = {
  id: number;
  webName: string | null;
  position: string | null;
  team: string | null;
  xp: number | null;
  opponents: OpponentLeg[];
  isCaptain: boolean;
};

export type ScenarioWeek = {
  targetGw: number;
  players: ScenarioWeekPlayer[];
  totalXp: number;
};

export type Scenario = {
  squad: number[];
  xiByGw: number[][];
  captainByGw: (number | null)[];
  horizonGws: number;
  points: number;
  hitCost: number;
  netPoints: number;
  transfersIn: ScenarioPlayerRef[];
  transfersOut: ScenarioPlayerRef[];
  weeks: ScenarioWeek[];
};

export type Scenarios = {
  freeTransfers: { value: number; derivation: string };
  chipsAvailable: { freeHit: boolean; wildcard: boolean };
  byHorizon: Record<string, Scenario[]>; // "1" | "3" | "5" -> top-3 by net points
  freeHit: Scenario | null;
  wildcard: Record<string, Scenario> | null; // "1" | "3" | "5" -> that horizon's rebuild
};

export type UpcomingPlayer = {
  id: number;
  projectedPoints: number | null;
  provisional: boolean;
  minutesRisk: boolean;
  opponents: OpponentLeg[];
};

export type UpcomingGameweek = {
  gameweek: number;
  points: number; // XI total, captain doubled
  startingXi: number[];
  bench: number[];
  captainId: number | null;
  viceCaptainId: number | null;
  players: UpcomingPlayer[];
};

export type GwModelVsBaseline = { model: number; baseline: number; delta: number };

export type HistoryGameweek = {
  gameweek: number | null;
  points: number | null;
  benchPoints: number | null;
  totalPoints: number | null;
  rank: number | null; // that gameweek's rank
  overallRank: number | null;
  transfers: number;
  hit: number; // points spent on transfers
  teamValue: number; // £m
  modelVsBaseline: GwModelVsBaseline | { status: string } | null;
};

export type HistorySeason = {
  season: string | null;
  totalPoints: number | null;
  rank: number | null;
};

export type SeasonHistory = {
  gameweeks: HistoryGameweek[];
  seasons: HistorySeason[];
};

export type GameweekCaptain = {
  webName: string;
  actual: number | null; // raw points before the multiplier
  multiplier: number;
};

export type GameweekReview = {
  gameweek: number;
  dataChecked: boolean; // false while bonus/stats are still provisional
  xiPoints: number | null; // your GW score, net of hits, captain doubled
  benchPoints: number | null;
  transfersCost: number;
  overallRank: number | null;
  captain: GameweekCaptain | null;
  viceCaptain: GameweekCaptain | null;
  modelVsBaseline:
    | { model: number; baseline: number; delta: number }
    | { status: string }
    | null;
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
