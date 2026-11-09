import { test } from "node:test";
import assert from "node:assert/strict";
import { risksForGameweek } from "@/lib/availability";

const base = { status: "a" as const, chance: null, news: null };
const ban = { kind: "suspension_risk", gameweek: null, notes: "4 yellow cards." };
const loan16 = { kind: "loan_ineligible", gameweek: 16, notes: "Loan GW16." };
const loan27 = { kind: "loan_ineligible", gameweek: 27, notes: "Loan GW27." };

test("risksForGameweek keeps undated and same-gameweek risks only", () => {
  const a = { ...base, risks: [ban, loan16, loan27] };
  assert.deepEqual(risksForGameweek(a, 16), [ban, loan16]);
  assert.deepEqual(risksForGameweek(a, 10), [ban]);
});

test("risksForGameweek tolerates old forecasts with no risks field", () => {
  assert.deepEqual(risksForGameweek(base, 10), []);
  assert.deepEqual(risksForGameweek(null, 10), []);
});
