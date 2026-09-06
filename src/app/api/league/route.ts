import { NextResponse } from "next/server";
import { loadLatestForecast } from "@/lib/snapshots";
import {
  buildLivePayload,
  buildTracker,
  liveGameweek,
  poolLiveInputs,
  type FplBootstrap,
  type FplFixture,
  type FplLive,
  type FplPicks,
} from "@/lib/liveBlend";

const FPL = "https://fantasy.premierleague.com/api";
const TEAM_ID = process.env.FPL_TEAM_ID || "1168513";

// Same cadence as /api/live -- a mini-league's standings/picks don't change
// faster than that, and this fans out to one request per entry per league
// on top, across every private league.
const REVALIDATE = 40;

async function fpl<T>(path: string): Promise<T> {
  const res = await fetch(`${FPL}${path}`, {
    next: { revalidate: REVALIDATE },
    headers: { "User-Agent": "fplforecast-live/1.0" },
  });
  if (!res.ok) throw new Error(`FPL ${path} -> ${res.status}`);
  return (await res.json()) as T;
}

type FplStandingsEntry = {
  entry: number;
  entry_name: string;
  player_name: string;
  rank: number;
  last_rank: number;
  total: number;
  event_total: number;
};

type FplStandings = {
  league: { id: number; name: string };
  standings: { results: FplStandingsEntry[]; has_next: boolean };
};

type FplClassicLeagueRef = {
  id: number;
  name: string;
  // "x" = a classic league someone created (a private mini-league); "s" =
  // an FPL system league (Overall, a country, etc) with millions of
  // entries -- not something a per-entry-picks standings table works for.
  // NOT verified against a live FPL response from this environment; if
  // this filter is wrong (e.g. the field name/values differ), tell me what
  // `/entry/<id>/` actually returns and I'll fix it.
  league_type: string;
};

type FplEntry = {
  leagues: { classic: FplClassicLeagueRef[] };
};

export type LeagueEntryRow = {
  entryId: number;
  entryName: string;
  playerName: string;
  rank: number;
  lastRank: number;
  totalPoints: number;
  eventPoints: number; // FPL's own actual score so far this gameweek
  projectedXp: number | null; // this app's live-tracker-style projection, null if their picks couldn't be fetched
};

export type LeaguePayload = {
  leagueId: number;
  leagueName: string;
  entries: LeagueEntryRow[];
};

export type LeaguesResponse = {
  gameweek: number;
  generatedAt: string;
  leagues: LeaguePayload[];
};

async function fetchLeague(
  leagueRef: FplClassicLeagueRef,
  args: {
    bootstrap: FplBootstrap;
    live: FplLive;
    fixtures: FplFixture[];
    inputs: ReturnType<typeof poolLiveInputs>;
    gameweek: number;
    now: string;
  },
): Promise<LeaguePayload | null> {
  const { bootstrap, live, fixtures, inputs, gameweek, now } = args;
  let standings: FplStandings;
  try {
    standings = await fpl<FplStandings>(`/leagues-classic/${leagueRef.id}/standings/`);
  } catch {
    return null; // one league failing shouldn't sink the others
  }

  const entries = await Promise.all(
    standings.standings.results.map(async (row): Promise<LeagueEntryRow> => {
      let projectedXp: number | null = null;
      try {
        const picks = await fpl<FplPicks>(`/entry/${row.entry}/event/${gameweek}/picks/`);
        const payload = buildLivePayload({ bootstrap, live, fixtures, picks, inputs, gameweek, now });
        // Autosubs are computed the same way as your own tracker, but a
        // league entry's bench-boost/wildcard/free-hit chip use this
        // gameweek (if any) isn't visible from the picks endpoint alone,
        // so this can read slightly off for an entry playing a chip.
        projectedXp = buildTracker(payload, null).projectedTotal;
      } catch {
        projectedXp = null; // one entry's picks failing shouldn't sink the table
      }
      return {
        entryId: row.entry,
        entryName: row.entry_name,
        playerName: row.player_name,
        rank: row.rank,
        lastRank: row.last_rank,
        totalPoints: row.total,
        eventPoints: row.event_total,
        projectedXp,
      };
    }),
  );

  entries.sort((a, b) => a.rank - b.rank);

  return {
    leagueId: standings.league.id,
    leagueName: standings.league.name,
    entries,
  };
}

export async function GET() {
  try {
    const forecast = loadLatestForecast();
    if (!forecast) {
      return NextResponse.json(
        { error: "no committed forecast snapshot on disk" },
        { status: 503 },
      );
    }

    const bootstrap = await fpl<FplBootstrap>("/bootstrap-static/");
    const gameweek = liveGameweek(bootstrap);

    const [live, fixtures, entry] = await Promise.all([
      fpl<FplLive>(`/event/${gameweek}/live/`),
      fpl<FplFixture[]>(`/fixtures/?event=${gameweek}`),
      fpl<FplEntry>(`/entry/${TEAM_ID}/`),
    ]);

    const privateLeagues = (entry.leagues.classic || []).filter((l) => l.league_type === "x");

    const inputs = poolLiveInputs(forecast);
    const now = new Date().toISOString();

    const leagues = (
      await Promise.all(
        privateLeagues.map((l) => fetchLeague(l, { bootstrap, live, fixtures, inputs, gameweek, now })),
      )
    ).filter((l): l is LeaguePayload => l != null);

    const payload: LeaguesResponse = { gameweek, generatedAt: now, leagues };
    return NextResponse.json(payload);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
