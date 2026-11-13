import test from "node:test";
import assert from "node:assert/strict";
import { LeaguesFetchError, leaguesErrorCopy, leaguesReplyCopy } from "@/lib/leaguesError";

// The real replies /api/league sends (route.ts + fplApi.ts upstreamFailure).
test("each real /api/league failure gets its own plain message", () => {
  assert.match(leaguesReplyCopy(503, { error: "FPL is updating for the new season", updating: true }), /FPL is updating/);
  assert.match(leaguesReplyCopy(503, { error: "no committed forecast snapshot on disk" }), /forecast this needs/);
  assert.match(leaguesReplyCopy(502, { error: "FPL /entry/123/ -> 404" }), /couldn’t find a league/);
  assert.match(leaguesReplyCopy(502, { error: "FPL /leagues-classic/1/standings/ -> 500" }), /isn’t answering/);
  assert.match(leaguesReplyCopy(502, { error: "FPL /entry/1/ -> 429" }), /too many requests/);
  assert.match(leaguesReplyCopy(504, {}), /isn’t answering/); // a non-JSON gateway timeout page
  for (const copy of [leaguesReplyCopy(502, { error: "FPL /x/ -> 500" }), leaguesReplyCopy(503, {})]) {
    assert.doesNotMatch(copy, /HTTP|\d{3}/, "no status codes in the copy");
  }
});

test("thrown errors map to the reply's message, a dropped connection, or our side", () => {
  assert.equal(leaguesErrorCopy(new LeaguesFetchError("FPL is updating right now.")), "FPL is updating right now.");
  assert.match(leaguesErrorCopy(new TypeError("Failed to fetch")), /connection dropped/);
  assert.match(leaguesErrorCopy(new SyntaxError("bad json")), /our side/);
});
