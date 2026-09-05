/** Pure helpers for the live gameweek tracker (KTD1: the route stays thin,
 * the blend happens on the client). This module shapes the `/api/live`
 * payload from raw FPL responses plus the daily snapshot, and — for the
 * client — blends live actuals with decayed baked xP, applies autosubs, and
 * scores par. Kept free of Next / React so a later pass can unit-test it. */

import type { Forecast } from "@/lib/snapshots";

/* ---------- /api/live payload ---------- */

export type BreakdownItem = { identifier: string; points: number; value: number };

export type LiveElement = {
  points: number;
  minutes: number;
  goalsConceded: number; // live goals against the player's team, for the CS carve-out (KTD6)
  fixtureStarted: boolean;
  fixtureFinished: boolean;
  breakdown: BreakdownItem[]; // FPL's own scoring categories, summed across legs (double GW)
};

export type FixtureLite = {
  kickoffTime: string | null;
  started: boolean;
  finished: boolean;
};

export type LivePicks = {
  starters: number[];
  bench: number[]; // in autosub order (bench GK first)
  captainId: number | null;
  viceCaptainId: number | null;
};

export type Position = "GKP" | "DEF" | "MID" | "FWD";

/** One of the manager's fifteen, as the tracker needs to name and place them.
 * Identity comes from bootstrap (authoritative for the live picks), not the
 * daily forecast squad, which can lag a transfer. */
export type LiveSquadPlayer = {
  id: number;
  webName: string;
  position: Position;
  elementType: number; // 1..4
  slot: number; // pick position 1..15
  isCaptain: boolean;
  isViceCaptain: boolean;
  opponent: string | null; // "CHE (H)" for this gameweek, null if no fixture
  hasComponents: boolean; // false when the snapshot has no baked xP for this pick
  kickoffTime: string | null; // this gameweek's own fixture kickoff, for a not-yet-started player
  fdrRating: number | null; // FPL's 1 (easiest) .. 5 (hardest) for this gameweek's opponent
};

export type LivePayload = {
  gameweek: number;
  generatedAt: string;
  matchesLive: boolean;
  dataChecked: boolean;
  liveAverage: number;
  liveByElement: Record<number, LiveElement>;
  picks: LivePicks;
  squad: LiveSquadPlayer[];
  fixtures: FixtureLite[];
  componentXpByElement: Record<string, Record<string, number>>;
  parMargin: number;
  marginProvisional: boolean;
  parBuffer: number;
  parBufferProvisional: number;
};

// Minimal shapes of the FPL responses this module reads.
type FplEvent = {
  id: number;
  is_current?: boolean;
  is_next?: boolean;
  finished?: boolean;
  data_checked?: boolean;
  average_entry_score?: number | null;
};
export type FplBootstrap = {
  events: FplEvent[];
  elements: { id: number; team: number; element_type: number; web_name: string }[];
  teams: { id: number; short_name: string }[];
};
type FplExplainStat = { identifier: string; points: number; value: number };
type FplLiveElement = {
  id: number;
  stats?: { total_points?: number; minutes?: number; goals_conceded?: number };
  // one entry per fixture (two for a double gameweek); FPL's own scoring
  // breakdown, already split into named categories with the points each
  // contributed -- the source for the tracker's score breakdown.
  explain?: { stats: FplExplainStat[] }[];
};
export type FplLive = { elements: FplLiveElement[] };
export type FplFixture = {
  event: number | null;
  started?: boolean;
  finished?: boolean;
  finished_provisional?: boolean;
  kickoff_time?: string | null;
  team_h: number;
  team_a: number;
  team_h_difficulty?: number | null;
  team_a_difficulty?: number | null;
};
type FplPick = { element: number; position: number; multiplier: number; is_captain: boolean; is_vice_captain: boolean };
export type FplPicks = { picks: FplPick[] };

const POSITION_BY_ELEMENT_TYPE: Record<number, Position> = { 1: "GKP", 2: "DEF", 3: "MID", 4: "FWD" };

