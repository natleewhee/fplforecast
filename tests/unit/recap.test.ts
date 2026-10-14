import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRecap, rankMove, regretCopy, type RecapInputs } from "../../src/lib/recap.ts";

const pick = (element: number, position: number, o: Record<string, unknown> = {}) => ({
  element,
  position,
  multiplier: position <= 11 ? 1 : 0,
  is_captain: false,
  ...o,
});

function base(over: Partial<RecapInputs> = {}): RecapInputs {
  const picks = [
    pick(1, 1),
    ...[2, 3, 4, 5].map((e) => pick(e, e)),
    ...[6, 7, 8, 9].map((e) => pick(e, e)),
    pick(10, 10, { is_captain: true, multiplier: 2 }),
    pick(11, 11),
    pick(12, 12),
    pick(13, 13),
    pick(14, 14),
    pick(15, 15),
  ];
  return {
    gameweek: 7,
    picks: { picks, active_chip: null },
    rawPoints: { 1: 2, 2: 2, 3: 2, 4: 2, 5: 2, 6: 2, 7: 2, 8: 2, 9: 12, 10: 3, 11: 1, 12: 9, 13: 2, 14: 0, 15: 0 },
    minutes: Object.fromEntries(Array.from({ length: 15 }, (_, i) => [i + 1, 90])),
    players: Object.fromEntries(
      Array.from({ length: 15 }, (_, i) => [i + 1, { name: `P${i + 1}`, ownedPct: i + 1 === 9 ? 3.2 : 30 }]),
    ),
    history: [
      { event: 6, points: 50, overall_rank: 500_000, event_transfers_cost: 0, points_on_bench: 0 },
      { event: 7, points: 40, overall_rank: 400_000, event_transfers_cost: 4, points_on_bench: 11 },
    ],
    transfers: [{ event: 7, element_in: 11, element_out: 9 }],
    averageScore: 45,
    ...over,
  };
}

test("reports rank movement and totals", () => {
  const r = buildRecap(base());
  assert.equal(r.points, 40);
  assert.equal(r.hit, 4);
  assert.equal(rankMove(r), "▲ 100,000 places");
});

test("best, worst and captain come from actual points", () => {
  const r = buildRecap(base());
  assert.deepEqual(r.best, { name: "P9", points: 12 });
  assert.equal(r.worst?.points, 1);
  assert.deepEqual(r.captain, { name: "P10", raw: 3, multiplier: 2 });
});

test("awards a differential and bench regret", () => {
  const ids = buildRecap(base()).achievements.map((a) => a.id);
  assert.ok(ids.includes("differential-9"));
  assert.ok(ids.includes("bench-regret"));
});

test("a hit that bought fewer points than it cost did not pay", () => {
  const ids = buildRecap(base()).achievements.map((a) => a.id);
  assert.ok(ids.includes("hit-failed"));
  assert.ok(!ids.includes("hit-paid"));
});

test("a hit that paid off is recognised", () => {
  const r = buildRecap(base({ transfers: [{ event: 7, element_in: 9, element_out: 11 }] }));
  assert.ok(r.achievements.some((a) => a.id === "hit-paid"));
});

test("captain regret multiplies the gap by the armband", () => {
  const r = buildRecap(base());
  const cap = r.regrets.find((x) => x.id === "captain");
  assert.equal(cap?.points, (12 - 3) * 2);
});

test("bench boost regret disappears when the chip was played", () => {
  const b = base();
  b.picks.active_chip = "bboost";
  assert.ok(!buildRecap(b).regrets.some((x) => x.id === "bench-boost"));
});

test("keep-the-sold-player regret only when they outscored the buy", () => {
  const r = buildRecap(base());
  assert.equal(r.regrets.find((x) => x.id === "keep-9")?.points, 11);
  assert.ok(regretCopy({ id: "x", text: "If", points: 12 }).includes("replay"));
});
