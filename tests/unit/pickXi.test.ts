import { test } from "node:test";
import assert from "node:assert/strict";
import { isLegalXi, MIN_REPICK_GAIN, pickLineup, type Slot } from "@/lib/pickXi";

// 2 GK, 5 DEF, 5 MID, 3 FWD. Model XI (4-4-2... here 4-4-2 -> use 1 GK, 4 DEF, 4 MID, 2 FWD) ids 1..11.
const mk = (id: number, position: string, xp: number): Slot => ({ slot: id, position, xp });
function squad(over: Record<number, number> = {}): Slot[] {
  const base: [number, string, number][] = [
    [1, "GKP", 4], [2, "GKP", 2],
    [3, "DEF", 5], [4, "DEF", 5], [5, "DEF", 4.5], [6, "DEF", 4], [7, "DEF", 1.5],
    [8, "MID", 7], [9, "MID", 6], [10, "MID", 5], [11, "MID", 4], [12, "MID", 1],
    [13, "FWD", 8], [14, "FWD", 5], [15, "FWD", 1],
  ];
  return base.map(([id, pos, xp]) => mk(id, pos, over[id] ?? xp));
}
const modelXi = [1, 3, 4, 5, 6, 8, 9, 10, 11, 13, 14]; // 4-4-2
const modelBench = [2, 7, 12, 15];
const input = (slots: Slot[], hasSwaps: boolean, extra = {}) => ({
  slots, modelXi, modelBench, modelCaptain: 13, modelVice: 8, swappedSlots: new Set<number>(), hasSwaps, ...extra,
});

test("no swaps: the model's lineup is returned untouched, even if a bench player scores more", () => {
  const l = pickLineup(input(squad({ 7: 9 }), false));
  assert.deepEqual(l.xi, modelXi);
  assert.deepEqual(l.bench, modelBench);
  assert.equal(l.captain, 13);
  assert.equal(l.vice, 8);
  assert.equal(l.repicked, false);
  assert.equal(l.armbandAdjusted, false);
});

test("Hall -> Van Hecke: a joiner in a benched slot who out-scores a starter takes his place", () => {
  // slot 7 was the benched DEF (Hall, 1.5); the joiner (Van Hecke) is 4.9; starter 6 is 4.0 (Calafiori-like)
  const l = pickLineup(input(squad({ 7: 4.9, 6: 3.6 }), true));
  assert.ok(l.xi.includes(7), "joiner starts");
  assert.ok(!l.xi.includes(6), "displaced defender is benched");
  assert.ok(l.bench.includes(6));
  assert.equal(l.repicked, true);
  assert.ok(isLegalXi(l.xi.map((id) => squad().find((s) => s.slot === id)!.position)));
});

test("tie margin: a gain below the margin keeps the model's choice", () => {
  const l = pickLineup(input(squad({ 7: 4 + MIN_REPICK_GAIN - 0.1 }), true));
  assert.deepEqual(l.xi, modelXi);
  assert.equal(l.repicked, false);
  const at = pickLineup(input(squad({ 7: 4 + MIN_REPICK_GAIN + 0.01 }), true));
  assert.equal(at.repicked, true);
});

test("formation rules: always 1 GK, 3-5 DEF, 2-5 MID, 1-3 FWD, 11 total", () => {
  // a big MID score lets the formation change, but never past 5 MID or below 3 DEF
  const l = pickLineup(input(squad({ 12: 9, 11: 9, 7: 0, 15: 0, 14: 0.1 }), true));
  const pos = l.xi.map((id) => squad().find((s) => s.slot === id)!.position);
  assert.equal(l.xi.length, 11);
  assert.ok(isLegalXi(pos));
  assert.equal(pos.filter((p) => p === "MID").length, 5);
  assert.ok(pos.filter((p) => p === "DEF").length >= 3);
  assert.ok(pos.filter((p) => p === "FWD").length >= 1);
});

test("a goalkeeper never takes an outfield spot, and the bench keeper comes first", () => {
  const l = pickLineup(input(squad({ 2: 99, 7: 9 }), true));
  const pos = (id: number) => squad().find((s) => s.slot === id)!.position;
  assert.equal(l.xi.filter((id) => pos(id) === "GKP").length, 1);
  assert.equal(pos(l.bench[0]), "GKP");
  assert.equal(l.xi.length, 11);
  assert.equal(l.bench.length, 4);
});

test("bench: keeper first, then outfielders by xP, highest first", () => {
  const l = pickLineup(input(squad({ 7: 6, 15: 2, 12: 3 }), true));
  assert.equal(l.bench[0], 2);
  const rest = l.bench.slice(1).map((id) => squad({ 7: 6, 15: 2, 12: 3 }).find((s) => s.slot === id)!.xp!);
  assert.deepEqual(rest, [...rest].sort((a, b) => b - a));
});

test("armband: kept while the holder still starts", () => {
  const l = pickLineup(input(squad({ 7: 4.9, 6: 3.6 }), true));
  assert.equal(l.captain, 13);
  assert.equal(l.vice, 8);
  assert.equal(l.armbandAdjusted, false);
});

test("armband: a sold captain falls to the highest-xP starter and is flagged", () => {
  const l = pickLineup(input(squad({ 13: 1.2 }), true, { swappedSlots: new Set([13]) }));
  assert.equal(l.captain, 8);
  assert.notEqual(l.vice, l.captain);
  assert.equal(l.armbandAdjusted, true);
});

test("armband: a captain who drops out of the re-picked XI loses the armband", () => {
  const l = pickLineup(input(squad({ 13: 0, 14: 0, 15: 9, 12: 6 }), true));
  assert.ok(!l.xi.includes(13));
  assert.equal(l.captain, 15);
  assert.ok(l.xi.includes(l.vice!));
  assert.equal(l.armbandAdjusted, true);
});

test("headline points: XI total plus the captain once more", () => {
  const l = pickLineup(input(squad(), true));
  const xp = (id: number) => squad().find((s) => s.slot === id)!.xp!;
  assert.equal(l.points, l.xi.reduce((n, id) => n + xp(id), 0) + xp(l.captain!));
});

test("armband fallback skips provisional players, who may still start", () => {
  const s = squad({ 13: 1.2 }).map((x) => (x.slot === 8 ? { ...x, provisional: true } : x));
  const l = pickLineup(input(s, true, { swappedSlots: new Set([13]), modelVice: 14 }));
  assert.ok(l.xi.includes(8));
  assert.notEqual(l.captain, 8);
  assert.notEqual(l.vice, 8);
  assert.equal(l.captain, 9);
});

test("a saved transfer of the captain moves the armband to the best starter and flags it", () => {
  const l = pickLineup(input(squad({ 13: 4 }), true, { swappedSlots: new Set([13]) }));
  assert.equal(l.captain, 8);
  assert.equal(l.captainChanged, true);
  assert.equal(l.armbandAdjusted, true);
});