/** FPL's `explain` array is one entry per fixture (two for a double
 * gameweek); sum points/value per scoring category across legs so a DGW
 * player's breakdown reads as one list, not two. */
function explainBreakdown(explain: { stats: FplExplainStat[] }[] | undefined): BreakdownItem[] {
  const byIdentifier = new Map<string, BreakdownItem>();
  for (const leg of explain ?? []) {
    for (const stat of leg.stats) {
      const existing = byIdentifier.get(stat.identifier);
      if (existing) {
        existing.points += stat.points;
        existing.value += stat.value;
      } else {
        byIdentifier.set(stat.identifier, { ...stat });
      }
    }
  }
  return [...byIdentifier.values()];
}

/** The gameweek the live view tracks: the current event, else the next. */
export function liveGameweek(bootstrap: FplBootstrap): number {
  const current = bootstrap.events.find((e) => e.is_current);
  if (current) return current.id;
  const next = bootstrap.events.find((e) => e.is_next);
  return next ? next.id : bootstrap.events[bootstrap.events.length - 1]?.id ?? 0;
}

export function buildLivePayload(args: {
  bootstrap: FplBootstrap;
  live: FplLive;
  fixtures: FplFixture[];
  picks: FplPicks;
  forecast: Forecast;
  gameweek: number;
  now: string;
}): LivePayload {
  const { bootstrap, live, fixtures, picks, forecast, gameweek, now } = args;

  const elementById = new Map(bootstrap.elements.map((el) => [el.id, el]));
  const teamName = new Map(bootstrap.teams.map((t) => [t.id, t.short_name]));
  const gwFixtures = fixtures.filter((f) => f.event === gameweek);

  // fixture state per club
  const fixtureByTeam = new Map<number, FplFixture>();
  for (const f of gwFixtures) {
    fixtureByTeam.set(f.team_h, f);
    fixtureByTeam.set(f.team_a, f);
  }

  const liveByElement: Record<number, LiveElement> = {};
  for (const el of live.elements) {
    const teamId = elementById.get(el.id)?.team ?? -1;
    const f = fixtureByTeam.get(teamId);
    liveByElement[el.id] = {
      points: el.stats?.total_points ?? 0,
      minutes: el.stats?.minutes ?? 0,
      goalsConceded: el.stats?.goals_conceded ?? 0,
      fixtureStarted: Boolean(f?.started),
      fixtureFinished: Boolean(f?.finished ?? f?.finished_provisional),
      breakdown: explainBreakdown(el.explain),
    };
  }

  const sorted = [...picks.picks].sort((a, b) => a.position - b.position);
  const starters = sorted.filter((p) => p.position <= 11).map((p) => p.element);
  const bench = sorted.filter((p) => p.position >= 12).map((p) => p.element);
  const captain = picks.picks.find((p) => p.is_captain);
  const vice = picks.picks.find((p) => p.is_vice_captain);
  const components = forecast.squadComponents ?? {};

  const squad: LiveSquadPlayer[] = sorted.map((p) => {
    const meta = elementById.get(p.element);
    const teamId = meta?.team ?? -1;
    const f = fixtureByTeam.get(teamId);
    let opponent: string | null = null;
    let fdrRating: number | null = null;
    if (f) {
      const home = f.team_h === teamId;
      const oppId = home ? f.team_a : f.team_h;
      opponent = `${teamName.get(oppId) ?? "???"} (${home ? "H" : "A"})`;
      // Read the difficulty off this same gameweek's fixture rather than the
      // latest forecast snapshot -- that snapshot can already be looking
      // ahead to next gameweek once it's been regenerated mid-gameweek,
      // which mismatched this FDR against the (correct) opponent above.
      fdrRating = (home ? f.team_h_difficulty : f.team_a_difficulty) ?? null;
    }
    return {
      id: p.element,
      webName: meta?.web_name ?? `#${p.element}`,
      position: POSITION_BY_ELEMENT_TYPE[meta?.element_type ?? 0] ?? "MID",
      elementType: meta?.element_type ?? 0,
      slot: p.position,
      isCaptain: p.is_captain,
      isViceCaptain: p.is_vice_captain,
      opponent,
      hasComponents: Boolean(components[String(p.element)]),
      kickoffTime: f?.kickoff_time ?? null,
      fdrRating,
    };
  });

  const event = bootstrap.events.find((e) => e.id === gameweek);
  const matchesLive = gwFixtures.some((f) => f.started && !(f.finished ?? f.finished_provisional));

  return {
    gameweek,
    generatedAt: now,
    matchesLive,
    dataChecked: Boolean(event?.data_checked),
    liveAverage: event?.average_entry_score ?? 0,
    liveByElement,
    picks: {
      starters,
      bench,
      captainId: captain?.element ?? null,
      viceCaptainId: vice?.element ?? null,
    },
    squad,
    fixtures: gwFixtures.map((f) => ({
      kickoffTime: f.kickoff_time ?? null,
      started: Boolean(f.started),
      finished: Boolean(f.finished ?? f.finished_provisional),
    })),
    componentXpByElement: components,
    parMargin: forecast.parMargin ?? 0,
    marginProvisional: forecast.marginProvisional ?? true,
    parBuffer: forecast.parBuffer ?? 4,
    parBufferProvisional: forecast.parBufferProvisional ?? 8,
  };
}

