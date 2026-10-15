import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildTracker, isFixtureOver, type LivePayload } from "../../src/lib/liveBlend.ts";

const here = dirname(fileURLToPath(import.meta.url));
const load = (name: string): LivePayload =>
  JSON.parse(readFileSync(join(here, "..", "e2e", "fixtures", name), "utf8"));

test("a match is over once FPL says finished or finished_provisional", () => {
  assert.equal(isFixtureOver({ finished: true }), true);
  assert.equal(isFixtureOver({ finished: false, finished_provisional: true }), true); // the bug that hid full time
  assert.equal(isFixtureOver({ finished: false, finished_provisional: false }), false);
  assert.equal(isFixtureOver(undefined), false);
});

test("players whose match is provisionally over show as finished, with bonus still due", () => {
  const rows = new Map(buildTracker(load("live-a.json"), null).rows.map((r) => [r.webName, r]));
  for (const name of ["Palmer", "King"]) {
    assert.equal(rows.get(name)?.status, "finished", `${name} is full time`);
    assert.equal(rows.get(name)?.bonusPending, true, `${name} bonus not confirmed yet`);
  }
  assert.equal(rows.get("Saka")?.bonusPending, false); // that match is fully confirmed
  assert.equal(rows.get("Van Dijk")?.status, "playing");
  assert.equal(rows.get("Porro")?.status, "notStarted");
});

test("the captain's points are doubled and counted once", () => {
  const view = buildTracker(load("live-a.json"), null);
  const captain = view.rows.find((r) => r.isArmband);
  assert.equal(captain?.webName, "Saka");
  assert.equal(captain?.pointsSoFar, 8); // 4 raw x 2
});

test("the second poll's goal shows up in the breakdown and the points", () => {
  const before = buildTracker(load("live-a.json"), null).rows.find((r) => r.webName === "Palmer");
  const after = buildTracker(load("live-b.json"), load("live-a.json")).rows.find((r) => r.webName === "Palmer");
  assert.equal((after?.pointsSoFar ?? 0) - (before?.pointsSoFar ?? 0), 5);
  assert.ok(after?.breakdown.some((b) => b.identifier === "goals_scored"));
});

/* eslint-disable @typescript-eslint/no-explicit-any */
import { benchCover } from "../../src/lib/liveBlend.ts";

test("benchCover: names who comes on if a pending starter doesn't play", () => {
  // 1 GK, 4 DEF (2-5), 4 MID (6-9), 2 FWD (10-11); bench: GK 12, DEF 13, MID 14, FWD 15
  const pos: Record<number, any> = { 1: "GKP", 12: "GKP", 13: "DEF", 14: "MID", 15: "FWD" };
  for (const i of [2, 3, 4, 5]) pos[i] = "DEF";
  for (const i of [6, 7, 8, 9]) pos[i] = "MID";
  for (const i of [10, 11]) pos[i] = "FWD";
  const starters = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const status: Record<number, any> = Object.fromEntries([...starters, 12, 13, 14, 15].map((i) => [i, "notStarted"]));
  const cover = benchCover(starters, [12, 13, 14, 15], status, pos);
  assert.equal(cover.length, 11);
  assert.equal(cover.find((c) => c.outId === 1)?.inId, 12); // keeper covered only by the bench keeper
  assert.equal(cover.find((c) => c.outId === 6)?.inId, 13); // first legal outfield sub in bench order
});

test("benchCover: no cover when the only legal sub didn't play, and finished starters are skipped", () => {
  const pos: Record<number, any> = { 1: "GKP", 12: "GKP", 13: "DEF" };
  for (const i of [2, 3, 4]) pos[i] = "DEF";
  for (const i of [5, 6, 7, 8, 9]) pos[i] = "MID";
  for (const i of [10]) pos[i] = "FWD";
  pos[11] = "MID";
  const starters = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const status: Record<number, any> = Object.fromEntries(starters.map((i) => [i, "notStarted"]));
  status[12] = "didNotPlay";
  status[13] = "didNotPlay";
  status[2] = "finished";
  const cover = benchCover(starters, [12, 13], status, pos);
  assert.ok(!cover.some((c) => c.outId === 2)); // already played, nothing to cover
  assert.equal(cover.find((c) => c.outId === 1)?.inId, null); // bench keeper didn't play
});
