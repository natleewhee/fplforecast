import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bankAfterPending,
  replaceOptions,
  squadAfterPending,
  type Held,
  type Known,
} from "../../src/lib/replaceOptions.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
const pl = (id: number, team: string, price: number, xp: number[], position = "MID", status = "a"): any => ({
  id,
  webName: `P${id}`,
  team,
  position,
  price,
  perGameweek: xp,
  availability: { status, chance: null, news: null },
});

const squad: Held[] = [
  { id: 1, team: "ARS", position: "MID", sellPrice: 8.0 },
  { id: 2, team: "CHE", position: "MID", sellPrice: 6.0 },
  { id: 3, team: "CHE", position: "DEF", sellPrice: 5.0 },
  { id: 4, team: "CHE", position: "FWD", sellPrice: 7.0 },
  { id: 5, team: "LIV", position: "MID", sellPrice: 7.5 },
];
const pool = [
  pl(10, "MCI", 9.0, [7, 6, 6]), // too expensive for 8.0 + 0.5
  pl(11, "MCI", 8.5, [6, 5, 5]), // affordable
  pl(12, "CHE", 6.0, [9, 9, 9]), // a fourth Chelsea player
  pl(13, "TOT", 7.0, [5, 4, 4], "MID", "i"), // injured
  pl(14, "TOT", 7.0, [5, 4, 4]),
  pl(15, "TOT", 6.0, [3, 3, 3], "DEF"), // wrong position
  pl(2, "CHE", 6.0, [4, 4, 4]), // already owned
];

test("only legal, affordable, healthy, same-position players, best first", () => {
  const r = replaceOptions({ out: squad[0], outXp: 4, squad, pool, bank: 0.5, horizon: 1 });
  assert.deepEqual(r.map((o) => o.player.id), [11, 14]);
  assert.equal(r[0].left, 0); // 8.0 + 0.5 - 8.5
  assert.ok(Math.abs(r[0].delta - 2) < 1e-9);
});

test("the horizon sums that many gameweeks", () => {
  const r = replaceOptions({ out: squad[0], outXp: 4, squad, pool, bank: 0.5, horizon: 3 });
  assert.equal(r[0].xp, 16);
});

test("search narrows the list", () => {
  const r = replaceOptions({ out: squad[0], outXp: 4, squad, pool, bank: 0.5, horizon: 1, query: "p14" });
  assert.deepEqual(r.map((o) => o.player.id), [14]);
});

test("replacing a club mate frees a club slot", () => {
  const r = replaceOptions({ out: squad[1], outXp: 4, squad, pool, bank: 0, horizon: 1 });
  assert.ok(r.some((o) => o.player.id === 12));
});

test("saved transfers change the squad and the bank", () => {
  const known = new Map<number, Known>([[11, { id: 11, team: "MCI", position: "MID", priceMillions: 8.5 }]]);
  const pending = [{ out: 1, in: 11 }];
  assert.equal(bankAfterPending(0.5, squad, pending, known), 0);
  assert.equal(squadAfterPending(squad, pending, known)[0].id, 11);
});
