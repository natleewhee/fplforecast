import { test } from "node:test";
import assert from "node:assert/strict";
import { ageText, staleness, STALE_AFTER_MS } from "../../src/lib/staleness.ts";

const base = { lastOkMs: 1_000_000, nowMs: 1_000_000, active: true, error: null, online: true };

test("ageText reads naturally", () => {
  assert.equal(ageText(10_000), "just now");
  assert.equal(ageText(3 * 60_000), "3 min ago");
  assert.equal(ageText(75 * 60_000), "1h 15m ago");
});

test("fresh numbers are ok", () => {
  assert.equal(staleness(base).level, "ok");
});

test("goes stale only while live and past the threshold", () => {
  const late = { ...base, nowMs: base.lastOkMs + STALE_AFTER_MS + 1000 };
  assert.equal(staleness(late).level, "stale");
  assert.equal(staleness({ ...late, active: false }).level, "ok");
});

test("an error beats stale, and offline beats an error", () => {
  const late = { ...base, nowMs: base.lastOkMs + STALE_AFTER_MS + 1000 };
  assert.equal(staleness({ ...late, error: "HTTP 502" }).level, "error");
  assert.equal(staleness({ ...late, error: "x", online: false }).level, "offline");
});

test("says so when nothing has loaded yet", () => {
  assert.ok(staleness({ ...base, lastOkMs: null, error: "x" }).text.includes("no update yet"));
});
