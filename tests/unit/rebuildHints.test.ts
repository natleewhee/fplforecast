import { test } from "node:test";
import assert from "node:assert/strict";
import { refusalHint } from "../../src/lib/rebuildHints.ts";

test("a permission refusal says which permission to add", () => {
  assert.match(refusalHint(403), /Actions: Read and write/);
  assert.match(refusalHint(404), /Actions: Read and write/);
});

test("a bad token and a missing workflow are told apart", () => {
  assert.match(refusalHint(401), /GITHUB_TOKEN/);
  assert.match(refusalHint(422), /workflow/);
});

test("anything else still names the status", () => {
  assert.match(refusalHint(500), /HTTP 500/);
});
