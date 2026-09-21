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

// Same cadence as /api/league itself.
const REVALIDATE = 40;

async function fpl<T>(path: string): Promise<T> {
  const res = await fetch(`${FPL}${path}`, {
    next: { revalidate: REVALIDATE },
    headers: { "User-Agent": "fplforecast-live/1.0" },
  });
  if (!res.ok) throw new Error(`FPL ${path} -> ${res.status}`);
  return (await res.json()) as T;
}

type FplEntry = { name?: string; player_first_name?: string; player_last_name?: string };

export type LeagueSquadRow = {
  id: number;
  webName: string;
  team: string; // short_name, for kit color
  position: "GKP" | "DEF" | "MID" | "FWD";
  isBench: boolean;
  isCaptain: boolean;
  isViceCaptain: boolean;
  isArmband: boolean;
  status: "notStarted" | "playing" | "offPitch" | "finished" | "didNotPlay";
  minutes: number;
  pointsSoFar: number; // actual FPL points so far, captain multiplier applied
  remainingXp: number; // this app's decayed projection for the rest of the GW, captain multiplier applied
  noBakedXp: boolean; // this app's pool doesn't have a component breakdown for this player
  subbedIn: boolean;
  subbedOut: boolean;
  opponent: string | null;
};

export type LeagueSquadResponse = {
  entryId: number;
  entryName: string | null;
  managerName: string | null;
  gameweek: number;
  totalPoints: number; // effective (post-autosub) XI's actual pointsSoFar
  totalXp: number; // same XI's pointsSoFar + remainingXp -- "where this GW is heading"
  chip: string | null;
  rows: LeagueSquadRow[];
};

/** A single league entry's actual current-gameweek squad, live points, and
 * this app's remaining-xP projection for the rest of the gameweek --
 * deliberately not the forecast *model* (that's squad-specific and meant
 * for the squad's own holder to plan transfers/captaincy with, not
 * something that makes sense pointed at someone else's team). "Current
 * points and xP", not "what would this app do with their squad". Reuses
 * the viewing manager's own pool component xP the same way /api/league's
 * own projectedXp column already does (poolLiveInputs) -- the pool
 * projection is squad-agnostic, so it's valid for any entry's held
 * players, not just the viewer's. */
export async function GET(request: NextRequest) {
  try {
    const entryId = Number(new URL(request.url).searchParams.get("entryId") ?? "");
    if (!Number.isInteger(entryId) || entryId <= 0) {
      return NextResponse.json({ error: "entryId must be a positive integer" }, { status: 400 });
    }

    const teamId = resolveTeamId(request.cookies);
    let forecast: Forecast | null;
    if (teamId === OWNER_TEAM_ID) {
      forecast = loadLatestForecast();
    } else {
      const forecastRes = await fetch(new URL(`/api/forecast?teamId=${teamId}`, request.url));
      forecast = forecastRes.ok ? await forecastRes.json() : null;
    }

    const bootstrap = await fpl<FplBootstrap>("/bootstrap-static/");
    const gameweek = liveGameweek(bootstrap);

    const [live, fixtures, entry, picks] = await Promise.all([
      fpl<FplLive>(`/event/${gameweek}/live/`),
      fpl<FplFixture[]>(`/fixtures/?event=${gameweek}`),
      fpl<FplEntry>(`/entry/${entryId}/`),
      fpl<FplPicks>(`/entry/${entryId}/event/${gameweek}/picks/`),
    ]);

    const payload = buildLivePayload({
      bootstrap,
      live,
      fixtures,
      picks,
      inputs: forecast ? poolLiveInputs(forecast) : {
        componentXpByElement: {},
        parMargin: 0,
        marginProvisional: true,
        parBuffer: 0,
        parBufferProvisional: 0,
        rankCalibration: null,
      },
      gameweek,
      now: new Date().toISOString(),
    });
    const tracker = buildTracker(payload, null);

    const teamShortById = new Map(bootstrap.teams.map((t) => [t.id, t.short_name]));
    const clubByElement = new Map(bootstrap.elements.map((el) => [el.id, el.team]));

    const rows: LeagueSquadRow[] = tracker.rows.map((r) => ({
      id: r.id,
      webName: r.webName,
      team: teamShortById.get(clubByElement.get(r.id) ?? -1) ?? "???",
      position: r.position,
      isBench: r.isBench,
      isCaptain: r.id === payload.picks.captainId,
      isViceCaptain: r.id === payload.picks.viceCaptainId,
      isArmband: r.isArmband,
      status: r.status,
      minutes: r.minutes,
      pointsSoFar: r.pointsSoFar,
      remainingXp: r.remainingXp,
      noBakedXp: r.noBakedXp,
      subbedIn: r.subbedIn,
      subbedOut: r.subbedOut,
      opponent: r.opponent,
    }));

    // The effective (post-autosub) XI, same definition as /api/league's own
    // played/live/toPlay split -- see that route's own comment for why
    // `!isBench` alone is wrong once a sub has fired.
    const effectiveXi = rows.filter((r) => (!r.isBench && !r.subbedOut) || r.subbedIn);
    const totalPoints = effectiveXi.reduce((sum, r) => sum + r.pointsSoFar, 0);
    const totalXp = effectiveXi.reduce((sum, r) => sum + r.pointsSoFar + r.remainingXp, 0);

    const CHIP_LABEL: Record<string, string> = {
      wildcard: "WC",
      freehit: "FH",
      bboost: "BB",
      "3xc": "TC",
    };

    const body: LeagueSquadResponse = {
      entryId,
      entryName: entry.name ?? null,
      managerName:
        entry.player_first_name || entry.player_last_name
          ? `${entry.player_first_name ?? ""} ${entry.player_last_name ?? ""}`.trim()
          : null,
      gameweek,
      totalPoints,
      totalXp,
      chip: picks.active_chip ? CHIP_LABEL[picks.active_chip] ?? picks.active_chip : null,
      rows,
    };
    return NextResponse.json(body);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
