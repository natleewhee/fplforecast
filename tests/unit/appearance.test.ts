import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  NEUTRAL,
  SKIN_STEPS,
  TYPICAL_CM,
  kitFor,
  resolveAppearance,
  reviewRank,
  unverified,
  type KitTable,
} from "../../src/lib/appearance.ts";

const root = join(import.meta.dirname, "..", "..");

test("with no data a player gets a typical height for his position and a neutral look", () => {
  const r = resolveAppearance("GKP");
  assert.deepEqual(r.cm, { value: TYPICAL_CM.GKP, state: "default" });
  assert.deepEqual(r.skin, { value: NEUTRAL.skin, state: "default" });
  assert.deepEqual(r.hair, { value: NEUTRAL.hair, state: "default" });
  assert.equal(unverified(r), 3);
});

test("a script's values count as auto, and a hand-checked value always beats them", () => {
  const auto = { cm: 188, skin: 1, hair: { style: "crop" as const, color: "#112233" } };
  const override = { cm: 190, hair: { style: "bun" as const, color: "#d9b36a" } };
  const r = resolveAppearance("DEF", auto, override);
  assert.deepEqual(r.cm, { value: 190, state: "verified" });
  assert.deepEqual(r.skin, { value: 1, state: "auto" }); // nothing overrides skin
  assert.deepEqual(r.hair, { value: override.hair, state: "verified" });
  assert.equal(unverified(r), 1);
});

test("invalid values are ignored rather than trusted", () => {
  const r = resolveAppearance("MID", { cm: 20, skin: 9, hair: { style: "mohawk" as never, color: "red" } }, { cm: Number.NaN, skin: 1.5 });
  assert.equal(r.cm.state, "default");
  assert.equal(r.skin.state, "default");
  assert.equal(r.hair.state, "default");
  assert.equal(r.cm.value, TYPICAL_CM.MID);
});

test("null in an override leaves that trait a guess", () => {
  const r = resolveAppearance("DEF", undefined, { cm: null as never, skin: null as never, hair: null as never });
  assert.equal(r.cm.state, "default");
  assert.equal(r.skin.state, "default");
  assert.equal(r.hair.state, "default");
});

test("an invalid override falls back to the script's value, not the default", () => {
  const r = resolveAppearance("FWD", { cm: 185 }, { cm: 999 });
  assert.deepEqual(r.cm, { value: 185, state: "auto" });
});

test("review order puts guesses first, then script values, then checked players", () => {
  const guess = resolveAppearance("MID");
  const measured = resolveAppearance("MID", { cm: 180, skin: 2, hair: { style: "crop", color: "#000000" } });
  const checked = resolveAppearance("MID", undefined, { cm: 180, skin: 2, hair: { style: "crop", color: "#000000" } });
  assert.ok(reviewRank(guess) > reviewRank(measured));
  assert.ok(reviewRank(measured) > reviewRank(checked));
  assert.equal(reviewRank(checked), 0);
});

test("goalkeepers wear the goalkeeper kit, everyone else the home kit", () => {
  const table: KitTable = {
    season: "x", approximate: true, note: "",
    clubs: { ARS: { shirt: "#e0343b", shorts: "#f2f2f2", socks: "#e0343b", gk: { shirt: "#e6c229", shorts: "#1a2733", socks: "#e6c229" } } },
  };
  assert.equal(kitFor(table, "ARS", "GKP")?.shirt, "#e6c229");
  assert.equal(kitFor(table, "ARS", "DEF")?.shirt, "#e0343b");
  assert.equal(kitFor(table, "ZZZ", "DEF"), null);
});

test("kits.json covers every club in the newest snapshot, with valid colours and a keeper kit that differs", () => {
  const table = JSON.parse(readFileSync(join(root, "data", "kits.json"), "utf8")) as KitTable;
  const dir = join(root, "data", "bootstrap-static");
  const newest = readdirSync(dir).filter((f) => f.endsWith(".json")).sort().pop()!;
  const teams = (JSON.parse(readFileSync(join(dir, newest), "utf8")) as { teams: { short_name: string }[] }).teams.map((t) => t.short_name);
  const hex = /^#[0-9a-f]{6}$/i;
  for (const team of teams) {
    const c = table.clubs[team];
    assert.ok(c, `kits.json is missing ${team}`);
    for (const part of [c, c.gk]) for (const k of ["shirt", "shorts", "socks"] as const) assert.match(part[k], hex, `${team} ${k}`);
    assert.notEqual(c.gk.shirt.toLowerCase(), c.shirt.toLowerCase(), `${team} keeper shirt matches the outfield shirt`);
  }
});

test("the stored appearance files only hold values the rules accept", () => {
  for (const file of ["players.json", "overrides.json"]) {
    const data = JSON.parse(readFileSync(join(root, "data", "appearance", file), "utf8")) as { players: Record<string, object> };
    for (const [code, rec] of Object.entries(data.players)) {
      const r = resolveAppearance("MID", rec, undefined);
      const given = Object.keys(rec).filter((k) => ["cm", "skin", "hair"].includes(k));
      for (const k of given) assert.equal((r as unknown as Record<string, { state: string }>)[k].state, "auto", `${file} ${code}.${k} is invalid`);
    }
  }
  assert.equal(SKIN_STEPS.length, 6);
});
