import { test } from "node:test";
import assert from "node:assert/strict";
import { commentate } from "../../src/lib/commentary.ts";

test("names the player and the points", () => {
  const line = commentate("Palmer", ["scored"], 5, "3:12");
  assert.ok(line.includes("Palmer"));
  assert.ok(line.endsWith("+5."));
});

test("the same event always reads the same", () => {
  assert.equal(commentate("Saka", ["assist"], 3, "k"), commentate("Saka", ["assist"], 3, "k"));
});

test("a multi-event update mentions the rest", () => {
  const line = commentate("Haaland", ["scored", "yellow card"], 3, "k");
  assert.ok(line.includes("also: yellow card"));
});

test("unknown events fall back to the plain list", () => {
  assert.equal(commentate("X", ["mystery"], 0, "k"), "X · mystery");
});

test("a negative swing shows a minus", () => {
  assert.ok(commentate("Y", ["red card"], -3, "k").includes("−3."));
});
