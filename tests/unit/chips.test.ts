import { test } from "node:test";
import assert from "node:assert/strict";
import { bestWithinWindow, chipChecklist, chipState } from "../../src/lib/chips.ts";

type W = { name: string; window: { start: number; stop: number }; used: boolean; availableNow: boolean; expiresGw: number };

/** Mirrors compute_chip_status (Python) for this season's rules: two of each
 * chip, GW1-19 and GW20-38. `played` = the team's own history chips. */
function windows(targetGw: number, played: { name: string; event: number }[]): W[] {
  const defs: [string, number, number][] = [];
  for (const n of ["wildcard", "freehit"]) defs.push([n, 2, 19], [n, 20, 38]);
  for (const n of ["bboost", "3xc"]) defs.push([n, 1, 19], [n, 20, 38]);
  return defs.map(([name, start, stop]) => {
    const used = played.some((p) => p.name === name && p.event >= start && p.event <= stop);
    return { name, window: { start, stop }, used, availableNow: !used && targetGw >= start && targetGw <= stop, expiresGw: stop };
  });
}

const OWNER = [
  { name: "wildcard", event: 4 },
  { name: "bboost", event: 7 },
];

test("owner at GW11: first-half Free Hit and Triple Captain, expiring GW19", () => {
  const row = chipChecklist(windows(11, OWNER), 11);
  assert.equal(
    row.detail,
    "2 first-half chips left (Free Hit, Triple Captain); use by GW19 (8 GWs). Wildcard, Bench Boost used, next from GW20.",
  );
  assert.equal(row.status, "info");
  assert.ok(!/manager/i.test(row.detail));
});

test("GW19 is the last chance for the first-half chips", () => {
  const row = chipChecklist(windows(19, OWNER), 19);
  assert.match(row.detail, /use this week \(last chance, GW19\)/);
  assert.equal(row.status, "amber");
});

test("GW20 reopens second-half chips, wildcard and Bench Boost included", () => {
  const row = chipChecklist(windows(20, OWNER), 20);
  assert.equal(
    row.detail,
    "4 second-half chips left (Wildcard, Free Hit, Bench Boost, Triple Captain); use by GW38 (18 GWs).",
  );
  assert.equal(row.status, "info");
  assert.deepEqual(chipState(windows(20, OWNER), "wildcard", 20), { kind: "open", expiresGw: 38 });
});

test("a guest's chips follow their own history", () => {
  const guest = [{ name: "freehit", event: 3 }, { name: "3xc", event: 9 }, { name: "wildcard", event: 25 }];
  const row = chipChecklist(windows(11, guest), 11);
  assert.match(row.detail, /^2 first-half chips left \(Wildcard, Bench Boost\)/);
  assert.match(row.detail, /Free Hit, Triple Captain used, next from GW20/);
  assert.deepEqual(chipState(windows(26, guest), "wildcard", 26), { kind: "closed", usedNow: true, nextFromGw: null });
});

test("unknown chips are shown as unknown, never guessed", () => {
  assert.equal(chipChecklist(null, 11).detail, "Chip status unavailable right now.");
  assert.equal(chipChecklist(undefined, 11).detail, "Chip status unavailable right now.");
  assert.deepEqual(chipState(null, "bboost", 11), { kind: "unknown" });
  assert.deepEqual(chipState(windows(11, []), "manager", 11), { kind: "unknown" });
});

test("Bench Boost / Triple Captain timing stays at or before the chip's last gameweek", () => {
  const ranked = [{ gameweek: 21 }, { gameweek: 19 }, { gameweek: 20 }];
  // window ends GW19 at GW19: only GW19 is eligible even though GW21 ranked best
  const at19 = bestWithinWindow(ranked, 19, 21);
  assert.equal(at19?.pick.gameweek, 19);
  // forecast horizon ends GW21 and the window runs to GW38: flag the unseen weeks
  const at20 = bestWithinWindow(ranked, 38, 21);
  assert.equal(at20?.pick.gameweek, 21);
  assert.equal(at20?.seesAllOfWindow, false);
  // GW11, window to GW19, forecast sees GW11-15
  const at11 = bestWithinWindow([{ gameweek: 13 }, { gameweek: 11 }], 19, 15);
  assert.equal(at11?.seesAllOfWindow, false);
  assert.equal(bestWithinWindow([{ gameweek: 22 }], 19, 22), null);
});
