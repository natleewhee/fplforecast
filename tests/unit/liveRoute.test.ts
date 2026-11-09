import { test, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";

/* /api/live with the committed gw10 and gw11 forecast files on disk: while GW10
 * is live it must price players off gw10.json (built for GW10), not gw11.json
 * (built for next week). fetch is stubbed; the forecast files are the real ones. */

type Comps = Record<string, number>;
type Pool = { id: number; components?: Comps }[];
type ForecastFile = { pool: Pool; squadComponents: Record<string, Comps> };
const readGw = (n: number): ForecastFile =>
  JSON.parse(readFileSync(join(process.cwd(), "data", "forecast", `gw${n}.json`), "utf8"));
const gw10 = readGw(10);
const gw11 = readGw(11);
const sum = (c: Comps) => Object.values(c).reduce((a, b) => a + b, 0);

const comps10 = new Map(gw10.pool.map((p) => [p.id, p.components!]));
const comps11 = new Map(gw11.pool.map((p) => [p.id, p.components!]));
const heldIds = new Set(Object.keys(gw10.squadComponents).map(Number));
// Players whose xP differs between the two builds, so reading the wrong file shows.
const differing = [...comps10.keys()].filter(
  (id) => comps11.has(id) && Math.abs(sum(comps10.get(id)!) - sum(comps11.get(id)!)) > 0.05,
);
const transferredIn = differing.find((id) => !heldIds.has(id))!;
const squadIds = [...differing.filter((id) => id !== transferredIn).slice(0, 14), transferredIn];

const realFetch = globalThis.fetch;
const seen: string[] = [];
let forecastReply: () => Response;
beforeEach(() => {
  seen.length = 0;
  forecastReply = () => Response.json({ ...gw11, parMargin: 7, marginProvisional: false });
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    seen.push(url);
    if (url.includes("/api/forecast")) return forecastReply();
    if (url.includes("/bootstrap-static/")) {
      return Response.json({
        events: [{ id: 10, is_current: true, finished: false, deadline_time: "2026-10-30T10:00:00Z" }],
        elements: squadIds.map((id, i) => ({
          id, team: 1 + (i % 2), element_type: i === 0 ? 1 : 3, web_name: `P${id}`, code: id,
        })),
        teams: [{ id: 1, short_name: "AAA" }, { id: 2, short_name: "BBB" }],
      });
    }
    if (url.includes("/live/")) {
      return Response.json({ elements: squadIds.map((id) => ({ id, stats: { total_points: 2, minutes: 45, goals_conceded: 0 } })) });
    }
    if (url.includes("/fixtures/")) {
      return Response.json([
        { event: 10, team_h: 1, team_a: 2, kickoff_time: "2026-10-20T14:00:00Z", started: true, finished: false,
          team_h_difficulty: 2, team_a_difficulty: 4 },
      ]);
    }
    if (url.includes("/picks/")) {
      return Response.json({
        picks: squadIds.map((element, i) => ({ element, position: i + 1, multiplier: 1, is_captain: i === 5, is_vice_captain: i === 6 })),
        entry_history: { event_transfers_cost: 0 },
      });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
});
afterEach(async () => {
  globalThis.fetch = realFetch;
  (await import("../../src/lib/liveInputs.ts")).clearGuestForecastCache();
});

const req = (path: string) => new NextRequest(`http://localhost${path}`);

test("sanity: the two committed builds really differ for the players used", () => {
  assert.ok(squadIds.length === 15 && differing.length >= 15);
  assert.ok(!heldIds.has(transferredIn) && comps10.has(transferredIn));
});

test("while GW10 is live, the owner's xP comes from gw10.json, not gw11.json", async () => {
  const { GET } = await import("../../src/app/api/live/route.ts");
  const json = await (await GET(req("/api/live"))).json();
  assert.equal(json.gameweek, 10);
  for (const id of squadIds) assert.deepEqual(json.componentXpByElement[String(id)], comps10.get(id));
  assert.notDeepEqual(json.componentXpByElement[String(squadIds[0])], comps11.get(squadIds[0]));
});

test("a pool player transferred in since the squad snapshot gets xP", async () => {
  const { GET } = await import("../../src/app/api/live/route.ts");
  const json = await (await GET(req("/api/live"))).json();
  assert.deepEqual(json.componentXpByElement[String(transferredIn)], comps10.get(transferredIn));
  const row = json.squad.find((s: { id: number }) => s.id === transferredIn);
  assert.equal(row.hasComponents, true);
});

test("fixture difficulty still comes from this gameweek's fixture", async () => {
  const { GET } = await import("../../src/app/api/live/route.ts");
  const json = await (await GET(req("/api/live"))).json();
  assert.equal(json.squad[0].fdrRating, 2); // team 1 is home: team_h_difficulty
  assert.equal(json.squad[1].fdrRating, 4); // team 2 is away: team_a_difficulty
});

test("a guest gets the same per-player components, with par from their own forecast", async () => {
  const { GET } = await import("../../src/app/api/live/route.ts");
  const json = await (await GET(req("/api/live?teamId=999"))).json();
  assert.deepEqual(json.componentXpByElement[String(squadIds[0])], comps10.get(squadIds[0]));
  assert.deepEqual(json.componentXpByElement[String(transferredIn)], comps10.get(transferredIn));
  assert.equal(json.parMargin, 7);
  assert.equal(json.marginProvisional, false);
});

test("repeated guest calls inside the window do not re-run /api/forecast", async () => {
  const { GET } = await import("../../src/app/api/live/route.ts");
  for (let i = 0; i < 3; i += 1) assert.equal((await GET(req("/api/live?teamId=999"))).status, 200);
  assert.equal(seen.filter((u) => u.includes("/api/forecast")).length, 1);
  // a different guest is a different forecast
  await GET(req("/api/live?teamId=1000"));
  assert.equal(seen.filter((u) => u.includes("/api/forecast")).length, 2);
});

test("the guest forecast fetch asks for a 900s revalidate window", async () => {
  const { GUEST_FORECAST_TTL_S } = await import("../../src/lib/liveInputs.ts");
  let init: RequestInit | undefined;
  const inner = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, i?: RequestInit) => {
    if (String(input).includes("/api/forecast")) init = i;
    return inner(input, i);
  }) as typeof fetch;
  const { GET } = await import("../../src/app/api/live/route.ts");
  await GET(req("/api/live?teamId=999"));
  assert.equal(GUEST_FORECAST_TTL_S, 900);
  assert.equal((init as { next?: { revalidate?: number } } | undefined)?.next?.revalidate, 900);
});

test("a failed guest forecast is not cached and the next call tries again", async () => {
  const { GET } = await import("../../src/app/api/live/route.ts");
  forecastReply = () => Response.json({ error: "boom" }, { status: 502 });
  assert.equal((await GET(req("/api/live?teamId=999"))).status, 503);
  forecastReply = () => Response.json(gw11);
  assert.equal((await GET(req("/api/live?teamId=999"))).status, 200);
  assert.equal(seen.filter((u) => u.includes("/api/forecast")).length, 2);
});
