import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildTracker, pickThreats, type FplBootstrap, type FplFixture, type LivePayload, type LiveThreat } from "../../src/lib/liveBlend.ts";
import { buildRankThreats } from "../../src/lib/rankThreats.ts";

const here = dirname(fileURLToPath(import.meta.url));
const load = (): LivePayload => JSON.parse(readFileSync(join(here, "..", "e2e", "fixtures", "live-a.json"), "utf8"));

const threat = (over: Partial<LiveThreat>): LiveThreat => ({
  id: 900, webName: "Foden", team: "MCI", ownedPct: 41.2, opponent: "TOT (A)",
  kickoffTime: "2026-10-11T15:30:00Z", components: { goals: 1.5, minutes: 2 }, ...over,
});
const lines = (p: LivePayload) => buildRankThreats(p, null, buildTracker(p, null));

test("a popular unowned player with a match to come becomes a line quoting ownership, day and xP", () => {
  const p = { ...load(), threats: [threat({})] };
  const miss = lines(p).filter((l) => l.kind === "missing");
  assert.equal(miss.length, 1);
  assert.match(miss[0].text, /^41% of managers own Foden, he plays Sun 23:30 SGT vs TOT \(A\), not in your squad\./);
  assert.match(miss[0].text, /about 3\.5 more pts/);
});

test("no ownership, no fixture, or a finished match: the line is hidden, never invented", () => {
  const p = {
    ...load(),
    threats: [
      threat({ id: 901, ownedPct: 0 }),
      threat({ id: 902, opponent: null }),
      threat({ id: 903, ownedPct: Number.NaN }),
    ],
    liveByElement: { ...load().liveByElement, 904: { points: 5, minutes: 90, goalsConceded: 0, fixtureStarted: true, fixtureFinished: true, breakdown: [] } },
  };
  p.threats.push(threat({ id: 904 }));
  assert.equal(lines(p).filter((l) => l.kind === "missing").length, 0);
});

test("without baked xP the line keeps ownership and day but drops the model sentence", () => {
  const p = { ...load(), threats: [threat({ components: undefined })] };
  const miss = lines(p).find((l) => l.kind === "missing");
  assert.ok(miss && !/model/.test(miss.text));
});

test("a player already in play is quoted with his minute and the live decay", () => {
  const base = load();
  const p: LivePayload = {
    ...base,
    threats: [threat({})],
    liveByElement: { ...base.liveByElement, 900: { points: 2, minutes: 45, goalsConceded: 0, fixtureStarted: true, fixtureFinished: false, breakdown: [] } },
  };
  const miss = lines(p).find((l) => l.kind === "missing");
  assert.match(miss!.text, /is playing now \(45'\)/);
  assert.match(miss!.text, /about 1\.8 more pts/); // 3.5 x 45/90
});

test("your own side names the armband and what is left in the XI; capped to two lines", () => {
  const p = { ...load(), threats: [] };
  const own = lines(p).filter((l) => l.kind === "yours");
  assert.ok(own.length >= 1 && own.length <= 2);
  assert.ok(own.some((l) => /pts from your \d+ to play/.test(l.text) || /armband/.test(l.text)));
});

test("nothing left to play and no threats: no lines at all", () => {
  const base = load();
  const done: LivePayload = {
    ...base,
    threats: [],
    liveByElement: Object.fromEntries(
      Object.entries(base.liveByElement).map(([k, v]) => [k, { ...v, fixtureStarted: true, fixtureFinished: true }]),
    ),
  };
  assert.deepEqual(lines(done), []);
});

test("pickThreats: top owned first, skips owned, blanks, finished and low ownership, capped", () => {
  const bootstrap: FplBootstrap = {
    events: [],
    teams: [{ id: 1, short_name: "AAA" }, { id: 2, short_name: "BBB" }, { id: 3, short_name: "CCC" }],
    elements: [
      { id: 1, team: 1, element_type: 3, web_name: "Mine", selected_by_percent: "60.0" },
      { id: 2, team: 1, element_type: 3, web_name: "Big", selected_by_percent: "45.5" },
      { id: 3, team: 2, element_type: 4, web_name: "Mid", selected_by_percent: "20.0" },
      { id: 4, team: 3, element_type: 4, web_name: "Blank", selected_by_percent: "50.0" },
      { id: 5, team: 1, element_type: 2, web_name: "Low", selected_by_percent: "3.0" },
      { id: 6, team: 1, element_type: 2, web_name: "NoPct" },
    ],
  };
  const f = (over: Partial<FplFixture>): FplFixture => ({ event: 9, team_h: 1, team_a: 2, kickoff_time: "2026-10-11T15:30:00Z", ...over });
  const fixturesByTeam = new Map<number, FplFixture[]>([[1, [f({})]], [2, [f({})]]]);
  const out = pickThreats({
    bootstrap,
    picks: { picks: [{ element: 1, position: 1, multiplier: 1, is_captain: false, is_vice_captain: false }] },
    fixturesByTeam,
    teamName: new Map([[1, "AAA"], [2, "BBB"]]),
    components: { "2": { goals: 1 } },
  });
  assert.deepEqual(out.map((t) => t.webName), ["Big", "Mid"]);
  assert.equal(out[0].opponent, "BBB (H)");
  assert.equal(out[1].opponent, "AAA (A)");
  assert.deepEqual(out[0].components, { goals: 1 });
  assert.equal(out[1].components, undefined);
});
