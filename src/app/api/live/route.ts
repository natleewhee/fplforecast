import { NextResponse } from "next/server";
import { loadLatestForecast } from "@/lib/snapshots";
import {
  buildLivePayload,
  liveGameweek,
  type FplBootstrap,
  type FplFixture,
  type FplLive,
  type FplPicks,
} from "@/lib/liveBlend";

const FPL = "https://fantasy.premierleague.com/api";
const TEAM_ID = process.env.FPL_TEAM_ID || "1168513";

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

    const [live, fixtures, picks] = await Promise.all([
      fpl<FplLive>(`/event/${gameweek}/live/`),
      fpl<FplFixture[]>(`/fixtures/?event=${gameweek}`),
      fpl<FplPicks>(`/entry/${TEAM_ID}/event/${gameweek}/picks/`),
    ]);

    const payload = buildLivePayload({
      bootstrap,
      live,
      fixtures,
      picks,
      forecast,
      gameweek,
      now: new Date().toISOString(),
    });
    return NextResponse.json(payload);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
