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

test("team ids are canonical, and only plain digits count", async () => {
  const { resolveTeamIdFromRequest, resolveTeamId, OWNER_TEAM_ID } = await import("@/lib/teamId");
  const jar = (v?: string) => ({ get: () => (v == null ? undefined : { value: v }) });
  const fromQuery = (raw: string, cookie?: string) =>
    resolveTeamIdFromRequest({ nextUrl: { searchParams: new URLSearchParams({ teamId: raw }) }, cookies: jar(cookie) });
  for (const raw of ["16", "016"]) {
    assert.equal(resolveTeamId(jar(raw)), "16");
    assert.equal(fromQuery(raw), "16");
  }
  // "0x10" / "16.0" would dodge the cache; "1e21" became "1e+21"; 2^53+1 became another team
  for (const raw of ["0x10", "16.0", "1e21", "9007199254740993", "0", "-5", " 16"]) {
    assert.equal(resolveTeamId(jar(raw)), OWNER_TEAM_ID, raw);
    assert.equal(fromQuery(raw, "42"), "42", `${raw}: a bad query falls back to the cookie`);
  }
});
