import test from "node:test";
import assert from "node:assert/strict";
import { internalOrigin } from "@/lib/internalOrigin";

test("production calls its own routes on the fixed production domain, whatever Host the request carried", () => {
  const env = { VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "fplforecast.vercel.app" };
  assert.equal(internalOrigin("https://evil.example/api/live", env), "https://fplforecast.vercel.app");
  const withScheme = { ...env, VERCEL_PROJECT_PRODUCTION_URL: "https://fplforecast.vercel.app/" };
  assert.equal(internalOrigin("https://evil.example/x", withScheme), "https://fplforecast.vercel.app");
});

test("previews and local runs keep the request's own origin", () => {
  assert.equal(internalOrigin("http://localhost:3000/api/live?x=1", {}), "http://localhost:3000");
  const preview = { VERCEL_ENV: "preview", VERCEL_PROJECT_PRODUCTION_URL: "fplforecast.vercel.app" };
  assert.equal(internalOrigin("https://fplforecast-git-x.vercel.app/a", preview), "https://fplforecast-git-x.vercel.app");
});

test("team ids are canonical, so 16, 0x10 and 16.0 share one cache entry", async () => {
  const { resolveTeamIdFromRequest, resolveTeamId } = await import("@/lib/teamId");
  const jar = (v?: string) => ({ get: () => (v == null ? undefined : { value: v }) });
  for (const raw of ["16", "0x10", "16.0"]) {
    assert.equal(resolveTeamId(jar(raw)), "16");
    assert.equal(resolveTeamIdFromRequest({ nextUrl: { searchParams: new URLSearchParams({ teamId: raw }) }, cookies: jar() }), "16");
  }
});
