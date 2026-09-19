import { NextRequest, NextResponse } from "next/server";
import { loadLatestForecast, type Forecast } from "@/lib/snapshots";
import {
  buildLivePayload,
  forecastLiveInputs,
  liveGameweek,
  type FplBootstrap,
  type FplFixture,
  type FplLive,
  type FplPicks,
} from "@/lib/liveBlend";
import { OWNER_TEAM_ID, resolveTeamId } from "@/lib/teamId";

const FPL = "https://fantasy.premierleague.com/api";

// Cache each upstream FPL fetch for ~40s so client polling at ~60s costs at
// most a couple of upstream calls per minute regardless of open tabs (KTD5).
const REVALIDATE = 40;

async function fpl<T>(path: string): Promise<T> {
  const res = await fetch(`${FPL}${path}`, {
    next: { revalidate: REVALIDATE },
    headers: { "User-Agent": "fplforecast-live/1.0" },
  });
  if (!res.ok) throw new Error(`FPL ${path} -> ${res.status}`);
  return (await res.json()) as T;
}

export async function GET(req: NextRequest) {
  try {
    const teamId = resolveTeamId(req.cookies);
    let forecast: Forecast | null;
    if (teamId === OWNER_TEAM_ID) {
      forecast = loadLatestForecast();
    } else {
      // A guest's par margin/rank calibration/component xP are all
      // squad-specific -- the owner's own cached forecast doesn't apply, so
      // fetch this team's own on-demand one instead (the same one AppShell
      // shows for them) rather than the static default.
      const forecastRes = await fetch(
        new URL(`/api/forecast?teamId=${teamId}`, req.url),
      );
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

    const [live, fixtures, picks] = await Promise.all([
      fpl<FplLive>(`/event/${gameweek}/live/`),
      fpl<FplFixture[]>(`/fixtures/?event=${gameweek}`),
      fpl<FplPicks>(`/entry/${teamId}/event/${gameweek}/picks/`),
    ]);

    const payload = buildLivePayload({
      bootstrap,
      live,
      fixtures,
      picks,
      inputs: forecastLiveInputs(forecast),
      gameweek,
      now: new Date().toISOString(),
    });
    return NextResponse.json(payload);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
