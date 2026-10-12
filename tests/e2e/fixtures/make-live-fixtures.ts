/* eslint-disable @typescript-eslint/no-explicit-any */
/* Builds the two /api/live payloads the browser tests replay, with the real
 * buildLivePayload so they always have the shape the app really receives:
 *   live-a.json  the first poll of a gameweek in progress
 *   live-b.json  the next poll: Palmer scores, one minute later
 * Run with: npm run test:fixtures */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildLivePayload } from "../../../src/lib/liveBlend.ts";

const here = dirname(fileURLToPath(import.meta.url));

const names = ["", "Raya", "Konsa", "Gabriel", "Porro", "Van Dijk", "Saka", "Palmer", "Szoboszlai", "King", "Gross", "Haaland", "Barry", "Mbeumo", "Kinsky", "Livramento"];
const type = (id: number) => (id === 1 || id === 14 ? 1 : [2, 3, 4, 5, 15].includes(id) ? 2 : [6, 7, 8, 9, 10].includes(id) ? 3 : 4);
const team: Record<number, number> = { 1: 1, 3: 1, 6: 1, 2: 2, 7: 3, 9: 4, 5: 5, 12: 6, 11: 7, 4: 8, 8: 8, 10: 9, 13: 9, 14: 9, 15: 10 };
const bootstrap: any = {
  events: [{ id: 6, is_current: true, finished: false, data_checked: false, average_entry_score: 52, deadline_time: "2026-10-10T10:00:00Z" }],
  teams: ["ARS", "LEE", "BOU", "IPS", "LIV", "NEW", "MCI", "TOT", "WHU", "FUL"].map((n, i) => ({ id: i + 1, short_name: n })),
  elements: names.slice(1).map((n, i) => ({ id: i + 1, web_name: n, team: team[i + 1], element_type: type(i + 1), code: 5000 + i })),
};
function make(variant: "a" | "b") {
const fx = (h: number, a: number, started: boolean, finished: boolean, provisional: boolean, k: string) =>
  ({ event: 6, started, finished, finished_provisional: provisional, kickoff_time: k, team_h: h, team_a: a, team_h_difficulty: 3, team_a_difficulty: 2 });
const fixtures: any[] = [
  fx(1, 2, true, true, true, "2026-10-11T10:00:00Z"),   // final
  fx(3, 4, true, false, true, "2026-10-11T12:30:00Z"),  // ended, provisional only
  fx(5, 6, true, false, false, "2026-10-11T14:00:00Z"), // live
  fx(7, 8, false, false, false, "2026-10-11T15:30:00Z"),// not started
  fx(9, 10, true, true, true, "2026-10-11T10:00:00Z"),  // final
];
const ex = (rows: [string, number, number][]) => [{ stats: rows.map(([identifier, points, value]) => ({ identifier, points, value })) }];
const el = (id: number, pts: number, mins: number, explain: any[] = []) => ({ id, stats: { total_points: pts, minutes: mins, goals_conceded: 0 }, explain });
const live: any = { elements: [
  el(1, 6, 90, ex([["minutes", 2, 90], ["clean_sheets", 4, 1]])),
  el(2, 4, 90, ex([["minutes", 2, 90], ["bonus", 2, 2]])),
  el(3, 6, 90, ex([["minutes", 2, 90], ["clean_sheets", 4, 1]])),
  el(4, 0, 0), el(5, 3, 62, ex([["minutes", 2, 62], ["bonus", 1, 1]])),
  el(6, 4, 90, ex([["minutes", 2, 90], ["assists", 3, 1], ["yellow_cards", -1, 1]])),
  el(7, variant === "b" ? 13 : 8, variant === "b" ? 88 : 87, ex(variant === "b" ? [["minutes", 2, 88], ["assists", 6, 2], ["goals_scored", 5, 1]] : [["minutes", 2, 87], ["assists", 6, 2]])),
  el(8, 0, 0), el(9, 2, 75, ex([["minutes", 2, 75]])),
  el(10, 13, 90, ex([["minutes", 2, 90], ["goals_scored", 5, 1], ["assists", 3, 1], ["bonus", 3, 3]])),
  el(11, 0, 0), el(12, -2, 53, ex([["minutes", 2, 53], ["red_cards", -3, 1], ["yellow_cards", -1, 1]])),
  el(13, 0, 0), el(14, 3, 90, ex([["minutes", 2, 90], ["saves", 1, 3]])), el(15, 0, 0),
] };
const order = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 14, 12, 13, 15];
const picks: any = { picks: order.map((e, i) => ({ element: e, position: i + 1, multiplier: i < 11 ? 1 : 0, is_captain: e === 6, is_vice_captain: e === 7 })) };
const comp: any = {}; for (let i = 1; i <= 15; i++) comp[String(i)] = { appearance: 1.9, goals: 0.5, assists: 0.3, cleanSheet: 0.8 };
const inputs: any = { componentXpByElement: comp, parMargin: 4, marginProvisional: false, parBuffer: 6, parBufferProvisional: 10, rankCalibration: { intercept: 12.2, slope: -0.08, lastKnownRank: 150000, sampleSize: 6 } };
const payload = buildLivePayload({ bootstrap, live, fixtures, picks, inputs, gameweek: 6, now: variant === "b" ? "2026-10-11T14:31:00Z" : "2026-10-11T14:30:00Z" } as any);
return payload;
}

for (const variant of ["a", "b"] as const) {
  writeFileSync(join(here, `live-${variant}.json`), JSON.stringify(make(variant)));
}
console.log("wrote live-a.json and live-b.json");
