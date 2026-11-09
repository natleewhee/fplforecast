/* The fixture ticker: your 15 players against their next few opponents. Rows are built here, not in the
 * component, so blanks, doubles and order can be tested. Starters come first (in pitch order), then the
 * subs in the order they come on. A player standing in for a transferred one takes that slot. */

import type { Forecast, OpponentLeg, PoolPlayer } from "./snapshots";

export type TickerCell =
  | { kind: "blank" }
  | { kind: "single"; leg: OpponentLeg }
  | { kind: "double"; legs: OpponentLeg[] };

export type TickerRow = {
  id: number;
  webName: string;
  position: string;
  team: string;
  group: "starter" | "sub";
  /** true when this player replaces someone from the model's squad (a transfer) */
  swappedIn: boolean;
  cells: TickerCell[];
};

export type Ticker = { gameweeks: number[]; rows: TickerRow[] };

const POSITION_ORDER = ["GKP", "DEF", "MID", "FWD"];

export function cellFor(legs: OpponentLeg[] | undefined | null): TickerCell {
  if (!legs || legs.length === 0) return { kind: "blank" };
  if (legs.length === 1) return { kind: "single", leg: legs[0] };
  return { kind: "double", legs };
}

export function buildTicker(
  forecast: Pick<Forecast, "squad" | "upcoming">,
  swaps: Map<number, PoolPlayer>,
  horizon = 5,
): Ticker {
  const upcoming = forecast.upcoming.slice(0, horizon);
  const first = upcoming[0];
  if (!first) return { gameweeks: [], rows: [] };
  const byId = new Map(forecast.squad.players.map((p) => [p.id, p]));

  const rowFor = (id: number, group: TickerRow["group"]): TickerRow | null => {
    const base = byId.get(id);
    if (!base) return null;
    const swap = swaps.get(id);
    if (swap) {
      return {
        id: swap.id,
        webName: swap.webName,
        position: swap.position,
        team: swap.team,
        group,
        swappedIn: true,
        cells: upcoming.map((_, i) => cellFor(swap.opponents[i])),
      };
    }
    return {
      id,
      webName: base.webName,
      position: base.position,
      team: base.team,
      group,
      swappedIn: false,
      cells: upcoming.map((u) => cellFor(u.players.find((p) => p.id === id)?.opponents)),
    };
  };

  const starters = first.startingXi.map((id) => rowFor(id, "starter")).filter((r): r is TickerRow => !!r);
  // stable sort by pitch position (GKP, DEF, MID, FWD), keeping the model's order within a position
  starters.sort((a, b) => POSITION_ORDER.indexOf(a.position) - POSITION_ORDER.indexOf(b.position));
  const subs = first.bench.map((id) => rowFor(id, "sub")).filter((r): r is TickerRow => !!r);
  return { gameweeks: upcoming.map((u) => u.gameweek), rows: [...starters, ...subs] };
}
