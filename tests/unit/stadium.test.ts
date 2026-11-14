import test from "node:test";
import assert from "node:assert/strict";
import { cheerLift, CHEER_SECONDS, lowPowerDevice, netBulge, RIPPLE_SECONDS } from "@/app/pitch3d/stadium";
import { goalPushShot, NEAR_GOAL_Z } from "@/app/pitch3d/moves";

test("the crowd is skipped on low-power devices and data saver", () => {
  assert.equal(lowPowerDevice({ hardwareConcurrency: 8, deviceMemory: 8 }), false);
  assert.equal(lowPowerDevice({ hardwareConcurrency: 4 }), true);
  assert.equal(lowPowerDevice({ hardwareConcurrency: 8, deviceMemory: 2 }), true);
  assert.equal(lowPowerDevice({ hardwareConcurrency: 8, connection: { saveData: true } }), true);
  assert.equal(lowPowerDevice({}), false, "unknown hardware gets the crowd");
  assert.equal(lowPowerDevice(undefined), true);
});

test("the net ripples after a goal, stays fixed at its frame, and settles", () => {
  assert.equal(netBulge(-0.1, 0.5, 0.5), 0);
  assert.equal(netBulge(RIPPLE_SECONDS, 0.5, 0.5), 0);
  assert.ok(Math.abs(netBulge(0.1, 0, 0.5)) < 1e-9, "fixed at the posts");
  const early = Math.max(...[0.05, 0.1, 0.15].map((t) => Math.abs(netBulge(t, 0.6, 0.4))));
  const late = Math.max(...[1.2, 1.25, 1.3].map((t) => Math.abs(netBulge(t, 0.6, 0.4))));
  assert.ok(early > 0.1 && late < early / 4, `dies away: ${early} then ${late}`);
});

test("the crowd jumps once, a little out of step, and lands", () => {
  assert.equal(cheerLift(0, 0.2), 0, "not before his own moment");
  assert.ok(cheerLift(0.4, 0.2) >= 0);
  assert.equal(cheerLift(CHEER_SECONDS, 0), 0);
  const peak = Math.max(...Array.from({ length: 60 }, (_, i) => cheerLift(i * 0.03, 0)));
  assert.ok(peak > 0.15 && peak <= 0.28);
});

test("a goal is seen from behind the near net, looking back at the scorer", () => {
  const shot = goalPushShot(3, 4, 1);
  assert.ok(shot.pos[2] > NEAR_GOAL_Z, "behind the goal line");
  assert.ok(shot.pos[1] < 10, "low, not the broadcast height");
  assert.equal(shot.look[2], 4, "looking at the scorer");
});
