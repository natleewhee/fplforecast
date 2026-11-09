import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/* With gw10.json absent, the live view must not jump to gw11.json (next week's build). The data
 * directory is resolved from the working directory when snapshots.ts loads, so this file points
 * the process at a temp copy holding only gw9.json and gw11.json before importing anything. */

const real = join(process.cwd(), "data", "forecast");
const tmp = mkdtempSync(join(tmpdir(), "live-fallback-"));
mkdirSync(join(tmp, "data", "forecast"), { recursive: true });
for (const f of ["gw9.json", "gw11.json"]) copyFileSync(join(real, f), join(tmp, "data", "forecast", f));
const gw9 = JSON.parse(readFileSync(join(real, "gw9.json"), "utf8"));
process.chdir(tmp);

test("gw10.json missing: the newest file at or before GW10 (gw9) is used, never gw11", async () => {
  const { loadForecastUpTo, loadForecastFor } = await import("../../src/lib/snapshots.ts");
  assert.equal(loadForecastFor(10), null);
  assert.equal(loadForecastUpTo(8), null);
  const { liveInputsFor } = await import("../../src/lib/liveInputs.ts");
  const inputs = liveInputsFor({ liveGw: 10, owner: true })!;
  const id = String(gw9.pool.find((p: { components?: unknown }) => p.components).id);
  assert.deepEqual(inputs.componentXpByElement[id], gw9.pool.find((p: { id: number }) => String(p.id) === id).components);
  assert.deepEqual(inputs.rankCalibration, gw9.rankCalibration ?? null);
});

test("nothing at or before the live gameweek: no inputs rather than next week's", async () => {
  const { liveInputsFor } = await import("../../src/lib/liveInputs.ts");
  assert.equal(liveInputsFor({ liveGw: 8, owner: true }), null);
});
