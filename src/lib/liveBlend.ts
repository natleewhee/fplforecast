/** Pure helpers for the live gameweek tracker (KTD1: the route stays thin,
 * the blend happens on the client). This module shapes the `/api/live`
 * payload from raw FPL responses plus the daily snapshot, and — for the
 * client — blends live actuals with decayed baked xP, applies autosubs, and
 * scores par. Kept free of Next / React so a later pass can unit-test it. */

import type { Forecast } from "@/lib/snapshots";

/* ---------- /api/live payload ---------- */

export type LiveElement = {
  points: number;
  minutes: number;
  fixtureStarted: boolean;
  fixtureFinished: boolean;
};

export type FixtureLite = {
  kickoffTime: string | null;
  started: boolean;
  finished: boolean;
};

export type LivePicks = {
  starters: number[];
  bench: number[]; // in autosub order
  captainId: number | null;
  viceCaptainId: number | null;
};

export type LivePayload = {
  gameweek: number;
  generatedAt: string;
  matchesLive: boolean;
  liveAverage: number;
  liveByElement: Record<number, LiveElement>;
  picks: LivePicks;
  fixtures: FixtureLite[];
  componentXpByElement: Record<string, Record<string, number>>;
  parMargin: number;
  marginProvisional: boolean;
  parBuffer: number;
  parBufferProvisional: number;
};

// Minimal shapes of the FPL responses this module reads.
type FplEvent = { id: number; is_current?: boolean; is_next?: boolean; finished?: boolean; average_entry_score?: number | null };
export type FplBootstrap = { events: FplEvent[]; elements: { id: number; team: number }[]; teams: { id: number }[] };
type FplLiveElement = { id: number; stats?: { total_points?: number; minutes?: number } };
export type FplLive = { elements: FplLiveElement[] };
export type FplFixture = {
  event: number | null;
  started?: boolean;
  finished?: boolean;
  finished_provisional?: boolean;
  kickoff_time?: string | null;
  team_h: number;
  team_a: number;
};
type FplPick = { element: number; position: number; multiplier: number; is_captain: boolean; is_vice_captain: boolean };
export type FplPicks = { picks: FplPick[] };

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

  const teamById = new Map(bootstrap.elements.map((el) => [el.id, el.team]));
  const gwFixtures = fixtures.filter((f) => f.event === gameweek);

  // fixture state per club
  const fixtureByTeam = new Map<number, FplFixture>();
  for (const f of gwFixtures) {
    fixtureByTeam.set(f.team_h, f);
    fixtureByTeam.set(f.team_a, f);
  }

  const liveByElement: Record<number, LiveElement> = {};
  for (const el of live.elements) {
    const f = fixtureByTeam.get(teamById.get(el.id) ?? -1);
    liveByElement[el.id] = {
      points: el.stats?.total_points ?? 0,
      minutes: el.stats?.minutes ?? 0,
      fixtureStarted: Boolean(f?.started),
      fixtureFinished: Boolean(f?.finished ?? f?.finished_provisional),
    };
  }

  const sorted = [...picks.picks].sort((a, b) => a.position - b.position);
  const starters = sorted.filter((p) => p.position <= 11).map((p) => p.element);
  const bench = sorted.filter((p) => p.position >= 12).map((p) => p.element);
  const captain = picks.picks.find((p) => p.is_captain);
  const vice = picks.picks.find((p) => p.is_vice_captain);

  const event = bootstrap.events.find((e) => e.id === gameweek);
  const matchesLive = gwFixtures.some((f) => f.started && !(f.finished ?? f.finished_provisional));

  return {
    gameweek,
    generatedAt: now,
    matchesLive,
    liveAverage: event?.average_entry_score ?? 0,
    liveByElement,
    picks: {
      starters,
      bench,
      captainId: captain?.element ?? null,
      viceCaptainId: vice?.element ?? null,
    },
    fixtures: gwFixtures.map((f) => ({
      kickoffTime: f.kickoff_time ?? null,
      started: Boolean(f.started),
      finished: Boolean(f.finished ?? f.finished_provisional),
    })),
    componentXpByElement: forecast.squadComponents ?? {},
    parMargin: forecast.parMargin ?? 0,
    marginProvisional: forecast.marginProvisional ?? true,
    parBuffer: forecast.parBuffer ?? 4,
    parBufferProvisional: forecast.parBufferProvisional ?? 8,
  };
}
