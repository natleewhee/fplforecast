import { NextRequest, NextResponse } from "next/server";
import { fpl, upstreamFailure } from "@/lib/fplApi";
import { guestForecastInputs, liveInputsFor } from "@/lib/liveInputs";
import {
  buildLivePayload,
  liveGameweek,
  type FplBootstrap,
  type FplFixture,
  type FplLive,
  type FplPicks,
} from "@/lib/liveBlend";
import { OWNER_TEAM_ID, resolveTeamIdFromRequest } from "@/lib/teamId";
import { internalOrigin } from "@/lib/internalOrigin";

export async function GET(req: NextRequest) {
  try {
    const teamId = resolveTeamIdFromRequest(req);
    if (req.nextUrl.searchParams.get("squad") === "1") {
      // Just who is in the squad this gameweek (the Squad tab uses it to show transfers made since the last
      // build). No forecast, scoring or fixtures: for a guest those would cost a full model run.
      const bootstrap = await fpl<FplBootstrap>("/bootstrap-static/");
      const gameweek = liveGameweek(bootstrap);
      const picks = await fpl<FplPicks>(`/entry/${teamId}/event/${gameweek}/picks/`);
      const positions: Record<number, string> = { 1: "GKP", 2: "DEF", 3: "MID", 4: "FWD" };
      const typeOf = new Map(bootstrap.elements.map((e) => [e.id, e.element_type]));
      return NextResponse.json({
        gameweek,
        chip: picks.active_chip ?? null,
        squad: picks.picks.map((p) => ({ id: p.element, position: positions[typeOf.get(p.element) ?? 0] ?? "MID" })),
      });
    }
    const bootstrap = await fpl<FplBootstrap>("/bootstrap-static/");
    const gameweek = liveGameweek(bootstrap);

    // Components come from the forecast built for THIS gameweek; a guest's own
    // par/rank inputs come from their on-demand forecast, cached for 15 minutes.
    const owner = teamId === OWNER_TEAM_ID;
    const inputs = liveInputsFor({
      liveGw: gameweek,
      owner,
      guestInputs: owner ? null : await guestForecastInputs(teamId, new URL(internalOrigin(req.url))),
    });
    if (!inputs) {
      return NextResponse.json(
        { error: "no committed forecast snapshot on disk" },
        { status: 503 },
      );
    }

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
      inputs,
      gameweek,
      now: new Date().toISOString(),
    });
    return NextResponse.json(payload);
  } catch (err) {
    const { status, body } = upstreamFailure(err);
    return NextResponse.json(body, { status });
  }
}
