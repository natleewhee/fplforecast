import test from "node:test";
import assert from "node:assert/strict";
import { squadSync, usableLiveSquad } from "@/lib/squadSync";

const model = [
  { id: 1, position: "GKP", webName: "Kinsky" },
  { id: 2, position: "DEF", webName: "Hall" },
  { id: 3, position: "DEF", webName: "Konsa" },
  { id: 4, position: "MID", webName: "Palmer" },
  { id: 5, position: "FWD", webName: "Haaland" },
];
const pool = [
  { id: 1, position: "GKP", webName: "Kinsky" },
  { id: 2, position: "DEF", webName: "Hall" },
  { id: 3, position: "DEF", webName: "Konsa" },
  { id: 4, position: "MID", webName: "Palmer" },
  { id: 5, position: "FWD", webName: "Haaland" },
  { id: 6, position: "DEF", webName: "Van Hecke" },
  { id: 7, position: "MID", webName: "Saka" },
  { id: 8, position: "FWD", webName: "Gonzalo" },
];

test("nothing changed: nothing to correct", () => {
  assert.deepEqual(squadSync(model, model, pool), { swaps: [], unresolved: [] });
});

test("the live squad is not loaded: nothing to correct", () => {
  assert.deepEqual(squadSync(model, null, pool), { swaps: [], unresolved: [] });
  assert.deepEqual(squadSync(model, [], pool), { swaps: [], unresolved: [] });
});

test("a transfer is paired by position: Hall out, Van Hecke in", () => {
  const live = model.map((p) => (p.id === 2 ? { id: 6, position: "DEF", webName: "Van Hecke" } : p));
  const r = squadSync(model, live, pool);
  assert.equal(r.swaps.length, 1);
  assert.equal(r.swaps[0].outId, 2);
  assert.equal(r.swaps[0].outName, "Hall");
  assert.equal(r.swaps[0].incoming.webName, "Van Hecke");
  assert.deepEqual(r.unresolved, []);
});

test("two transfers at different positions are each paired with their own position", () => {
  const live = model.map((p) => (p.id === 2 ? { id: 6, position: "DEF", webName: "Van Hecke" } : p.id === 4 ? { id: 7, position: "MID", webName: "Saka" } : p));
  const r = squadSync(model, live, pool);
  assert.deepEqual(r.swaps.map((s) => [s.outName, s.incoming.webName]).sort(), [["Hall", "Van Hecke"], ["Palmer", "Saka"]]);
});

test("a player the model has no projections for cannot be shown and is reported, and his leaver stays", () => {
  const live = model.map((p) => (p.id === 2 ? { id: 999, position: "DEF", webName: "Newcomer" } : p));
  const r = squadSync(model, live, pool);
  assert.deepEqual(r.swaps, []);
  assert.deepEqual(r.unresolved, ["Newcomer"]);
});

test("a position mismatch (cannot pair) is reported, never forced into the wrong slot", () => {
  const live = model.map((p) => (p.id === 2 ? { id: 8, position: "FWD", webName: "Gonzalo" } : p));
  const r = squadSync(model, live, pool);
  assert.deepEqual(r.swaps, []);
  assert.deepEqual(r.unresolved, ["Gonzalo"]);
});

test("a live squad is only used when it is for a gameweek after the one the model was built from", () => {
  const feed = (gameweek: number, chip: string | null = null) => ({ gameweek, chip, squad: model });
  assert.equal(usableLiveSquad(feed(10), 9), model);
  assert.equal(usableLiveSquad(feed(9), 9), null, "same gameweek: not newer, it would only undo saved transfers");
  assert.equal(usableLiveSquad(feed(8), 9), null);
  assert.equal(usableLiveSquad(feed(10, "freehit"), 9), null, "a Free Hit squad lasts one gameweek");
  assert.equal(usableLiveSquad(feed(10, "wildcard"), 9), model, "a wildcard is a real change of squad");
  assert.equal(usableLiveSquad(null, 9), null);
  assert.equal(usableLiveSquad({ gameweek: 10, chip: null, squad: [] }, 9), null);
});
