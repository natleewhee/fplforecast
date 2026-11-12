import test from "node:test";
import assert from "node:assert/strict";
import {
  BALL_REST_Y, CUSHION_SECONDS, KICK_AT, LONG_PASS, ONE_TOUCH_CHANCE, PASS_SPEED,
  ballAt, cushionLeg, facing, kickLeg, nearest, nextReceiver, passSeconds, passWeight, receiveHold, setBall, travel,
} from "@/app/pitch3d/passes";

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

test("the next receiver is one of the four nearest and not the man it just came from", () => {
  for (let i = 0; i < 60; i++) {
    const pick = nextReceiver(spots, 3, 2, Math.random)!;
    assert.ok(nearest(spots, 3, 4).some((s) => s.id === pick.id));
    assert.notEqual(pick.id, 2);
  }
});

test("passes lean forward: forward beats square beats backward, and backward still happens", () => {
  assert.ok(passWeight({ z: 0 }, { z: 6 }) > passWeight({ z: 0 }, { z: 0 }));
  assert.ok(passWeight({ z: 0 }, { z: 0 }) > passWeight({ z: 0 }, { z: -6 }));
  assert.ok(passWeight({ z: 0 }, { z: -6 }) > 0);
  // the centre-back (3): forward (5) and square (2, 4) and back to the keeper (1) all possible,
  // the forward pass the single most likely; deterministic sweep of the random source
  const counts = new Map<number, number>();
  for (let i = 0; i < 1000; i++) {
    const id = nextReceiver(spots, 3, null, () => (i + 0.5) / 1000)!.id;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  assert.deepEqual([...counts.keys()].sort(), [1, 2, 4, 5]);
  assert.ok(counts.get(5)! > counts.get(2)! && counts.get(2)! > counts.get(1)!);
});

test("a receiver plays it first time some of the time, otherwise holds it 0.15 to 0.9 s", () => {
  assert.equal(receiveHold(() => 0), 0);
  assert.equal(receiveHold(() => ONE_TOUCH_CHANCE - 0.01), 0);
  for (const r of [ONE_TOUCH_CHANCE, 0.5, 0.8, 0.999]) {
    const h = receiveHold(() => r);
    assert.ok(h >= 0.15 && h <= 0.9, `hold ${h}`);
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

test("a long ball starts and ends on the ground at the two spots, and is lofted in between", () => {
  const from = { x: -4, z: 2 };
  const to = { x: 5, z: -3 }; // about 10.3 long
  assert.ok(Math.hypot(9, 5) >= LONG_PASS);
  assert.deepEqual(ballAt(from, to, 0), { x: -4, y: BALL_REST_Y, z: 2 });
  const end = ballAt(from, to, 1);
  assert.ok(Math.abs(end.x - 5) < 1e-9 && Math.abs(end.z + 3) < 1e-9 && Math.abs(end.y - BALL_REST_Y) < 1e-9);
  assert.ok(ballAt(from, to, 0.5).y > BALL_REST_Y + 0.8);
});

test("a short pass rolls flat along the ground", () => {
  for (const p of [0.2, 0.5, 0.8]) assert.equal(ballAt({ x: 0, z: 0 }, { x: 4, z: 0 }, p).y, BALL_REST_Y);
});

test("the ball is quick off the boot and slows as it goes, but arrives moving", () => {
  assert.equal(travel(0), 0);
  assert.equal(travel(1), 1);
  const early = travel(0.1) - travel(0);
  const late = travel(1) - travel(0.9);
  assert.ok(early > 0.15 && late > 0 && early > 2 * late);
});

test("the first touch sets the ball smoothly to where he kicks it from", () => {
  const a = { x: 0, z: 0 };
  const b = { x: 1, z: -1 };
  assert.deepEqual(setBall(a, b, 0), a);
  assert.deepEqual(setBall(a, b, 1), b);
  assert.deepEqual(setBall(a, b, 2), b);
  assert.ok(setBall(a, b, 0.5).x > 0.5, "eases in: most of the way by halfway");
});

test("the receiving leg lifts to meet the ball and is back down by the end of the cushion", () => {
  assert.deepEqual(cushionLeg(0), { hip: 0, knee: 0 });
  assert.ok(cushionLeg(CUSHION_SECONDS / 2).hip < -0.3);
  assert.deepEqual(cushionLeg(CUSHION_SECONDS), { hip: 0, knee: 0 });
  assert.deepEqual(cushionLeg(0.1, 0), { hip: 0, knee: 0 }, "no cushion on a first-time pass");
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
