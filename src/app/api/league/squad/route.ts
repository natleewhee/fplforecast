import { NextRequest, NextResponse } from "next/server";
import {
  buildLivePayload,
  buildTracker,
  liveGameweek,
  type FplBootstrap,
  type FplFixture,
  type FplLive,
  type FplPicks,
  type LiveProjectionInputs,
} from "@/lib/liveBlend";

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
  pointsSoFar: number; // captain multiplier already applied, matches FPL's own live score
  subbedIn: boolean;
  subbedOut: boolean;
  opponent: string | null;
};

export type LeagueSquadResponse = {
  entryId: number;
  entryName: string | null;
  managerName: string | null;
  gameweek: number;
  totalPoints: number; // sum of the effective (post-autosub) XI's pointsSoFar
  chip: string | null;
  rows: LeagueSquadRow[];
};

// No forecast-derived xP for this view at all -- it's deliberately "what
// actually happened", not a projection, so componentXpByElement stays
// empty and every playerProjection() result's remainingXp/contribution
// (the only fields that read from it) are simply unused below.
const EMPTY_INPUTS: LiveProjectionInputs = {
  componentXpByElement: {},
  parMargin: 0,
  marginProvisional: true,
  parBuffer: 0,
  parBufferProvisional: 0,
  rankCalibration: null,
};

/** A single league entry's actual current-gameweek squad and live points --
 * deliberately not this app's forecast model (that's squad-specific and
 * meant for the squad's own holder to plan with, not something that makes
 * sense pointed at someone else's team, per LeaguesPage.tsx's own
 * ManagerSquadPreview docstring). This is "what actually happened" only. */
export async function GET(request: NextRequest) {
  try {
    const entryId = Number(new URL(request.url).searchParams.get("entryId") ?? "");
    if (!Number.isInteger(entryId) || entryId <= 0) {
      return NextResponse.json({ error: "entryId must be a positive integer" }, { status: 400 });
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
      inputs: EMPTY_INPUTS,
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
      subbedIn: r.subbedIn,
      subbedOut: r.subbedOut,
      opponent: r.opponent,
    }));

    // The effective (post-autosub) XI, same definition as /api/league's own
    // played/live/toPlay split -- see that route's own comment for why
    // `!isBench` alone is wrong once a sub has fired.
    const effectiveXi = rows.filter((r) => (!r.isBench && !r.subbedOut) || r.subbedIn);
    const totalPoints = effectiveXi.reduce((sum, r) => sum + r.pointsSoFar, 0);

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
      chip: picks.active_chip ? CHIP_LABEL[picks.active_chip] ?? picks.active_chip : null,
      rows,
    };
    return NextResponse.json(body);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
