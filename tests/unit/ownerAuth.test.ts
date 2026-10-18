import { test } from "node:test";
import assert from "node:assert/strict";
import { secretMatches } from "../../src/lib/ownerAuth.ts";

test("a missing secret setting locks everyone out", () => {
  assert.equal(secretMatches("anything", ""), false);
  assert.equal(secretMatches("anything", undefined), false);
});

test("only the exact secret unlocks", () => {
  assert.equal(secretMatches("s3cret", "s3cret"), true);
  assert.equal(secretMatches("s3cre", "s3cret"), false);
  assert.equal(secretMatches("", "s3cret"), false);
  assert.equal(secretMatches(undefined, "s3cret"), false);
});
