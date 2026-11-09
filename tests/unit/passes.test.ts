import test from "node:test";
import assert from "node:assert/strict";
import { BALL_REST_Y, KICK_AT, PASS_SPEED, ballAt, facing, kickLeg, nearest, nextReceiver, passSeconds } from "@/app/pitch3d/passes";

const spots = [
  { id: 1, x: 0, z: -16 }, // keeper, further back than the full-backs are wide
  { id: 2, x: -6, z: -7 },
  { id: 3, x: 0, z: -7 },
  { id: 4, x: 6, z: -7 },
  { id: 5, x: 0, z: 6 }, // a lone forward
];

test("the nearest teammates, closest first, never including himself", () => {
  const ids = nearest(spots, 3, 3).map((s) => s.id);
  assert.equal(ids.length, 3);
  assert.ok(!ids.includes(3));
  assert.deepEqual(ids.slice(0, 2).sort(), [2, 4], "the two either side are closest");
  assert.deepEqual(nearest(spots, 99), []);
});

test("the next receiver is one of the three nearest and not the man it just came from", () => {
  for (let i = 0; i < 40; i++) {
    const pick = nextReceiver(spots, 3, 2, Math.random)!;
    assert.ok(nearest(spots, 3, 3).some((s) => s.id === pick.id));
    assert.notEqual(pick.id, 2);
  }
});

test("with nobody else on the pitch there is nobody to pass to; with one other he gets it back", () => {
  assert.equal(nextReceiver([{ id: 1, x: 0, z: 0 }], 1, null, Math.random), null);
  const pair = [{ id: 1, x: 0, z: 0 }, { id: 2, x: 3, z: 0 }];
  assert.equal(nextReceiver(pair, 1, 2, Math.random)!.id, 2);
});

test("a pass takes longer over a longer distance, with a floor for a short one", () => {
  assert.equal(passSeconds(1), 0.35);
  assert.ok(passSeconds(16) > passSeconds(8));
  assert.equal(passSeconds(8 * PASS_SPEED), 8 * PASS_SPEED * (1 / PASS_SPEED));
});

test("the ball starts and ends on the ground at the two spots, and hops in between", () => {
  const from = { x: -4, z: 2 };
  const to = { x: 5, z: -3 };
  assert.deepEqual(ballAt(from, to, 0), { x: -4, y: BALL_REST_Y, z: 2 });
  const end = ballAt(from, to, 1);
  assert.ok(Math.abs(end.x - 5) < 1e-9 && Math.abs(end.z + 3) < 1e-9 && Math.abs(end.y - BALL_REST_Y) < 1e-9);
  assert.ok(ballAt(from, to, 0.5).y > BALL_REST_Y + 0.4);
});

test("the kick draws the leg back, swings it through at the moment of contact, and settles", () => {
  assert.deepEqual(kickLeg(0), { hip: 0, knee: 0 });
  assert.ok(kickLeg(KICK_AT - 0.01).hip > 0.6, "leg drawn back");
  assert.ok(kickLeg(KICK_AT + 0.25).hip < -0.9, "leg swung well through");
  assert.ok(Math.abs(kickLeg(KICK_AT + 0.6).hip) < 1e-9, "back to rest");
});

test("facing a teammate turns the head towards him but never to the back", () => {
  assert.equal(facing({ x: 0, z: 0 }, { x: 0, z: 5 }), 0, "straight ahead is not a turn");
  assert.ok(facing({ x: 0, z: 0 }, { x: 5, z: 1 }) > 1, "turns right for a man on his right");
  assert.equal(facing({ x: 0, z: 0 }, { x: 0, z: -5 }), 1.2, "a man behind him: turns as far as the limit, no further");
  assert.ok(Math.abs(facing({ x: 0, z: 0 }, { x: -9, z: -1 })) <= 1.2);
});
