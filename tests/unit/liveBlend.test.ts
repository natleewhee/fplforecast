import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildLivePayload, buildTracker, hasStarted, isFixtureOver, type LivePayload } from "../../src/lib/liveBlend.ts";

const here = dirname(fileURLToPath(import.meta.url));
const load = (name: string): LivePayload =>
  JSON.parse(readFileSync(join(here, "..", "e2e", "fixtures", name), "utf8"));

test("a match is over once FPL says finished or finished_provisional", () => {
  assert.equal(isFixtureOver({ finished: true }), true);
  assert.equal(isFixtureOver({ finished: false, finished_provisional: true }), true); // the bug that hid full time
  assert.equal(isFixtureOver({ finished: false, finished_provisional: false }), false);
  assert.equal(isFixtureOver(undefined), false);
});

test("players whose match is provisionally over show as finished, with bonus still due", () => {
  const rows = new Map(buildTracker(load("live-a.json"), null).rows.map((r) => [r.webName, r]));
  for (const name of ["Palmer", "King"]) {
    assert.equal(rows.get(name)?.status, "finished", `${name} is full time`);
    assert.equal(rows.get(name)?.bonusPending, true, `${name} bonus not confirmed yet`);
  }
  assert.equal(rows.get("Saka")?.bonusPending, false); // that match is fully confirmed
  assert.equal(rows.get("Van Dijk")?.status, "playing");
  assert.equal(rows.get("Porro")?.status, "notStarted");
});

test("the captain's points are doubled and counted once", () => {
  const view = buildTracker(load("live-a.json"), null);
  const captain = view.rows.find((r) => r.isArmband);
  assert.equal(captain?.webName, "Saka");
  assert.equal(captain?.pointsSoFar, 8); // 4 raw x 2
});

test("the second poll's goal shows up in the breakdown and the points", () => {
  const before = buildTracker(load("live-a.json"), null).rows.find((r) => r.webName === "Palmer");
  const after = buildTracker(load("live-b.json"), load("live-a.json")).rows.find((r) => r.webName === "Palmer");
  assert.equal((after?.pointsSoFar ?? 0) - (before?.pointsSoFar ?? 0), 5);
  assert.ok(after?.breakdown.some((b) => b.identifier === "goals_scored"));
});

/* eslint-disable @typescript-eslint/no-explicit-any */
import { benchCover } from "../../src/lib/liveBlend.ts";

test("benchCover: names who comes on if a pending starter doesn't play", () => {
  // 1 GK, 4 DEF (2-5), 4 MID (6-9), 2 FWD (10-11); bench: GK 12, DEF 13, MID 14, FWD 15
  const pos: Record<number, any> = { 1: "GKP", 12: "GKP", 13: "DEF", 14: "MID", 15: "FWD" };
  for (const i of [2, 3, 4, 5]) pos[i] = "DEF";
  for (const i of [6, 7, 8, 9]) pos[i] = "MID";
  for (const i of [10, 11]) pos[i] = "FWD";
  const starters = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const status: Record<number, any> = Object.fromEntries([...starters, 12, 13, 14, 15].map((i) => [i, "notStarted"]));
  const cover = benchCover(starters, [12, 13, 14, 15], status, pos);
  assert.equal(cover.length, 11);
  assert.equal(cover.find((c) => c.outId === 1)?.inId, 12); // keeper covered only by the bench keeper
  assert.equal(cover.find((c) => c.outId === 6)?.inId, 13); // first legal outfield sub in bench order
});

test("benchCover: no cover when the only legal sub didn't play, and finished starters are skipped", () => {
  const pos: Record<number, any> = { 1: "GKP", 12: "GKP", 13: "DEF" };
  for (const i of [2, 3, 4]) pos[i] = "DEF";
  for (const i of [5, 6, 7, 8, 9]) pos[i] = "MID";
  for (const i of [10]) pos[i] = "FWD";
  pos[11] = "MID";
  const starters = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const status: Record<number, any> = Object.fromEntries(starters.map((i) => [i, "notStarted"]));
  status[12] = "didNotPlay";
  status[13] = "didNotPlay";
  status[2] = "finished";
  const cover = benchCover(starters, [12, 13], status, pos);
  assert.ok(!cover.some((c) => c.outId === 2)); // already played, nothing to cover
  assert.equal(cover.find((c) => c.outId === 1)?.inId, null); // bench keeper didn't play
});

