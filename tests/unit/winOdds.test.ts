import { test } from "node:test";
import assert from "node:assert/strict";
import { differentials, simulateDuel, sideFrom, type Side } from "../../src/lib/winOdds.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
const row = (id: number, o: any = {}): any => ({
  id,
  webName: `P${id}`,
  isBench: false,
  isArmband: false,
  subbedIn: false,
  subbedOut: false,
  status: "notStarted",
  pointsSoFar: 0,
  remainingXp: 0,
  ...o,
});

test("a finished game is decided with certainty", () => {
  const a: Side = { banked: 60, pending: [] };
  const b: Side = { banked: 50, pending: [] };
  const o = simulateDuel(a, b);
  assert.equal(o.win, 1);
  assert.equal(o.lose, 0);
});

test("equal sides with pending points are close to a coin flip", () => {
  const side: Side = { banked: 30, pending: Array.from({ length: 6 }, () => ({ mean: 4, mult: 1 })) };
  const o = simulateDuel(side, side, 6000, 7);
  assert.ok(Math.abs(o.win - o.lose) < 0.05);
});

test("simulated mean tracks banked + expected points", () => {
  const a: Side = { banked: 20, pending: [{ mean: 6, mult: 1 }, { mean: 10, mult: 2 }] };
  const o = simulateDuel(a, { banked: 0, pending: [] }, 8000, 3);
  assert.ok(Math.abs(o.meanA - 36) < 0.6, `meanA ${o.meanA}`);
});

test("same inputs give the same odds", () => {
  const a: Side = { banked: 10, pending: [{ mean: 5, mult: 1 }] };
  const b: Side = { banked: 12, pending: [{ mean: 4, mult: 1 }] };
  assert.deepEqual(simulateDuel(a, b), simulateDuel(a, b));
});

test("sideFrom counts the post-autosub XI and doubles the armband", () => {
  const s = sideFrom({
    chip: null,
    rows: [
      row(1, { pointsSoFar: 6, status: "finished" }),
      row(2, { isArmband: true, remainingXp: 10 }),
      row(3, { subbedOut: true, pointsSoFar: 0 }),
      row(4, { isBench: true, subbedIn: true, pointsSoFar: 2, status: "finished" }),
      row(5, { isBench: true, pointsSoFar: 9, status: "finished" }),
    ],
  } as any);
  assert.equal(s.banked, 8);
  assert.deepEqual(s.pending, [{ mean: 10, mult: 2 }]);
});

test("differentials ignore shared players and the bench", () => {
  const mk = (ids: number[], bench: number[] = []): any => ({
    chip: null,
    rows: [...ids.map((i) => row(i)), ...bench.map((i) => row(i, { isBench: true }))],
  });
  const d = differentials(mk([1, 2, 3], [9]), mk([2, 3, 4], [1]));
  assert.deepEqual(d.onlyA.map((r) => r.id), [1]);
  assert.deepEqual(d.onlyB.map((r) => r.id), [4]);
});
