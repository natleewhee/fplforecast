import { test } from "node:test";
import assert from "node:assert/strict";
import { hasPriceData, priceRow, priceSignal } from "@/lib/priceWatch";

const w = (percent: number, o: Record<string, number | null> = {}) => ({
  percent, likelihood: 0, hourlyRate: 0, changeThisGw: 0, netTransfers: null, ...o,
});

test("priceSignal flags near +/-100 or a +/-4 bucket only", () => {
  assert.equal(priceSignal(w(95.7)), "rise");
  assert.equal(priceSignal(w(-90)), "fall");
  assert.equal(priceSignal(w(40, { likelihood: 4 })), "rise");
  assert.equal(priceSignal(w(-40, { likelihood: -5 })), "fall");
  assert.equal(priceSignal(w(82.6, { likelihood: 3 })), null);
  assert.equal(priceSignal(null), null);
  assert.equal(priceSignal(undefined), null);
  assert.equal(priceSignal(w(NaN)), null);
});

test("hasPriceData tells a missing field from FPL's quiet squad", () => {
  assert.equal(hasPriceData([{}, { priceWatch: null }]), false);
  assert.equal(hasPriceData([{}, { priceWatch: w(0) }]), true);
});

test("priceRow is neutral when the build has no price data", () => {
  const r = priceRow([{ webName: "A" }]);
  assert.equal(r.status, "info");
  assert.match(r.detail, /Not in this build yet/);
  assert.doesNotMatch(r.detail, /none of your/);
});

test("priceRow says none near when the data is there and quiet", () => {
  assert.match(priceRow([{ webName: "A", priceWatch: w(3) }]).detail, /none of your 15 near a price change/);
});

test("priceRow quotes falls and rises, with net transfers and moves", () => {
  const r = priceRow([
    { webName: "Raya", priceWatch: w(96.5, { netTransfers: 24380 }) },
    { webName: "Anderson", priceWatch: w(-99.3, { netTransfers: -4602 }) },
    { webName: "Gabriel", priceWatch: w(11.8, { changeThisGw: 1 }) },
  ]);
  assert.equal(r.status, "amber");
  assert.match(r.detail, /FPL data suggests Anderson \(-99.3%, -4\.6k net transfers this GW\) may fall\./);
  assert.match(r.detail, /FPL data suggests Raya \(\+96.5%, \+24k net transfers this GW\) may rise\./);
  assert.match(r.detail, /Already moved this GW: Gabriel \+£0\.1m\./);
});
