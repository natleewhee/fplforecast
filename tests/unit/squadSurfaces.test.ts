import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildTicker, cellFor } from "@/lib/fixtureTicker";
import { buildCaptainShortlist, secondPickNote, type CaptainCandidate } from "@/lib/captainShortlist";
import { lineupFor, resolveSwaps } from "@/lib/squadView";
import type { Forecast, OpponentLeg, PoolPlayer } from "@/lib/snapshots";

const leg = (team: string, wasHome = true, fdrRating: number | null = 3): OpponentLeg => ({ team, wasHome, fdrRating });

/* A minimal squad: 2 GKP, 3 DEF, 3 MID, 2 FWD (enough to test order); XI = ids 1,3,4,5,6,7,8,10,11 ... kept short. */
const POS = ["GKP", "GKP", "DEF", "DEF", "MID", "MID", "FWD", "FWD"];
function player(i: number) {
  return {
    id: i + 1, webName: `P${i + 1}`, team: "AAA", position: POS[i],
    floorCeiling: { floor: 2 + i * 0.1, ceiling: 8 + i, bandProvisional: false },
  };
}
const squadPlayers = POS.map((_, i) => player(i));

// GW1: P3 blank, P5 double. GW2: P8 blank.
const legsByGw: Record<number, Record<number, OpponentLeg[]>> = {
  1: { 3: [], 5: [leg("BUR"), leg("CHE", false, 4)] },
  2: { 8: [] },
};
const xp: Record<number, number> = { 1: 3, 2: 2, 3: 4, 4: 5, 5: 7, 6: 6, 7: 8, 8: 5 };
const upcoming = [1, 2].map((gw) => ({
  gameweek: gw, points: 0,
  startingXi: [1, 3, 4, 5, 6, 7],
  bench: [2, 8],
  captainId: 7, viceCaptainId: 5,
  players: squadPlayers.map((p) => ({
    id: p.id, projectedPoints: xp[p.id], provisional: false, minutesRisk: false,
    opponents: legsByGw[gw]?.[p.id] ?? [leg("ZZZ")],
  })),
}));
const pool = squadPlayers.map((p) => ({
  id: p.id, webName: p.webName, team: "AAA", elementType: 1, position: p.position, price: 5, sellPrice: 5,
  selectedByPercent: 10 + p.id, form: 3, perGameweek: [xp[p.id], xp[p.id]], total: 0,
  opponents: [[leg("ZZZ")], [leg("ZZZ")]], availability: { status: "a", chance: null, news: null }, components: null,
})) as unknown as PoolPlayer[];

const forecast = {
  squad: { players: squadPlayers, startingXi: [], bench: [] },
  upcoming, pool,
  captainEdge: { label: "clear edge", points: 2 },
  viceCaptain: { id: 5, webName: "P5", points: 7 },
} as unknown as Forecast;

test("ticker: starters in pitch order, then subs in the order they come on", () => {
  const t = buildTicker(forecast, new Map());
  assert.deepEqual(t.rows.map((r) => r.id), [1, 3, 4, 5, 6, 7, 2, 8]);
  assert.deepEqual(t.rows.map((r) => r.group), ["starter", "starter", "starter", "starter", "starter", "starter", "sub", "sub"]);
  assert.deepEqual(t.gameweeks, [1, 2]);
});

test("ticker: a blank gameweek is a blank cell and a double has both legs", () => {
  const t = buildTicker(forecast, new Map());
  const p3 = t.rows.find((r) => r.id === 3)!;
  assert.deepEqual(p3.cells[0], { kind: "blank" });
  assert.equal(p3.cells[1].kind, "single");
  const p5 = t.rows.find((r) => r.id === 5)!;
  assert.equal(p5.cells[0].kind, "double");
  assert.deepEqual(p5.cells[0].kind === "double" && p5.cells[0].legs.map((l) => l.team), ["BUR", "CHE"]);
});

test("ticker: shows at most five gameweeks", () => {
  const six = { ...forecast, upcoming: Array.from({ length: 6 }, (_, i) => ({ ...upcoming[0], gameweek: i + 1 })) } as Forecast;
  assert.equal(buildTicker(six, new Map()).gameweeks.length, 5);
  assert.equal(buildTicker(six, new Map()).rows[0].cells.length, 5);
});