/* ---------- client blend (KTD6) ---------- */

export type PlayerStatus = "notStarted" | "playing" | "offPitch" | "finished" | "didNotPlay";

export type PlayerProjection = {
  pointsSoFar: number;
  remainingXp: number;
  contribution: number;
};

export type TrackerRow = {
  id: number;
  webName: string;
  position: Position;
  opponent: string | null;
  status: PlayerStatus;
  minutes: number;
  pointsSoFar: number;
  remainingXp: number;
  contribution: number;
  isBench: boolean;
  isArmband: boolean;
  subbedIn: boolean;
  subbedOut: boolean;
  noBakedXp: boolean;
  breakdown: BreakdownItem[];
  kickoffTime: string | null;
  fdrRating: number | null;
};

export type TrackerView = {
  projectedTotal: number;
  par: number;
  buffer: number;
  band: "green" | "amber" | "red";
  gapToPar: number;
  lowConfidence: boolean;
  anyMatchStarted: boolean;
  armbandId: number | null;
  rows: TrackerRow[];
};

const MATCH_MINUTES = 90;
const OFF_PITCH_MIN_POLL_GAP_MS = 90_000;
const MATCH_WINDOW_TAIL_MS = 150 * 60_000;

/** Still-to-play fraction of a 90-minute match (KTD6). Stoppage time clamps to 0. */
export function decayFactor(minute: number): number {
  return Math.max(0, (MATCH_MINUTES - minute) / MATCH_MINUTES);
}

/** Sum of a baked component map, with the clean-sheet leg optionally zeroed
 * (goals already conceded) and every leg scaled by `decay`. */
export function remainingXp(
  components: Record<string, number>,
  decay: number,
  cleanSheetKilled: boolean,
): number {
  let sum = 0;
  for (const [key, value] of Object.entries(components)) {
    if (key === "cleanSheet") sum += cleanSheetKilled ? 0 : value * decay;
    else sum += value * decay;
  }
  return sum;
}

/** Classify a starter/bench player from the live element and the previous poll.
 * Off-pitch is inferred from a frozen minute count across a poll gap — FPL's
 * live feed has no "was subbed off" flag. The half-time plateau (44–46') is
 * excluded so a stopped clock at the break does not read as a substitution. */