test("hasStarted trusts a past kickoff when FPL's started flag lags", () => {
  const now = "2026-10-18T15:35:00Z";
  assert.equal(hasStarted({ started: false, kickoff_time: "2026-10-18T15:30:00Z" }, now), true);
  assert.equal(hasStarted({ started: false, kickoff_time: "2026-10-18T16:30:00Z" }, now), false);
  assert.equal(hasStarted({ started: true, kickoff_time: null }, now), true);
  assert.equal(hasStarted(undefined, now), false);
});

test("Bench Boost counts the bench in the projected total and never subs", () => {
  const base = load("live-a.json");
  const off = buildTracker(base, null);
  const on = buildTracker({ ...base, picks: { ...base.picks, chip: "bboost" } }, null);
  assert.equal(on.benchBoost, true);
  assert.equal(off.benchBoost, false);
  assert.ok(on.projectedTotal >= off.projectedTotal);
  assert.equal(on.rows.some((r) => r.subbedIn || r.subbedOut), false);
});

test("Triple Captain triples the armband player in rows and total", () => {
  const base = load("live-a.json");
  const off = buildTracker(base, null);
  const on = buildTracker({ ...base, picks: { ...base.picks, chip: "3xc" } }, null);
  const a = off.rows.find((r) => r.isArmband)!;
  const b = on.rows.find((r) => r.isArmband)!;
  assert.equal(b.contribution, (a.contribution / 2) * 3);
  assert.ok(Math.abs(on.projectedTotal - off.projectedTotal - a.contribution / 2) < 1e-9);
});

test("Bench Boost puts every player in the lineup; otherwise only the post-autosub XI", () => {
  const base = load("live-a.json");
  const off = buildTracker(base, null);
  const on = buildTracker({ ...base, picks: { ...base.picks, chip: "bboost" } }, null);
  assert.equal(on.rows.every((r) => r.inLineup), true);
  assert.equal(off.rows.filter((r) => r.inLineup).length, 11);
});

// A minimal double gameweek: club 1 (player 10) plays ARS on Sat (over) and LIV on Tue (not started).
function dgwPayload(over: { first: boolean; second: boolean }, hit = 0) {
  const fx = (id: number, h: number, a: number, kickoff: string, done: boolean) => ({
    event: 9, id, team_h: h, team_a: a, kickoff_time: kickoff,
    started: done, finished: done, finished_provisional: done,
    team_h_difficulty: 3, team_a_difficulty: 3,
  });
  return buildLivePayload({
    bootstrap: {
      events: [{ id: 9, is_current: true, deadline_time: "2026-10-17T10:00:00Z" }],
      elements: [{ id: 10, team: 1, element_type: 3, web_name: "Dbl", code: 1 }],
      teams: [{ id: 1, short_name: "AAA" }, { id: 2, short_name: "ARS" }, { id: 3, short_name: "LIV" }],
    } as never,
    live: { elements: [{ id: 10, stats: { total_points: 7, minutes: 90, goals_conceded: 0 } }] },
    fixtures: [
      fx(2, 1, 3, "2026-10-21T19:00:00Z", over.second),
      fx(1, 2, 1, "2026-10-18T14:00:00Z", over.first),
    ] as never,
    picks: {
      picks: [{ element: 10, position: 1, multiplier: 1, is_captain: false, is_vice_captain: false }],
      entry_history: { event_transfers_cost: hit },
    },
    inputs: { componentXpByElement: { "10": { appearance: 2 } }, parMargin: 0, marginProvisional: false, parBuffer: 4, parBufferProvisional: 8, rankCalibration: null },
    gameweek: 9,
    now: "2026-10-19T12:00:00Z",
  });
}

test("double gameweek: between the matches the player waits for the second, keeping the points banked", () => {
  const view = buildTracker(dgwPayload({ first: true, second: false }), null);
  const row = view.rows[0];
  assert.equal(row.status, "notStarted");
  assert.equal(row.pointsSoFar, 7);
  assert.equal(row.opponent, "LIV (H)");
  assert.deepEqual(row.otherOpponents, ["ARS (A)"]);
});

