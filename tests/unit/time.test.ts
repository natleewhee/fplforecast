import { test } from "node:test";
import assert from "node:assert/strict";
import { ageText, clockTime, countdown, describeAge, forecastAgeHours } from "../../src/lib/time.ts";

const NOW = Date.parse("2026-10-17T12:00:00Z");

test("countdown reads in the largest sensible units", () => {
  assert.equal(countdown("2026-10-19T14:30:00Z", NOW), "2d 2h");
  assert.equal(countdown("2026-10-17T15:05:00Z", NOW), "3h 5m");
  assert.equal(countdown("2026-10-17T12:09:00Z", NOW), "9m");
  assert.equal(countdown("2026-10-17T11:00:00Z", NOW), "deadline passed");
});

test("forecast age: hours, then days from 48h, and bad dates give null", () => {
  assert.equal(forecastAgeHours("2026-10-17T00:00:00Z", NOW), 12);
  assert.equal(forecastAgeHours("not a date", NOW), null);
  assert.equal(describeAge(12.9), "12 hours");
  assert.equal(describeAge(49), "2 days");
});

test("ageText and clockTime handle the edges", () => {
  assert.equal(ageText(10_000), "just now");
  assert.equal(ageText(3 * 60_000), "3 min ago");
  assert.equal(clockTime(null), "—");
  assert.equal(clockTime("nonsense"), "—");
  assert.ok(clockTime("2026-10-17T12:00:00Z").length > 3);
});