export function playerStatus(
  el: LiveElement | undefined,
  prevEl: LiveElement | undefined,
  nowIso: string,
  prevIso: string | undefined,
): PlayerStatus {
  if (!el || !el.fixtureStarted) return "notStarted";
  if (el.fixtureFinished) return el.minutes > 0 ? "finished" : "didNotPlay";
  if (el.minutes === 0) return "playing";
  // FPL's `finished`/`finished_provisional` flags can lag the final whistle by
  // a poll or two while stats are checked. Minutes cannot legitimately sit at
  // or past 90' for two separate polls without the match being over -- unlike
  // the mid-game plateau below, this needs no minimum poll gap, since the
  // routine ~60s tick cadence would otherwise never clear the (higher) gap
  // threshold used to rule out a false off-pitch read.
  if (prevEl && prevEl.minutes === el.minutes && el.minutes >= MATCH_MINUTES) return "finished";
  if (
    prevEl &&
    prevIso &&
    prevEl.minutes === el.minutes &&
    el.minutes < MATCH_MINUTES &&
    !(el.minutes >= 44 && el.minutes <= 46) &&
    Date.parse(nowIso) - Date.parse(prevIso) >= OFF_PITCH_MIN_POLL_GAP_MS
  ) {
    return "offPitch";
  }
  return "playing";
}

export function playerProjection(
  el: LiveElement | undefined,
  components: Record<string, number>,
  status: PlayerStatus,
): PlayerProjection {
  switch (status) {
    case "notStarted": {
      const remaining = remainingXp(components, 1, false);
      return { pointsSoFar: 0, remainingXp: remaining, contribution: remaining };
    }
    case "playing": {
      const pointsSoFar = el?.points ?? 0;
      const remaining = remainingXp(
        components,
        decayFactor(el?.minutes ?? 0),
        (el?.goalsConceded ?? 0) > 0,
      );
      return { pointsSoFar, remainingXp: remaining, contribution: pointsSoFar + remaining };
    }
    case "offPitch":
    case "finished": {
      const pointsSoFar = el?.points ?? 0;
      return { pointsSoFar, remainingXp: 0, contribution: pointsSoFar };
    }
    case "didNotPlay":
      return { pointsSoFar: 0, remainingXp: 0, contribution: 0 };
  }
}

/** FPL starting-XI shapes: one keeper, 3–5 at the back, 2–5 in midfield,
 * 1–3 up top, eleven in all. */
export function isValidFormation(positions: Position[]): boolean {
  if (positions.length !== 11) return false;
  const c: Record<Position, number> = { GKP: 0, DEF: 0, MID: 0, FWD: 0 };
  for (const p of positions) c[p] += 1;
  return (
    c.GKP === 1 &&
    c.DEF >= 3 &&
    c.DEF <= 5 &&
    c.MID >= 2 &&
    c.MID <= 5 &&
    c.FWD >= 1 &&
    c.FWD <= 3
  );
}

/** FPL autosub rule: each starter that finished on zero minutes is replaced by
 * the first bench player (in bench order) who actually featured and whose entry
 * keeps the formation legal. The bench keeper only ever covers the starting
 * keeper. */
export function autosubs(
  starters: number[],
  bench: number[],
  statusById: Record<number, PlayerStatus>,
  positionById: Record<number, Position>,
): { lineup: number[]; subbedIn: Set<number>; subbedOut: Set<number> } {
  const lineup = [...starters];
  const usedBench = new Set<number>();
  const subbedIn = new Set<number>();
  const subbedOut = new Set<number>();

  for (let i = 0; i < lineup.length; i += 1) {
    const outId = lineup[i];
    if (statusById[outId] !== "didNotPlay") continue;
    const outIsGk = positionById[outId] === "GKP";

    for (const benchId of bench) {
      if (usedBench.has(benchId)) continue;
      if (statusById[benchId] === "didNotPlay") continue;
      const inIsGk = positionById[benchId] === "GKP";
      if (outIsGk !== inIsGk) continue;

      const trial = lineup.map((id, j) => (j === i ? benchId : id));
      if (!isValidFormation(trial.map((id) => positionById[id]))) continue;

      lineup[i] = benchId;
      usedBench.add(benchId);
      subbedIn.add(benchId);
      subbedOut.add(outId);
      break;
    }
  }
  return { lineup, subbedIn, subbedOut };
}

/** Is at least one current-gameweek match inside its live window (kickoff to
 * kickoff + 150 min)? The client uses this to start polling at kickoff without
 * waiting for a fresh `matchesLive` from the route, and to stop afterwards. */
