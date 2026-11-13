import test from "node:test";
import assert from "node:assert/strict";

test("a 3D failure is shared, shown as 2D, and choosing 3D again retries", async () => {
  // a minimal window/localStorage for the store
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).window = { addEventListener() {}, removeEventListener() {} };
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  const pv = await import("@/lib/pitchView");
  const internals = pv as unknown as { markPitch3dUnavailable: () => void; setPitchView: (v: "3d" | "2d") => void };
  internals.setPitchView("3d");
  internals.markPitch3dUnavailable();
  // read through the same snapshot getters the hooks use
  assert.equal(pv.readShownPitchView(), "2d");
  internals.setPitchView("3d");
  assert.equal(pv.readShownPitchView(), "3d");
  internals.setPitchView("2d");
  assert.equal(pv.readShownPitchView(), "2d");
});
