import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildLivePayload, buildTracker } from "../../src/lib/liveBlend.ts";

/* The app's live score for a FINISHED gameweek must equal FPL's own figure.
 * Fixtures come from `node scripts/capture-reconcile.mjs <team> <gw>`; with
 * none saved this test has nothing to check and says so. */
const dir = join(import.meta.dirname, "..", "fixtures", "reconcile");
const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")) : [];

if (files.length === 0) {
  test("reconciliation with FPL (no fixtures captured yet)", { skip: "run scripts/capture-reconcile.mjs" }, () => {});
}

for (const file of files) {
  test(`reconciles with FPL: ${file}`, () => {
    const d = JSON.parse(readFileSync(join(dir, file), "utf8"));
    const payload = buildLivePayload({
      bootstrap: d.bootstrap,
      live: d.live,
      fixtures: d.fixtures,
      picks: d.picks,
      inputs: { componentXpByElement: {}, parMargin: 0, marginProvisional: true, parBuffer: 0, parBufferProvisional: 0, rankCalibration: null },
      gameweek: d.gameweek,
      now: "2099-01-01T00:00:00Z",
    });
    const view = buildTracker(payload, null);
    const gross = view.rows.filter((r) => r.inLineup).reduce((s, r) => s + r.pointsSoFar, 0);
    const fpl = d.picks.entry_history.points;
    const hit = view.hit;
    // Which side of the hit FPL's `points` sits on is what this test settles.
    assert.ok(
      gross === fpl || gross - hit === fpl,
      `computed ${gross} (hit ${hit}) vs FPL points ${fpl}`,
    );
  });
}
