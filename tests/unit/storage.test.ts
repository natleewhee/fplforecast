import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readItem, readJson, removeItem, writeItem, writeJson } from "../../src/lib/storage.ts";

const g = globalThis as unknown as { localStorage?: unknown };

function fakeStorage(data = new Map<string, string>()) {
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

beforeEach(() => {
  g.localStorage = fakeStorage();
});

test("round-trips strings and json", () => {
  writeItem("a", "x");
  assert.equal(readItem("a"), "x");
  writeJson("j", { n: 1 });
  assert.deepEqual(readJson("j", null), { n: 1 });
  removeItem("a");
  assert.equal(readItem("a"), null);
});

test("missing or corrupt json gives the fallback", () => {
  assert.deepEqual(readJson("nope", [1]), [1]);
  writeItem("bad", "{not json");
  assert.deepEqual(readJson("bad", "fallback"), "fallback");
});

test("blocked storage never throws", () => {
  const boom = () => {
    throw new Error("blocked");
  };
  g.localStorage = { getItem: boom, setItem: boom, removeItem: boom };
  assert.equal(readItem("a"), null);
  assert.equal(readJson("a", 5), 5);
  assert.doesNotThrow(() => writeItem("a", "x"));
  assert.doesNotThrow(() => writeJson("a", 1));
  assert.doesNotThrow(() => removeItem("a"));
});

test("missing storage (server render) never throws", () => {
  delete g.localStorage;
  assert.equal(readItem("a"), null);
  assert.doesNotThrow(() => writeItem("a", "x"));
});
