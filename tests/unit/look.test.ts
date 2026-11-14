import test from "node:test";
import assert from "node:assert/strict";
import { ballShadow, seeded } from "@/app/pitch3d/look";
import { BALL_REST_Y } from "@/app/pitch3d/passes";

test("the ball's shadow is fullest on the grass and shrinks and fades as the ball rises", () => {
  const ground = ballShadow(BALL_REST_Y);
  const mid = ballShadow(BALL_REST_Y + 0.8);
  const top = ballShadow(BALL_REST_Y + 1.6);
  assert.equal(ground.scale, 1);
  assert.ok(mid.scale < ground.scale && top.scale < mid.scale);
  assert.ok(mid.opacity < ground.opacity && top.opacity < mid.opacity);
  assert.ok(top.opacity > 0, "a lofted ball still has a faint shadow");
  assert.deepEqual(ballShadow(BALL_REST_Y + 5), top, "no smaller than at the highest loft");
  assert.deepEqual(ballShadow(0), ground, "below its resting height it is as at rest");
});

test("the grass grain is the same on every visit", () => {
  const a = seeded(7);
  const b = seeded(7);
  const xs = Array.from({ length: 5 }, () => a());
  assert.deepEqual(xs, Array.from({ length: 5 }, () => b()));
  assert.ok(xs.every((x) => x >= 0 && x < 1));
});