export function withinMatchWindow(fixtures: FixtureLite[], nowMs: number): boolean {
  return fixtures.some((f) => {
    if (!f.kickoffTime) return false;
    const ko = Date.parse(f.kickoffTime);
    return Number.isFinite(ko) && nowMs >= ko && nowMs <= ko + MATCH_WINDOW_TAIL_MS;
  });
}

export function buildTracker(payload: LivePayload, prev: LivePayload | null): TrackerView {
  const positionById: Record<number, Position> = {};
  const statusById: Record<number, PlayerStatus> = {};
  const projById: Record<number, PlayerProjection> = {};

  for (const sp of payload.squad) {
    positionById[sp.id] = sp.position;
    const el = payload.liveByElement[sp.id];
    const prevEl = prev?.liveByElement[sp.id];
    const status = playerStatus(el, prevEl, payload.generatedAt, prev?.generatedAt);
    statusById[sp.id] = status;
    projById[sp.id] = playerProjection(el, payload.componentXpByElement[String(sp.id)] ?? {}, status);
  }

  const { lineup, subbedIn, subbedOut } = autosubs(
    payload.picks.starters,
    payload.picks.bench,
    statusById,
    positionById,
  );
  const inLineup = new Set(lineup);
  const benchSet = new Set(payload.picks.bench);

  // The armband stays with the captain unless their own match is done and they
  // did not play, in which case it passes to the vice (FPL rule). Computed
  // before the total so the doubling below and each row's own numbers agree
  // on the same multiplier, rather than the total secretly double-counting
  // a captain whose row still shows their un-doubled points.
  const { captainId, viceCaptainId } = payload.picks;
  let armbandId: number | null = null;
  if (captainId != null && inLineup.has(captainId) && statusById[captainId] !== "didNotPlay") {
    armbandId = captainId;
  } else if (
    viceCaptainId != null &&
    inLineup.has(viceCaptainId) &&
    statusById[viceCaptainId] !== "didNotPlay"
  ) {
    armbandId = viceCaptainId;
  }

  let projectedTotal = 0;
  for (const id of lineup) {
    const contribution = projById[id]?.contribution ?? 0;
    projectedTotal += id === armbandId ? contribution * 2 : contribution;
  }

  const par = payload.liveAverage + payload.parMargin;
  const buffer = payload.marginProvisional ? payload.parBufferProvisional : payload.parBuffer;
  const anyMatchStarted = payload.fixtures.some((f) => f.started);
  const lowConfidence = payload.marginProvisional || !anyMatchStarted;
  const gapToPar = projectedTotal - par;

  let band: TrackerView["band"] = gapToPar < 0 ? "red" : gapToPar > buffer ? "green" : "amber";
  if (lowConfidence && band === "green") band = "amber"; // AE4: never assert green while thin

  const rows: TrackerRow[] = payload.squad.map((sp) => {
    const proj = projById[sp.id];
    const multiplier = sp.id === armbandId ? 2 : 1;
    return {
      id: sp.id,
      webName: sp.webName,
      position: sp.position,
      opponent: sp.opponent,
      status: statusById[sp.id],
      minutes: payload.liveByElement[sp.id]?.minutes ?? 0,
      pointsSoFar: proj.pointsSoFar * multiplier,
      remainingXp: proj.remainingXp * multiplier,
      contribution: proj.contribution * multiplier,
      isBench: benchSet.has(sp.id),
      isArmband: sp.id === armbandId,
      subbedIn: subbedIn.has(sp.id),
      subbedOut: subbedOut.has(sp.id),
      noBakedXp: !sp.hasComponents,
      breakdown: payload.liveByElement[sp.id]?.breakdown ?? [],
      kickoffTime: sp.kickoffTime,
      fdrRating: sp.fdrRating,
    };
  });

  return {
    projectedTotal,
    par,
    buffer,
    band,
    gapToPar,
    lowConfidence,
    anyMatchStarted,
    armbandId,
    rows,
  };
}
