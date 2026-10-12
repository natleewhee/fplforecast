import { test } from "node:test";
import assert from "node:assert/strict";
import { dedupeTransfers, sameTransfer } from "../../src/lib/transfers.ts";
import { countdown } from "../../src/lib/countdown.ts";

test("a repeated out/in pair is dropped, the first is kept", () => {
  const list = [{ out: 1, in: 2 }, { out: 1, in: 2, note: "again" }, { out: 3, in: 4 }];
  assert.deepEqual(dedupeTransfers(list), [{ out: 1, in: 2 }, { out: 3, in: 4 }]);
  assert.ok(sameTransfer({ out: 1, in: 2 }, { out: 1, in: 2, note: "x" }));
  assert.ok(!sameTransfer({ out: 1, in: 2 }, { out: 2, in: 1 }));
});

test("the countdown reads as days, hours or minutes, and says when it has passed", () => {
  const now = Date.parse("2026-10-11T00:00:00Z");
  assert.equal(countdown("2026-10-13T05:00:00Z", now), "2d 5h");
  assert.equal(countdown("2026-10-11T03:30:00Z", now), "3h 30m");
  assert.equal(countdown("2026-10-11T00:45:00Z", now), "45m");
  assert.equal(countdown("2026-10-10T23:00:00Z", now), "deadline passed");
});
