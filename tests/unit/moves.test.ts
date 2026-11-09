import test from "node:test";
import assert from "node:assert/strict";
import {
  BENCH_CHEER_SECONDS,
  BROADCAST,
  CLEAN_SHEET_SECONDS,
  GOAL_SECONDS,
  WALL_BRICKS,
  benchCheerPose,
  blend,
  cleanSheetPose,
  focusShot,
  goalPose,
  momentSeconds,
  momentsFor,
  restingPose,
} from "@/app/pitch3d/moves";
import { rollValue } from "@/lib/roll";

const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} is not close to ${b}`);

test("a goal celebration ends back where it started, standing and with arms down", () => {
  const end = goalPose(GOAL_SECONDS - 1e-6, 1);
  close(end.dz, 0, 0.01);
  close(end.bodyY, 0, 0.01);
  close(end.kneeLx, 0, 0.01);
  close(end.armL.z, 0, 0.01);
  close(end.armR.z, 0, 0.01);
});

test("the knee slide travels forward, sinks, and spreads the arms", () => {
  const mid = goalPose(1.6, 1); // after the run and the slide
  assert.ok(mid.dz > 4, "he has run and slid forward");
  assert.ok(mid.bodyY < -0.4, "he is down on his knees");
  assert.ok(mid.armL.z < -1.4 && mid.armR.z > 1.4 || mid.armR.x < -2, "arms out, or the right fist pumping");
  assert.ok(mid.kneeLx > 1.5, "knees folded under him");
});

test("two goals add a spin, three add the confetti", () => {
  const during = 1.5 + 0.8;
  assert.equal(goalPose(during, 1).yaw, 0);
  assert.ok(goalPose(during, 2).yaw > 0);
  assert.equal(goalPose(during, 2).burst, false);
  assert.equal(goalPose(during, 3).burst, true);
  close(goalPose(1.5 + 1.2 - 1e-6, 2).yaw, Math.PI * 2, 0.01); // a full turn by the end of the hold
});

test("the clean sheet is a brick wall built round him one brick at a time, not a run", () => {
  assert.equal(cleanSheetPose(0).bricks, 0);
  let last = 0;
  for (let t = 0; t <= 2.7; t += 0.1) {
    const bricks = cleanSheetPose(t).bricks;
    assert.ok(bricks >= last, "the wall only grows while it is being built");
    last = bricks;
  }
  assert.equal(cleanSheetPose(2.7).bricks, WALL_BRICKS);
  assert.equal(cleanSheetPose(1.5).dz, 0, "he stays where he is");
  assert.ok(cleanSheetPose(1.5).hipL.z < 0 && cleanSheetPose(1.5).hipR.z > 0, "feet apart");
});

test("while building he reaches forward, then dusts his hands, then folds his arms", () => {
  const building = cleanSheetPose(1.2);
  assert.ok(building.armL.x < -0.5 && building.armR.x < -0.5, "arms forward, placing bricks");
  const dusting = cleanSheetPose(3.2);
  assert.ok(dusting.armL.x < -0.7 && dusting.armR.x < -0.7, "hands together in front of him");
  assert.ok(dusting.armL.z > 0 && dusting.armR.z < 0, "palms brought in towards each other");
  const folded = cleanSheetPose(4.2);
  assert.ok(folded.armL.z > 0.9 && folded.armR.z < -0.9, "arms folded across the chest");
});

test("the wall stays whole until the end, then crumbles away", () => {
  assert.equal(cleanSheetPose(4.0).wallFade, 1);
  assert.ok(cleanSheetPose(CLEAN_SHEET_SECONDS - 0.05).wallFade < 0.2);
  close(cleanSheetPose(CLEAN_SHEET_SECONDS).wallFade, 0, 1e-9);
});

test("a goal and a clean sheet are different moves", () => {
  assert.notDeepEqual(goalPose(1.5, 1), cleanSheetPose(1.5));
  assert.equal(goalPose(1.5, 1).bricks, 0);
  assert.equal(cleanSheetPose(1.5).burst, false);
});

test("a benched player cheers on the spot: bouncing with arms up, then settles", () => {
  const p = benchCheerPose(0.8);
  assert.equal(p.dz, 0);
  assert.ok(Math.abs(p.armL.z) > 2.2);
  const end = benchCheerPose(BENCH_CHEER_SECONDS);
  close(end.bodyY, 0, 0.001);
  close(end.armL.z, 0, 0.001);
});

test("celebration lengths", () => {
  assert.equal(momentSeconds("goal", false), GOAL_SECONDS);
  assert.equal(momentSeconds("goal", true), BENCH_CHEER_SECONDS);
  assert.equal(momentSeconds("cleanSheet", false), CLEAN_SHEET_SECONDS);
});

test("which moments play, in order: goals first, then the clean sheet", () => {
  assert.deepEqual(momentsFor(0, false), []);
  assert.deepEqual(momentsFor(undefined, undefined), []);
  assert.deepEqual(momentsFor(2, false), ["goal"]);
  assert.deepEqual(momentsFor(0, true), ["cleanSheet"]);
  assert.deepEqual(momentsFor(1, true), ["goal", "cleanSheet"]);
});

test("blending from rest at 0 is rest, at 1 is the target", () => {
  const raw = goalPose(1.6, 1);
  assert.deepEqual(blend(restingPose(), raw, 0).armL, restingPose().armL);
  close(blend(restingPose(), raw, 1).dz, raw.dz);
  close(blend(restingPose(), raw, 0.5).dz, raw.dz / 2);
});

test("the close-up looks at the player from in front and above, and is tighter than the broadcast", () => {
  const shot = focusShot(4, -6, 1.05);
  assert.ok(shot.pos[1] > 8, "high enough that the players in front do not tower over him");
  assert.ok(shot.pos[2] > -6, "camera is on the near side of him");
  assert.ok(shot.fov < BROADCAST.fov);
  assert.equal(shot.look[0], 4);
});

test("a rolling number starts at the old value, ends at the new, and moves monotonically", () => {
  assert.equal(rollValue(1000, 400, 0), 1000);
  assert.equal(rollValue(1000, 400, 1), 400);
  assert.equal(rollValue(1000, 400, 2), 400);
  let last = 1000;
  for (let i = 1; i <= 10; i++) {
    const v = rollValue(1000, 400, i / 10);
    assert.ok(v <= last);
    last = v;
  }
  assert.ok(rollValue(0, 100, 0.5) > 50, "fast at first");
});
