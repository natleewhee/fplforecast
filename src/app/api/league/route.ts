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
  leagues?: { classic?: FplClassicLeagueRef[] };
};

// FPL's own chip codes, mapped to the short badge text shown in the table.
const CHIP_LABEL: Record<string, string> = {
  wildcard: "WC",
  freehit: "FH",
  bboost: "BB",
  "3xc": "TC",
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
  chip: string | null; // short badge (WC/FH/BB/TC) if a chip is active this gameweek, else null
  captainName: string | null;
  playersPlayed: number | null; // starting-lineup players whose match has finished (or they were subbed off)
  playersLive: number | null; // starting-lineup players currently mid-match
  playersToPlay: number | null; // starting-lineup players who haven't kicked off yet
};

export type LeaguePayload = {
  leagueId: number;
  leagueName: string;
  entries: LeagueEntryRow[]; // top 10 plus your own entry if you're outside it
  myRank: number | null;
  myEntryId: number;
  // Set to your own entry id only when it was appended after the top 10 (i.e.
  // you're outside it) -- an explicit flag rather than inferring it from a
  // rank-number gap, since tied ranks (FPL gives equal `rank` to entries tied
  // on points) make consecutive array rows' ranks not always differ by 1.
  appendedEntryId: number | null;
  totalEntries: number; // count of entries actually paged through
  totalEntriesIsFloor: boolean; // true if the league is bigger than we paged through (totalEntries is a lower bound)
};

export type LeagueSummary = { leagueId: number; leagueName: string };

export type LeaguesResponse = {
  gameweek: number;
  generatedAt: string;
  leagues: LeagueSummary[]; // every private league, for the selector
  league: LeaguePayload | null; // the selected league's standings, null if the manager has none
};

// Cap how many standings pages we page through looking for "your" entry --
// a league with thousands of entries would otherwise mean thousands of
// sequential FPL requests just to find one rank. Past this cap, your rank
// (if not yet found) shows as unknown rather than blocking the page.
const MAX_STANDINGS_PAGES = 10;

async function fetchLeague(
  leagueRef: FplClassicLeagueRef,
  args: {
    bootstrap: FplBootstrap;
    live: FplLive;
    fixtures: FplFixture[];
    inputs: ReturnType<typeof poolLiveInputs>;
    gameweek: number;
    now: string;
    myEntryId: number;
  },
): Promise<LeaguePayload | null> {
  const { bootstrap, live, fixtures, inputs, gameweek, now, myEntryId } = args;

  let firstPage: FplStandings;
  try {
    firstPage = await fpl<FplStandings>(`/leagues-classic/${leagueRef.id}/standings/`);
  } catch {
    return null; // one league failing shouldn't sink the others
  }

  // Top 10 always come from the first page (already sorted by rank). Page
  // through the rest (lightly -- just the standings list, no picks) up to
  // the cap regardless of whether your entry has already turned up: stopping
  // early the moment it's found would make `allResults.length` reflect
  // "which page your rank happened to fall on" rather than a stable count,
  // e.g. showing a *smaller* total for a *better* rank.
  const allResults = [...firstPage.standings.results];
  let hasNext = firstPage.standings.has_next;
  let page = 1;
  while (hasNext && page < MAX_STANDINGS_PAGES) {
    page += 1;
    try {
      const next = await fpl<FplStandings>(
        `/leagues-classic/${leagueRef.id}/standings/?page_standings=${page}`,
      );
      allResults.push(...next.standings.results);
      hasNext = next.standings.has_next;
    } catch {
      break; // couldn't page further -- show what we have
    }
  }
  const myResult = allResults.find((r) => r.entry === myEntryId);

  const top10 = firstPage.standings.results.slice(0, 10);
  const wasAppended = Boolean(myResult && !top10.some((r) => r.entry === myResult.entry));
  const resultsToDetail = wasAppended ? [...top10, myResult!] : top10;

  const entries = await Promise.all(
    resultsToDetail.map(async (row): Promise<LeagueEntryRow> => {
      let projectedXp: number | null = null;
      let chip: string | null = null;
      let captainName: string | null = null;
      let playersPlayed: number | null = null;
      let playersLive: number | null = null;
      let playersToPlay: number | null = null;
      try {
        const picks = await fpl<FplPicks>(`/entry/${row.entry}/event/${gameweek}/picks/`);
        const payload = buildLivePayload({ bootstrap, live, fixtures, picks, inputs, gameweek, now });
        // Autosubs are computed the same way as your own tracker, but a
        // league entry's bench-boost/wildcard/free-hit chip use this
        // gameweek (if any) isn't visible from the picks endpoint alone,
        // so this can read slightly off for an entry playing a chip.
        const tracker = buildTracker(payload, null);
        projectedXp = tracker.projectedTotal;
        chip = picks.active_chip ? CHIP_LABEL[picks.active_chip] ?? picks.active_chip : null;
        captainName = payload.squad.find((s) => s.isCaptain)?.webName ?? null;
        // Three-way split matching FPL's own gameweek view: played (their
        // match is over, or they were subbed off mid-match), live
        // (currently mid-match), to play (fixture hasn't kicked off). The
        // three always sum to the full XI (11).
        const lineupRows = tracker.rows.filter((r) => !r.isBench);
        playersPlayed = lineupRows.filter(
          (r) => r.status === "finished" || r.status === "offPitch" || r.status === "didNotPlay",
        ).length;
        playersLive = lineupRows.filter((r) => r.status === "playing").length;
        playersToPlay = lineupRows.filter((r) => r.status === "notStarted").length;
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
        chip,
        captainName,
        playersPlayed,
        playersLive,
        playersToPlay,
      };
    }),
  );

  entries.sort((a, b) => a.rank - b.rank);

  return {
    leagueId: firstPage.league.id,
    leagueName: firstPage.league.name,
    entries,
    myRank: myResult?.rank ?? null,
    myEntryId,
    appendedEntryId: wasAppended ? myEntryId : null,
    totalEntries: allResults.length,
    totalEntriesIsFloor: hasNext,
  };
}

// Only the selected league's standings (plus every entry's picks) are
// fetched -- showing all of a manager's leagues at once fans out one FPL
// request per entry per league, which doesn't scale past a couple of leagues.
export async function GET(request: Request) {
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

    const privateLeagues = (entry.leagues?.classic ?? []).filter((l) => l.league_type === "x");
    const leagueOptions: LeagueSummary[] = privateLeagues.map((l) => ({
      leagueId: l.id,
      leagueName: l.name,
    }));

    const requestedId = Number(new URL(request.url).searchParams.get("leagueId") ?? "");
    const selectedRef =
      privateLeagues.find((l) => l.id === requestedId) ?? privateLeagues[0] ?? null;

    const inputs = poolLiveInputs(forecast);
    const now = new Date().toISOString();

    const league = selectedRef
      ? await fetchLeague(selectedRef, {
          bootstrap,
          live,
          fixtures,
          inputs,
          gameweek,
          now,
          myEntryId: Number(TEAM_ID),
        })
      : null;

    const payload: LeaguesResponse = { gameweek, generatedAt: now, leagues: leagueOptions, league };
    return NextResponse.json(payload);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
