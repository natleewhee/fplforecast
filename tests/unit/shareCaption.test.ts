import { test } from "node:test";
import assert from "node:assert/strict";
import { CAPTIONS, captionType, pickCaption } from "../../src/lib/shareCaption.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
const recap = (o: any = {}): any => ({ points: 50, averageScore: 50, achievements: [], ...o });
const badge = (id: string) => ({ id });

test("every pool has at least five captions and none is empty", () => {
  for (const [type, lines] of Object.entries(CAPTIONS)) {
    assert.ok(lines.length >= 5, `${type} has ${lines.length}`);
    assert.ok(lines.every((l) => l.trim().length > 0));
  }
});

test("no caption repeats the card's own words or numbers", () => {
  for (const lines of Object.values(CAPTIONS)) {
    for (const l of lines) assert.ok(!/\d/.test(l), l);
  }
});

test("the worst story picks the pool", () => {
  assert.equal(captionType(recap({ achievements: [badge("bench-regret"), badge("captain-blank")] })), "captainBlank");
  assert.equal(captionType(recap({ achievements: [badge("hit-failed"), badge("bench-regret")] })), "hitFailed");
  assert.equal(captionType(recap({ achievements: [badge("hit-paid")] })), "hitPaid");
});

test("without badges the tier picks the pool", () => {
  assert.equal(captionType(recap({ points: 80 })), "bigWeek");
  assert.equal(captionType(recap({ points: 55 })), "aboveAverage");
  assert.equal(captionType(recap({ points: 45 })), "belowAverage");
  assert.equal(captionType(recap({ points: 20 })), "badWeek");
});

test("recently used captions are skipped while others remain", () => {
  const r = recap({ points: 80 });
  const recent = CAPTIONS.bigWeek.slice(0, 5).map((_, i) => `bigWeek:${i}`);
  for (let k = 0; k < 20; k++) assert.equal(pickCaption(r, recent, () => k / 20).id, "bigWeek:5");
});

test("when everything was used recently it still returns a caption", () => {
  const r = recap({ points: 80 });
  const all = CAPTIONS.bigWeek.map((_, i) => `bigWeek:${i}`);
  assert.ok(pickCaption(r, all).text.length > 0);
});
