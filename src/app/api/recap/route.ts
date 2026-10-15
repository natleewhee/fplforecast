import { NextRequest, NextResponse } from "next/server";
import { buildRecap, type Recap, type RecapInputs } from "@/lib/recap";
import { resolveTeamIdFromRequest } from "@/lib/teamId";

const FPL = "https://fantasy.premierleague.com/api";
const REVALIDATE = 300; // a finished gameweek barely changes

async function fpl<T>(path: string): Promise<T> {
  const res = await fetch(`${FPL}${path}`, {
    next: { revalidate: REVALIDATE },
    headers: { "User-Agent": "fplforecast-live/1.0" },
  });
  if (!res.ok) throw new Error(`FPL ${path} -> ${res.status}`);
  return (await res.json()) as T;
}

type Bootstrap = {
  events: { id: number; finished?: boolean; data_checked?: boolean; average_entry_score?: number | null }[];
  elements: { id: number; web_name: string; selected_by_percent: string; code?: number; team: number }[];
  teams: { id: number; short_name: string }[];
};
type Live = { elements: { id: number; stats?: { total_points?: number; minutes?: number } }[] };

export type RecapResponse = {
  recap: Recap | null;
  /** Every finished gameweek, ascending, for the week picker. */
  gameweeks: number[];
};

/** Recap of a *finished* gameweek for the current team: the latest by
 * default, or `?gw=N` for an earlier one. Picks are only public once a
 * gameweek has finished, so this is by design never the gameweek in
 * progress. */
export async function GET(request: NextRequest) {
  try {
    const teamId = resolveTeamIdFromRequest(request);
    const bootstrap = await fpl<Bootstrap>("/bootstrap-static/");
    const finished = bootstrap.events
      .filter((e) => e.finished)
      .map((e) => e.id)
      .sort((a, b) => a - b);
    if (!finished.length) return NextResponse.json({ recap: null, gameweeks: [] } satisfies RecapResponse);
    const asked = new URL(request.url).searchParams.get("gw");
    const gameweek = asked == null ? finished[finished.length - 1] : Number(asked);
    if (!Number.isInteger(gameweek) || !finished.includes(gameweek)) {
      return NextResponse.json({ error: "gw must be a finished gameweek" }, { status: 400 });
    }

    const [picks, live, history, transfers] = await Promise.all([
      fpl<RecapInputs["picks"]>(`/entry/${teamId}/event/${gameweek}/picks/`),
      fpl<Live>(`/event/${gameweek}/live/`),
      fpl<{ current: RecapInputs["history"] }>(`/entry/${teamId}/history/`),
      fpl<RecapInputs["transfers"]>(`/entry/${teamId}/transfers/`),
    ]);

    const rawPoints: Record<number, number> = {};
    const minutes: Record<number, number> = {};
    for (const el of live.elements) {
      rawPoints[el.id] = el.stats?.total_points ?? 0;
      minutes[el.id] = el.stats?.minutes ?? 0;
    }
    const players: RecapInputs["players"] = {};
    const teamShort = new Map(bootstrap.teams.map((t) => [t.id, t.short_name]));
    for (const el of bootstrap.elements) {
      players[el.id] = {
        name: el.web_name,
        ownedPct: Number(el.selected_by_percent) || 0,
        code: el.code ?? null,
        team: teamShort.get(el.team),
      };
    }

    const recap = buildRecap({
      gameweek,
      picks,
      rawPoints,
      minutes,
      players,
      history: history.current ?? [],
      transfers,
      averageScore: bootstrap.events.find((e) => e.id === gameweek)?.average_entry_score ?? null,
    });
    return NextResponse.json({ recap, gameweeks: finished } satisfies RecapResponse);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
