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
const LEAGUE_ID = process.env.FPL_LEAGUE_ID || "166633";

// Same cadence as /api/live -- a mini-league's standings/picks don't change
// faster than that, and this fans out to one request per entry on top.
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
  gameweek: number;
  generatedAt: string;
  entries: LeagueEntryRow[];
};

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

    const [live, fixtures, standings] = await Promise.all([
      fpl<FplLive>(`/event/${gameweek}/live/`),
      fpl<FplFixture[]>(`/fixtures/?event=${gameweek}`),
      fpl<FplStandings>(`/leagues-classic/${LEAGUE_ID}/standings/`),
    ]);

    const inputs = poolLiveInputs(forecast);
    const now = new Date().toISOString();

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

    const payload: LeaguePayload = {
      leagueId: standings.league.id,
      leagueName: standings.league.name,
      gameweek,
      generatedAt: now,
      entries,
    };
    return NextResponse.json(payload);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