test("ticker: a transfer made in FPL takes the leaver's slot, with the newcomer's fixtures", () => {
  const newcomer = {
    ...pool[2], id: 99, webName: "Newbie", position: "DEF",
    opponents: [[], [leg("LIV", false, 5), leg("EVE")]],
  } as PoolPlayer;
  const live = squadPlayers.map((p) => (p.id === 3 ? { id: 99, position: "DEF" } : { id: p.id, position: p.position }));
  const { swaps } = resolveSwaps({ squad: forecast.squad, pool: [...pool, newcomer] }, live, undefined);
  const t = buildTicker(forecast, swaps);
  const row = t.rows[1];
  assert.equal(row.id, 99);
  assert.equal(row.swappedIn, true);
  assert.equal(row.group, "starter");
  assert.equal(row.cells[0].kind, "blank");
  assert.equal(row.cells[1].kind, "double");
});

test("ticker: a saved transfer is applied, one at another position is not", () => {
  const same = resolveSwaps(forecast, null, [{ out: 3, in: 4 }]);
  assert.equal(same.swaps.get(3)?.id, 4);
  const wrong = resolveSwaps(forecast, null, [{ out: 3, in: 1 }]);
  assert.equal(wrong.swaps.size, 0);
});

test("cellFor handles missing data as blank", () => {
  assert.deepEqual(cellFor(undefined), { kind: "blank" });
  assert.deepEqual(cellFor(null), { kind: "blank" });
});

test("shortlist: top three by xP, model pick marked and first", () => {
  const s = buildCaptainShortlist(forecast, new Map(), new Set())!;
  assert.deepEqual(s.candidates.map((c) => c.id), [7, 5, 6]);
  assert.deepEqual(s.candidates.map((c) => c.isModelPick), [true, false, false]);
  assert.equal(s.gameweek, 1);
  assert.equal(s.candidates[1].isDouble, true);
  assert.equal(s.candidates[0].ownedPct, 17);
  assert.equal(s.edge?.viceName, "P5");
});

test("shortlist: the model's pick is kept even when it is not in the top three by xP", () => {
  const f = { ...forecast, upcoming: upcoming.map((u) => ({ ...u, captainId: 1 })) } as Forecast;
  const s = buildCaptainShortlist(f, new Map(), new Set())!;
  assert.equal(s.candidates.length, 3);
  assert.equal(s.candidates[0].id, 1);
  assert.ok(s.candidates[0].isModelPick);
});

test("shortlist: a captain sold in FPL passes the pick to the vice and drops the edge label", () => {
  const live = squadPlayers.map((p) => (p.id === 7 ? { id: 8, position: "FWD" } : { id: p.id, position: p.position }));
  const r = resolveSwaps(forecast, live, undefined);
  // the leaver (7) is replaced by 8, who is already in the squad on the bench: nothing to resolve, so no swap
  assert.equal(r.swaps.size, 0);
  const swaps = new Map<number, PoolPlayer>([[7, { ...pool[7], id: 50, webName: "New9", perGameweek: [1, 1] } as PoolPlayer]]);
  const s = buildCaptainShortlist(forecast, swaps, new Set([7]))!;
  assert.equal(s.candidates.find((c) => c.isModelPick)?.id, 5);
  assert.equal(s.edge, null);
});

test("shortlist: a guest payload without bands or ownership still works", () => {
  const bare = {
    ...forecast,
    pool: [],
    squad: { ...forecast.squad, players: squadPlayers.map(({ id, webName, team, position }) => ({ id, webName, team, position })) },
  } as unknown as Forecast;
  const s = buildCaptainShortlist(bare, new Map(), new Set())!;
  assert.equal(s.candidates.length, 3);
  assert.equal(s.candidates[0].floor, null);
  assert.equal(s.candidates[0].ownedPct, null);
  assert.equal(s.secondNote, null);
});

const cand = (o: Partial<CaptainCandidate>): CaptainCandidate => ({
  id: 1, webName: "A", team: "X", xp: 7, floor: 3, ceiling: 10, ownedPct: 40, form: 5, isDouble: false, isModelPick: false, ...o,
});

test("second pick: lower ownership and higher ceiling is a differential", () => {
  const n = secondPickNote(cand({ webName: "Pick" }), cand({ webName: "Alt", xp: 6, ownedPct: 8, ceiling: 12 }));
  assert.equal(n?.kind, "differential");
  assert.match(n!.text, /8\.0% owned vs 40%/);
});

test("second pick: higher floor is the safe one, only when the numbers say so", () => {
  const n = secondPickNote(cand({ webName: "Pick" }), cand({ webName: "Alt", xp: 6, floor: 4.5, ceiling: 9, ownedPct: 55 }));
  assert.equal(n?.kind, "safe");
  assert.match(n!.text, /1\.0 fewer/);
});

