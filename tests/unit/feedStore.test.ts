/* eslint-disable @typescript-eslint/no-explicit-any */
import { test } from "node:test";
import assert from "node:assert/strict";
import { FEED_KEEP, FEED_MAX_AGE_MS, pruneFeed } from "../../src/lib/feedStore.ts";

const item = (at: number, id = 1): any => ({ key: `k${at}${id}`, id, name: "P", what: ["scored"], delta: 4, minutes: 30, at });

test("keeps recent events and drops old ones", () => {
  const now = 10_000_000;
  const out = pruneFeed([item(now - 1000), item(now - FEED_MAX_AGE_MS - 1)], now);
  assert.equal(out.length, 1);
});

test("caps the length", () => {
  const now = 10_000_000;
  const many = Array.from({ length: FEED_KEEP + 5 }, (_, i) => item(now - i, i));
  assert.equal(pruneFeed(many, now).length, FEED_KEEP);
});

test("ignores malformed storage", () => {
  assert.deepEqual(pruneFeed("nope", 1), []);
  assert.deepEqual(pruneFeed([{ key: 1 }, null, 5], 1), []);
});
