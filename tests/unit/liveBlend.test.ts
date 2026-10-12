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