test("second pick: a hair's breadth is not a differential or a safe pick", () => {
  // 45% vs 46% owned, ceiling a touch higher; floor only 0.2 higher
  assert.equal(secondPickNote(cand({ ownedPct: 46 }), cand({ ownedPct: 45, ceiling: 10.5, floor: 3.2 })), null);
  // exactly the minimum gap counts
  assert.equal(secondPickNote(cand({ ownedPct: 46 }), cand({ ownedPct: 41, ceiling: 10.5 }))?.kind, "differential");
  assert.equal(secondPickNote(cand({}), cand({ floor: 3.5 }))?.kind, "safe");
});

test("shortlist: a player projected from a prior alone is never a candidate", () => {
  const f = {
    ...forecast,
    upcoming: upcoming.map((u) => ({ ...u, players: u.players.map((p) => (p.id === 7 ? { ...p, provisional: true } : p)) })),
  } as Forecast;
  const s = buildCaptainShortlist(f, new Map(), new Set())!;
  assert.ok(!s.candidates.some((c) => c.id === 7));
});

test("shortlist: a replacement a saved transfer put in the captain's place is not labelled the model's pick", () => {
  const swaps = new Map<number, PoolPlayer>([[7, { ...pool[7], id: 50, webName: "New9", perGameweek: [9, 9] } as PoolPlayer]]);
  const s = buildCaptainShortlist(forecast, swaps, new Set())!;
  assert.ok(s.candidates.some((c) => c.id === 50));
  assert.ok(!s.candidates.some((c) => c.isModelPick));
  assert.equal(s.edge, null);
});

test("shortlist: no edge line when the vice is on the bench", () => {
  const f = { ...forecast, viceCaptain: { id: 2, webName: "P2", points: 2 } } as Forecast;
  assert.equal(buildCaptainShortlist(f, new Map(), new Set())!.edge, null);
});

test("ticker: gameweeks past 38 are dropped", () => {
  const f = { ...forecast, upcoming: [36, 37, 38, 39, 40].map((gw) => ({ ...upcoming[0], gameweek: gw })) } as Forecast;
  const t = buildTicker(f, new Map());
  assert.deepEqual(t.gameweeks, [36, 37, 38]);
  assert.equal(t.rows[0].cells.length, 3);
});

test("second pick: no claim when nothing supports it, or a number is missing", () => {
  assert.equal(secondPickNote(cand({}), cand({ xp: 6, floor: 2, ceiling: 9, ownedPct: 50 })), null);
  assert.equal(secondPickNote(cand({}), cand({ floor: null, ceiling: null })), null);
  assert.equal(secondPickNote(cand({}), cand({ ownedPct: null, ceiling: 12, floor: 1 })), null);
});

test("the committed forecast builds a ticker and a shortlist", () => {
  const f = JSON.parse(readFileSync("data/forecast/gw11.json", "utf8")) as Forecast;
  const t = buildTicker(f, new Map());
  assert.equal(t.rows.length, 15);
  assert.equal(t.rows.filter((r) => r.group === "starter").length, 11);
  assert.equal(t.gameweeks.length, 5);
  const s = buildCaptainShortlist(f, new Map(), new Set())!;
  assert.equal(s.candidates.length, 3);
  assert.equal(s.candidates.filter((c) => c.isModelPick).length, 1);
  assert.equal(s.candidates[0].id, f.captain?.id);
});

test("lineup: a saved transfer of the captain does not hand the armband to a weak joiner", () => {
  const weak = { ...pool[6], id: 77, webName: "Weak", perGameweek: [1, 1] } as PoolPlayer;
  const resolved = { swaps: new Map<number, PoolPlayer>([[7, weak]]), appliedOut: new Set<number>() };
  const l = lineupFor(forecast, resolved)!;
  assert.equal(l.captain, 5);
  assert.equal(l.vice, 6);
  assert.equal(l.armbandAdjusted, true);
  assert.equal(l.captainChanged, true);
});

test("shortlist: no 'Model pick' label and no edge when the app moved the armband", () => {
  const weak = { ...pool[6], id: 77, webName: "Weak", perGameweek: [1, 1] } as PoolPlayer;
  const resolved = { swaps: new Map<number, PoolPlayer>([[7, weak]]), appliedOut: new Set<number>() };
  const s = buildCaptainShortlist(forecast, resolved.swaps, resolved.appliedOut, 3, lineupFor(forecast, resolved))!;
  assert.ok(s.candidates.every((c) => !c.isModelPick));
  assert.equal(s.edge, null);
});

test("lineup: an out-of-range gameweek index falls back to the target gameweek instead of throwing", () => {
  const l = lineupFor(forecast, { swaps: new Map() }, 9)!;
  assert.deepEqual(l.xi, [1, 3, 4, 5, 6, 7]);
});
