import { NextRequest, NextResponse } from "next/server";
import { loadLatestForecast, type Forecast } from "@/lib/snapshots";
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
import { OWNER_TEAM_ID, resolveTeamId } from "@/lib/teamId";

const FPL = "https://fantasy.premierleague.com/api";

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
  summary_overall_points?: number;
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

// Past MAX_STANDINGS_PAGES, "your rank" used to just show as unknown --
// exactly the "#? of 500+" a big public/YouTuber league (thousands of
// entries) hits every time, since 10 pages only covers the top ~500.
// Standings are sorted descending by `total`, so instead of scanning every
// page in between, binary-search for the page your own total points falls
// on: exponential search to bracket an upper bound (unknown page count),
// then bisect within it. O(log n) requests instead of O(n) -- a
// million-entry league resolves in under 30 fetches instead of needing
// ~20,000. `myTotal` is `summary_overall_points` (already fetched for the
// entry), which matches a league's `total` for the common case (scored
// from the season start); a league scored from a later gameweek would only
// throw the estimate off by a bounded amount, so a few pages either side of
// the estimated landing spot are checked too before giving up.
const MAX_RANK_SEARCH_PAGES = 30;
const RANK_SEARCH_NEIGHBOR_PAGES = 2;

async function fetchStandingsPage(
  leagueId: number,
  page: number,
): Promise<FplStandingsEntry[] | null> {
  try {
    const path =
      page === 1
        ? `/leagues-classic/${leagueId}/standings/`
        : `/leagues-classic/${leagueId}/standings/?page_standings=${page}`;
    return (await fpl<FplStandings>(path)).standings.results;
  } catch {
    return null;
  }
}

async function findRankBeyondCap(
  leagueId: number,
  myEntryId: number,
  myTotal: number,
  lastScannedPage: number,
  lastScannedResults: FplStandingsEntry[],
): Promise<FplStandingsEntry | null> {
  if (lastScannedResults.length === 0) return null;
  // The caller already scanned pages 1..lastScannedPage (didn't find the
  // entry there) -- pick up the exponential search past that instead of
  // re-fetching pages already ruled out.
  let low = lastScannedPage;
  let lowResults = lastScannedResults;
  let fetches = 0;

  // Exponential search: double the page number until its lowest `total`
  // drops to or below myTotal (meaning myEntryId's rank falls on or before
  // this page), or the league runs out of pages.
  let high = lastScannedPage * 2;
  let highResults: FplStandingsEntry[] | null = null;
  while (fetches < MAX_RANK_SEARCH_PAGES) {
    fetches += 1;
    const results = await fetchStandingsPage(leagueId, high);
    if (!results || results.length === 0) break; // ran off the end of the league
    const found = results.find((r) => r.entry === myEntryId);
    if (found) return found;
    const pageMinTotal = results[results.length - 1].total;
    if (pageMinTotal <= myTotal) {
      highResults = results;
      break;
    }
    low = high;
    lowResults = results;
    high *= 2;
  }
  if (!highResults) return null; // ran out of budget or pages before bracketing

  // Bisect between low (total still above myTotal) and high (total at or
  // below myTotal) to land close to the right page.
  while (high - low > 1 && fetches < MAX_RANK_SEARCH_PAGES) {
    const mid = Math.floor((low + high) / 2);
    fetches += 1;
    const results = await fetchStandingsPage(leagueId, mid);
    if (!results || results.length === 0) {
      high = mid; // treat a failed/empty fetch as "at or past the end"
      continue;
    }
    const found = results.find((r) => r.entry === myEntryId);
    if (found) return found;
    const pageMinTotal = results[results.length - 1].total;
    if (pageMinTotal <= myTotal) {
      high = mid;
      highResults = results;
    } else {
      low = mid;
      lowResults = results;
    }
  }

  // Landed within one page of the right spot -- check a small neighborhood
  // in case the estimate (summary_overall_points as a stand-in for this
  // league's own `total`) was off by a page or so, rather than silently
  // reporting "not found" right next to the answer.
  for (const results of [lowResults, highResults]) {
    const found = results.find((r) => r.entry === myEntryId);
    if (found) return found;
  }
  for (
    let page = Math.max(1, low - RANK_SEARCH_NEIGHBOR_PAGES);
    page <= high + RANK_SEARCH_NEIGHBOR_PAGES && fetches < MAX_RANK_SEARCH_PAGES;
    page++
  ) {
    if (page === low || page === high) continue; // already checked above
    fetches += 1;
    const results = await fetchStandingsPage(leagueId, page);
    const found = results?.find((r) => r.entry === myEntryId);
    if (found) return found;
  }
  return null;
}

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
    myOverallPoints: number | null;
  },
): Promise<LeaguePayload | null> {
  const { bootstrap, live, fixtures, inputs, gameweek, now, myEntryId, myOverallPoints } = args;

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
  let lastPageResults = firstPage.standings.results;
  let hasNext = firstPage.standings.has_next;
  let page = 1;
  while (hasNext && page < MAX_STANDINGS_PAGES) {
    page += 1;
    try {
      const next = await fpl<FplStandings>(
        `/leagues-classic/${leagueRef.id}/standings/?page_standings=${page}`,
      );
      allResults.push(...next.standings.results);
      lastPageResults = next.standings.results;
      hasNext = next.standings.has_next;
    } catch {
      break; // couldn't page further -- show what we have
    }
  }
  let myResult = allResults.find((r) => r.entry === myEntryId);

  // Didn't turn up in the first MAX_STANDINGS_PAGES pages -- a big league
  // (the "#? of 500+" case). Binary-search the rest instead of giving up.
  if (!myResult && hasNext && myOverallPoints != null) {
    myResult =
      (await findRankBeyondCap(leagueRef.id, myEntryId, myOverallPoints, page, lastPageResults)) ??
      undefined;
  }

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
export async function GET(request: NextRequest) {
  try {
    const teamId = resolveTeamId(request.cookies);
    let forecast: Forecast | null;
    if (teamId === OWNER_TEAM_ID) {
      forecast = loadLatestForecast();
    } else {
      // Same reasoning as /api/live: a guest's own par margin/component xP
      // don't come from the owner's cached forecast.
      const forecastRes = await fetch(new URL(`/api/forecast?teamId=${teamId}`, request.url));
      forecast = forecastRes.ok ? await forecastRes.json() : null;
    }
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
      fpl<FplEntry>(`/entry/${teamId}/`),
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
          myEntryId: Number(teamId),
          myOverallPoints: entry.summary_overall_points ?? null,
        })
      : null;

    const payload: LeaguesResponse = { gameweek, generatedAt: now, leagues: leagueOptions, league };
    return NextResponse.json(payload);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
