import { test } from "node:test";
import assert from "node:assert/strict";
import { compact, hasPriceData, priceRow, priceSignal } from "@/lib/priceWatch";

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
  assert.match(priceRow([{ webName: "A", priceWatch: w(3) }]).detail, /none of your 1 near a price change/);
});

test("priceRow quotes falls and rises; only fallers that moved are named, the rest counted", () => {
  const r = priceRow([
    { webName: "Raya", priceWatch: w(96.5, { netTransfers: 24380 }) },
    { webName: "Anderson", priceWatch: w(-99.3, { netTransfers: -4602 }) },
    { webName: "Gabriel", priceWatch: w(11.8, { changeThisGw: 1 }) },
    { webName: "Konsa", priceWatch: w(5, { changeThisGw: 1 }) },
    { webName: "King", priceWatch: w(-5, { changeThisGw: -1 }) },
  ]);
  assert.equal(r.status, "amber");
  assert.match(r.detail, /Anderson \(-99\.3%, -5k net transfers this GW\) price may fall\./);
  assert.match(r.detail, /Raya \(\+96\.5%, \+24k net transfers this GW\) price may rise\./);
  assert.match(r.detail, /Already fell this GW: King\./);
  assert.match(r.detail, /2 others moved this GW\./);
  assert.doesNotMatch(r.detail, /Gabriel|Konsa/);
});

test("movers do not hide the 'none near' state, and missing data is counted", () => {
  const r = priceRow([
    { webName: "A", priceWatch: w(3, { changeThisGw: 1 }) },
    { webName: "B", priceWatch: w(0) },
    { webName: "C", priceWatch: null },
  ]);
  assert.equal(r.status, "ok");
  assert.match(r.detail, /none of your 2 near a price change\./);
  assert.match(r.detail, /1 other moved this GW\./);
  assert.match(r.detail, /No price data for 1\./);
});

test("compact rounds to sensible units", () => {
  assert.equal(compact(950), "+950");
  assert.equal(compact(9960), "+10k");
  assert.equal(compact(-4602), "-5k");
  assert.equal(compact(999_999), "+1.0m");
  assert.equal(compact(1_240_000), "+1.2m");
});
