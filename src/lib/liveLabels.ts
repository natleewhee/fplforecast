import type { BreakdownItem } from "@/lib/liveBlend";

// FPL's own `explain` identifiers -> a short human label for the breakdown.
const STAT_LABEL_MAP: Record<string, string> = {
  minutes: "Minutes",
  goals_scored: "Goals",
  assists: "Assists",
  clean_sheets: "Clean sheet",
  goals_conceded: "Goals conceded",
  own_goals: "Own goals",
  penalties_saved: "Penalties saved",
  penalties_missed: "Penalties missed",
  yellow_cards: "Yellow card",
  red_cards: "Red card",
  saves: "Saves",
  bonus: "Bonus",
  defensive_contribution: "Defensive contribution",
  mng_win: "Win",
  mng_draw: "Draw",
  mng_loss: "Loss",
  mng_clean_sheets: "Clean sheet",
  mng_goals_scored: "Goals scored",
};

export function statLabel(identifier: string): string {
  return (
    STAT_LABEL_MAP[identifier] ??
    identifier
      .split("_")
      .map((w) => w[0]?.toUpperCase() + w.slice(1))
      .join(" ")
  );
}

/** The scoring lines worth showing: anything that scored, plus minutes played. */
export function visibleBreakdown(breakdown: BreakdownItem[]): BreakdownItem[] {
  return breakdown.filter((b) => b.points !== 0 || b.identifier === "minutes");
}

/** Kickoff day + time in Singapore Time, e.g. "Sat 21:00" (the caller says SGT). */
export function sgKickoff(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const day = d.toLocaleDateString("en-GB", { weekday: "short", timeZone: "Asia/Singapore" });
  const time = d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Singapore",
  });
  return `${day} ${time}`;
}

/** "MCI (H)" -> { team: "MCI", home: true }; null when there is no fixture. */
export function parseOpponent(opponent: string | null): { team: string; home: boolean } | null {
  const m = opponent?.match(/^(.+?) \(([HA])\)$/);
  return m ? { team: m[1], home: m[2] === "H" } : null;
}

export type EventCounts = {
  goals: number;
  assists: number;
  yellow: number;
  red: number;
  penSaved: number;
  penMissed: number;
  ownGoals: number;
  cleanSheet: number; // 1 only when it actually earned points (a forward's clean sheet is worth 0)
  defcon: number; // 1 when the defensive-contribution bonus was earned
};

/** The headline events in FPL's breakdown, as counts (`value` is the count). */
export function eventCounts(breakdown: BreakdownItem[]): EventCounts {
  const n = (id: string) => breakdown.find((b) => b.identifier === id)?.value ?? 0;
  const scored = (id: string) => ((breakdown.find((b) => b.identifier === id)?.points ?? 0) > 0 ? 1 : 0);
  return {
    goals: n("goals_scored"),
    assists: n("assists"),
    yellow: n("yellow_cards"),
    red: n("red_cards"),
    penSaved: n("penalties_saved"),
    penMissed: n("penalties_missed"),
    ownGoals: n("own_goals"),
    cleanSheet: scored("clean_sheets"),
    defcon: scored("defensive_contribution"),
  };
}

export function totalEvents(c: EventCounts): number {
  return c.goals + c.assists + c.yellow + c.red + c.penSaved + c.penMissed + c.ownGoals + c.cleanSheet + c.defcon;
}
