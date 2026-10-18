import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

/* The routes that call FPL, run end to end with fetch stubbed. They are
 * imported lazily so each test's stub is in place first. */

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

type Reply = { status?: number; body?: unknown; html?: boolean };
/** Answers by the first matching path fragment; anything else is a 404. */
function stubFpl(replies: Record<string, Reply>) {
  const seen: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    seen.push(url);
    const hit = Object.entries(replies).find(([frag]) => url.includes(frag));
    if (!hit) return new Response("not found", { status: 404 });
    const { status = 200, body = {}, html } = hit[1];
    return html
      ? new Response("<html>The game is being updated.</html>", { status, headers: { "content-type": "text/html" } })
      : new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return seen;
}

const ids = Array.from({ length: 15 }, (_, i) => i + 1);
const bootstrap = (over: Record<string, unknown> = {}) => ({
  events: [{ id: 9, is_current: true, finished: false, deadline_time: "2026-10-17T10:00:00Z" }],
  elements: ids.map((id) => ({
    id, team: 1 + (id % 2), element_type: id === 1 || id === 12 ? 1 : id < 6 ? 2 : id < 10 ? 3 : 4,
    web_name: `P${id}`, code: id, selected_by_percent: "5.0",
  })),
  teams: [{ id: 1, short_name: "AAA" }, { id: 2, short_name: "BBB" }],
  ...over,
});
const fixtures = [
  { event: 9, id: 1, team_h: 1, team_a: 2, kickoff_time: "2026-10-17T14:00:00Z", started: true, finished: false, finished_provisional: false },
];
const picks = {
  picks: ids.map((element, i) => ({
    element, position: i + 1, multiplier: 1, is_captain: element === 6, is_vice_captain: element === 7,
  })),
  entry_history: { event_transfers_cost: 0 },
};
const live = { elements: ids.map((id) => ({ id, stats: { total_points: 2, minutes: 45, goals_conceded: 0 } })) };

const req = (path: string) => new NextRequest(`http://localhost${path}`);

test("/api/live returns the blended payload for the owner's team", async () => {
  stubFpl({
    "/bootstrap-static/": { body: bootstrap() },
    "/event/9/live/": { body: live },
    "/fixtures/": { body: fixtures },
    "/picks/": { body: picks },
  });
  const { GET } = await import("../../src/app/api/live/route.ts");
  const res = await GET(req("/api/live"));
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.gameweek, 9);
  assert.equal(json.picks.captainId, 6);
  assert.equal(json.squad.length, 15);
});

test("/api/live reports an upstream failure as 502 with the message", async () => {
  stubFpl({ "/bootstrap-static/": { status: 500, body: {} } });
  const { GET } = await import("../../src/app/api/live/route.ts");
  const res = await GET(req("/api/live"));
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /500/);
});

test("/api/live says FPL is updating on a 503, and on an HTML 200", async () => {
  const { GET } = await import("../../src/app/api/live/route.ts");
  for (const reply of [{ status: 503, body: {} }, { status: 200, html: true }]) {
    stubFpl({ "/bootstrap-static/": reply });
    const res = await GET(req("/api/live"));
    assert.equal(res.status, 503);
    const json = await res.json();
    assert.equal(json.updating, true);
    assert.match(json.error, /updating/i);
  }
});

test("/api/recap is empty before any gameweek has finished", async () => {
  stubFpl({ "/bootstrap-static/": { body: bootstrap() } });
  const { GET } = await import("../../src/app/api/recap/route.ts");
  const res = await GET(req("/api/recap"));
  assert.deepEqual(await res.json(), { recap: null, gameweeks: [] });
});

test("/api/recap refuses a gameweek that hasn't finished", async () => {
  stubFpl({ "/bootstrap-static/": { body: bootstrap({ events: [{ id: 8, finished: true }, { id: 9, finished: false }] }) } });
  const { GET } = await import("../../src/app/api/recap/route.ts");
  assert.equal((await GET(req("/api/recap?gw=9"))).status, 400);
  assert.equal((await GET(req("/api/recap?gw=abc"))).status, 400);
});

test("/api/recap builds the latest finished gameweek and lists the weeks", async () => {
  stubFpl({
    "/bootstrap-static/": { body: bootstrap({ events: [{ id: 7, finished: true }, { id: 8, finished: true, average_entry_score: 50 }] }) },
    "/event/8/live/": { body: live },
    "/history/": { body: { current: [{ event: 8, points: 60, overall_rank: 100, event_transfers_cost: 0, points_on_bench: 3 }] } },
    "/transfers/": { body: [] },
    "/picks/": { body: picks },
  });
  const { GET } = await import("../../src/app/api/recap/route.ts");
  const res = await GET(req("/api/recap"));
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.deepEqual(json.gameweeks, [7, 8]);
  assert.equal(json.recap.gameweek, 8);
});

test("/api/league/squad rejects a bad entry id and maps FPL updating to 503", async () => {
  const { GET } = await import("../../src/app/api/league/squad/route.ts");
  stubFpl({});
  assert.equal((await GET(req("/api/league/squad?entryId=abc"))).status, 400);
  stubFpl({ "/bootstrap-static/": { status: 503 } });
  const res = await GET(req("/api/league/squad?entryId=123"));
  assert.equal(res.status, 503);
  assert.equal((await res.json()).updating, true);
});

test("/api/league maps an FPL outage to 502 and updating to 503", async () => {
  const { GET } = await import("../../src/app/api/league/route.ts");
  stubFpl({ "/bootstrap-static/": { status: 500 } });
  assert.equal((await GET(req("/api/league"))).status, 502);
  stubFpl({ "/bootstrap-static/": { status: 503 } });
  assert.equal((await GET(req("/api/league"))).status, 503);
});

test("/api/photo only accepts a numeric code and serves an image from our origin", async () => {
  const { GET } = await import("../../src/app/api/photo/route.ts");
  assert.equal((await GET(req("/api/photo?code=abc"))).status, 400);
  assert.equal((await GET(req("/api/photo?code=-4"))).status, 400);
  globalThis.fetch = (async () =>
    new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/png" } })) as typeof fetch;
  const ok = await GET(req("/api/photo?code=123"));
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("content-type"), "image/png");
  globalThis.fetch = (async () => new Response("nope", { status: 404 })) as typeof fetch;
  assert.equal((await GET(req("/api/photo?code=123"))).status, 404);
});
