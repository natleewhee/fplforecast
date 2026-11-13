import test from "node:test";
import assert from "node:assert/strict";
import { initialTeamMode } from "@/lib/teamMode";

const deadline = "2026-11-14T11:00:00Z";
const before = Date.parse(deadline) - 60_000;
const after = Date.parse(deadline) + 60_000;

test("opens on Next while the deadline is ahead and Now once it has passed", () => {
  assert.equal(initialTeamMode("", deadline, before), "next");
  assert.equal(initialTeamMode("", deadline, after), "now");
});

test("old ?tab=live and ?tab=squad links still pick their half", () => {
  assert.equal(initialTeamMode("?tab=live", deadline, before), "now");
  assert.equal(initialTeamMode("?tab=squad", deadline, after), "next");
  assert.equal(initialTeamMode("?tab=scenarios", deadline, before), "next");
});

test("no or unreadable deadline opens on Now", () => {
  assert.equal(initialTeamMode("", null, before), "now");
  assert.equal(initialTeamMode("", "soon", before), "now");
});
