import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLivePayload, playerProjection, playerStatus, type LiveElement } from "../../src/lib/liveBlend.ts";

/* Double gameweek: the second match is judged on its own minutes and goals, which come from
 * FPL's per-fixture explain entries, because the top-level stats are summed over both matches. */

const comps = { appearance: 4, goals: 2, cleanSheet: 2, bonus: 1 }; // both matches together: 9
const perMatch = 9 / 2;
const el = (over: Partial<LiveElement>): LiveElement => ({
  points: 0, minutes: 0, goalsConceded: 0, fixtureStarted: false, fixtureFinished: false, breakdown: [], ...over,
});

test("in the second match of a double only that match's own minutes decay the xP", () => {
  // 90 + 45, 60 + 30 and 0 + 70: a flat 90-minute subtraction is right only for the first.
  const cases: [number, number][] = [[90, 45], [60, 30], [0, 70]];
  for (const [first, second] of cases) {
    const p = playerProjection(
      el({ legs: 2, legsDone: 1, minutes: first + second, legMinutes: second, points: 7 }),
      comps,
      "playing",
    );
    assert.ok(Math.abs(p.remainingXp - ((90 - second) / 90) * perMatch) < 1e-9, `${first}+${second}`);
  }
});

const bootstrap = {
  events: [{ id: 5, is_current: true, deadline_time: "2026-09-01T10:00:00Z" }],
  elements: [{ id: 1, team: 1, element_type: 2, web_name: "Def" }],
  teams: [{ id: 1, short_name: "AAA" }, { id: 2, short_name: "BBB" }, { id: 3, short_name: "CCC" }],
};
const fixtures = [
  { id: 101, event: 5, team_h: 1, team_a: 2, kickoff_time: "2026-09-02T14:00:00Z", started: true, finished: true, team_h_score: 0, team_a_score: 2 },
  { id: 102, event: 5, team_h: 3, team_a: 1, kickoff_time: "2026-09-05T14:00:00Z", started: true, finished: false, team_h_score: null, team_a_score: null },
];
const stat = (identifier: string, value: number) => ({ identifier, points: 0, value });
function build(explain: { fixture: number; stats: ReturnType<typeof stat>[] }[], total: { minutes: number; goals_conceded: number }) {
  return buildLivePayload({
    bootstrap,
    live: { elements: [{ id: 1, stats: { total_points: 3, ...total }, explain }] },
    fixtures,
    picks: { picks: [{ element: 1, position: 1, multiplier: 1, is_captain: false, is_vice_captain: false }] },
    inputs: { componentXpByElement: {}, parMargin: 0, marginProvisional: true, parBuffer: 4, parBufferProvisional: 8, rankCalibration: null },
    gameweek: 5,
    now: "2026-09-05T14:30:00Z",
  } as unknown as Parameters<typeof buildLivePayload>[0]).liveByElement[1];
}

test("buildLivePayload derives legs, legsDone and the current leg's minutes and goals from two fixtures", () => {
  // Leg 1 over: 90 minutes, 2 conceded. Leg 2 live: 20 minutes, 0 conceded so far.
  const e = build(
    [
      { fixture: 101, stats: [stat("minutes", 90), stat("goals_conceded", 2)] },
      { fixture: 102, stats: [stat("minutes", 20)] },
    ],
    { minutes: 110, goals_conceded: 2 },
  );
  assert.equal(e.legs, 2);
  assert.equal(e.legsDone, 1);
  assert.equal(e.minutes, 110);
  assert.equal(e.legMinutes, 20);
  assert.equal(e.goalsConceded, 0); // leg 1's goals do not kill leg 2's clean sheet
});

test("buildLivePayload: a leg-2 goal counts, and no explain entry for the leg means 0 minutes", () => {
  const goal = build(
    [{ fixture: 101, stats: [stat("minutes", 90)] }, { fixture: 102, stats: [stat("minutes", 30), stat("goals_conceded", 1)] }],
    { minutes: 120, goals_conceded: 1 },
  );
  assert.equal(goal.goalsConceded, 1);
  const unused = build([{ fixture: 101, stats: [stat("minutes", 60)] }], { minutes: 60, goals_conceded: 0 });
  assert.equal(unused.legMinutes, 0);
});

test("playerStatus in leg 2 reads the leg's minutes, not the gameweek total", () => {
  const live = (legMinutes: number, minutes: number): LiveElement =>
    el({ legs: 2, legsDone: 1, fixtureStarted: true, minutes, legMinutes });
  const now = "2026-09-05T14:10:00Z";
  const before = "2026-09-05T14:08:00Z";
  // 95 in total but 5 in this match, frozen across a poll gap: off the pitch, not "finished".
  assert.equal(playerStatus(live(5, 95), live(5, 95), now, before), "offPitch");
  assert.equal(playerStatus(live(5, 95), undefined, now, undefined), "playing");
  // The half-time plateau is relative to this match: 45 in leg 2 is the break, not a substitution.
  assert.equal(playerStatus(live(45, 135), live(45, 135), now, before), "playing");
  // Unused on the pitch so far in leg 2 with a full first leg banked: not mistaken for full time.
  assert.equal(playerStatus(live(0, 90), live(0, 90), now, before), "playing");
});
