import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { fpl } from "../../src/lib/fplApi.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(status: number, body: unknown) {
  const calls: { url: string; init: { next?: { revalidate?: number | false }; headers?: unknown } }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init: init as (typeof calls)[number]["init"] });
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
  }) as typeof fetch;
  return calls;
}

test("calls the FPL API with a user agent and the default 40s cache", async () => {
  const calls = stubFetch(200, { ok: true });
  assert.deepEqual(await fpl("/bootstrap-static/"), { ok: true });
  assert.equal(calls[0].url, "https://fantasy.premierleague.com/api/bootstrap-static/");
  assert.equal(calls[0].init.next?.revalidate, 40);
  assert.match(String((calls[0].init.headers as Record<string, string>)["User-Agent"]), /fplforecast/);
});

test("a caller can ask for a longer cache", async () => {
  const calls = stubFetch(200, {});
  await fpl("/event/6/live/", 300);
  assert.equal(calls[0].init.next?.revalidate, 300);
});

test("a non-2xx response throws, naming the path and status", async () => {
  stubFetch(500, {});
  await assert.rejects(() => fpl("/entry/1/"), /FPL \/entry\/1\/ -> 500/);
});

test("a 503, or a non-JSON 200, is FPL updating rather than a plain failure", async () => {
  const { FplUpdatingError, upstreamFailure, FPL_UPDATING_TEXT } = await import("../../src/lib/fplApi.ts");
  stubFetch(503, {});
  await assert.rejects(() => fpl("/bootstrap-static/"), FplUpdatingError);
  globalThis.fetch = (async () =>
    new Response("<html>The game is being updated.</html>", { status: 200 })) as typeof fetch;
  await assert.rejects(() => fpl("/bootstrap-static/"), FplUpdatingError);
  assert.deepEqual(upstreamFailure(new FplUpdatingError("/x")), { status: 503, body: { error: FPL_UPDATING_TEXT, updating: true } });
  assert.deepEqual(upstreamFailure(new Error("boom")), { status: 502, body: { error: "boom" } });
});
