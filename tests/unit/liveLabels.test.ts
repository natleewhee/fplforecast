import { test } from "node:test";
import assert from "node:assert/strict";
import { eventCounts, parseOpponent, sgKickoff, totalEvents, visibleBreakdown } from "../../src/lib/liveLabels.ts";

const line = (identifier: string, points: number, value: number) => ({ identifier, points, value });

test("event counts read goals, assists and cards from FPL's breakdown", () => {
  const c = eventCounts([line("minutes", 2, 90), line("goals_scored", 10, 2), line("assists", 3, 1), line("yellow_cards", -1, 1)]);
  assert.equal(c.goals, 2);
  assert.equal(c.assists, 1);
  assert.equal(c.yellow, 1);
  assert.equal(totalEvents(c), 4);
});

test("a clean sheet or defcon only counts when it earned points", () => {
  const forward = eventCounts([line("clean_sheets", 0, 1)]);
  assert.equal(forward.cleanSheet, 0);
  const defender = eventCounts([line("clean_sheets", 4, 1), line("defensive_contribution", 2, 1)]);
  assert.equal(defender.cleanSheet, 1);
  assert.equal(defender.defcon, 1);
});

test("the breakdown hides zero-point lines except minutes", () => {
  const shown = visibleBreakdown([line("minutes", 0, 0), line("saves", 0, 1), line("bonus", 2, 2)]);
  assert.deepEqual(shown.map((b) => b.identifier), ["minutes", "bonus"]);
});

test("kickoff time is shown in Singapore time", () => {
  assert.equal(sgKickoff("2026-10-11T15:30:00Z"), "Sun 23:30");
  assert.equal(sgKickoff(null), "—");
});

test("opponent strings parse into club and home/away", () => {
  assert.deepEqual(parseOpponent("MCI (H)"), { team: "MCI", home: true });
  assert.deepEqual(parseOpponent("TOT (A)"), { team: "TOT", home: false });
  assert.equal(parseOpponent(null), null);
});