test("double gameweek: finished only once both matches are over", () => {
  const view = buildTracker(dgwPayload({ first: true, second: true }), null);
  assert.equal(view.rows[0].status, "finished");
});

test("the transfer hit is carried to the tracker view, outside the projection", () => {
  const withHit = buildTracker(dgwPayload({ first: true, second: true }, 4), null);
  const without = buildTracker(dgwPayload({ first: true, second: true }, 0), null);
  assert.equal(withHit.hit, 4);
  assert.equal(without.hit, 0);
  assert.equal(withHit.projectedTotal, without.projectedTotal);
});

// Blank gameweek: club 1 has no fixture; club 2 (ARS) plays and has finished.
function blankPayload(opts: { captainBlank: boolean; omitFromLive?: boolean; noFixtures?: boolean }) {
  const el = (id: number, team: number, type: number, name: string) => ({ id, team, element_type: type, web_name: name, code: id });
  const pick = (element: number, position: number, extra = {}) => ({
    element, position, multiplier: 1, is_captain: false, is_vice_captain: false, ...extra,
  });
  const gk = [el(1, 2, 1, "G1"), el(2, 2, 1, "G2")];
  const outfield = Array.from({ length: 13 }, (_, i) => el(10 + i, i === 0 ? 1 : 2, i < 4 ? 2 : i < 9 ? 3 : 4, `P${i}`));
  const squad = [...gk, ...outfield]; // 2 GK, 4 DEF, 5 MID, 4 FWD
  // Starting XI: GK, 4 DEF, 4 MID, 2 FWD. Bench: GK, MID, FWD, FWD.
  const order = [1, 10, 11, 12, 13, 14, 15, 16, 17, 19, 20, 2, 18, 21, 22];
  const picks = order.map((id, i) =>
    pick(id, i + 1, id === 10 ? { is_captain: opts.captainBlank } : id === 11 ? { is_vice_captain: opts.captainBlank } : {}),
  );
  const fixture = {
    event: 9, id: 1, team_h: 2, team_a: 3, kickoff_time: "2026-10-17T14:00:00Z",
    started: true, finished: true, finished_provisional: true, team_h_difficulty: 3, team_a_difficulty: 3,
  };
  return buildLivePayload({
    bootstrap: {
      events: [{ id: 9, is_current: true, deadline_time: "2026-10-17T10:00:00Z" }],
      elements: squad,
      teams: [{ id: 1, short_name: "BLK" }, { id: 2, short_name: "ARS" }, { id: 3, short_name: "LIV" }],
    } as never,
    live: {
      elements: squad
        .filter((e) => !(opts.omitFromLive && e.team === 1))
        .map((e) => ({ id: e.id, stats: { total_points: e.team === 1 ? 0 : 2, minutes: e.team === 1 ? 0 : 90, goals_conceded: 0 } })),
    },
    fixtures: (opts.noFixtures ? [] : [fixture]) as never,
    picks: { picks },
    inputs: { componentXpByElement: {}, parMargin: 0, marginProvisional: false, parBuffer: 4, parBufferProvisional: 8, rankCalibration: null },
    gameweek: 9,
    now: "2026-10-19T12:00:00Z",
  });
}

test("a starter whose club has no match is 'did not play' and a bench player covers", () => {
  const view = buildTracker(blankPayload({ captainBlank: false }), null);
  const blank = view.rows.find((r) => r.id === 10)!;
  assert.equal(blank.status, "didNotPlay");
  assert.equal(blank.subbedOut, true);
  assert.equal(view.rows.filter((r) => r.subbedIn).length, 1);
});

test("a blank captain passes the armband to the vice-captain", () => {
  const view = buildTracker(blankPayload({ captainBlank: true }), null);
  assert.equal(view.armbandId, 11);
});

test("the blank rule holds even if FPL's live feed omits the player", () => {
  const view = buildTracker(blankPayload({ captainBlank: false, omitFromLive: true }), null);
  assert.equal(view.rows.find((r) => r.id === 10)!.status, "didNotPlay");
});

test("with no fixtures loaded at all nobody is blanked", () => {
  const view = buildTracker(blankPayload({ captainBlank: false, noFixtures: true }), null);
  assert.equal(view.rows.find((r) => r.id === 10)!.status, "notStarted");
});
