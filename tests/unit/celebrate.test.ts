import { test } from "node:test";
import assert from "node:assert/strict";
import { decideCelebration, type CelebrationContext, type CelebrationEvent } from "../../src/app/pitch3d/celebrate.ts";

const ev: CelebrationEvent = { key: "r:1:7:goal", id: 7, kind: "goal", poll: 1 };
const ok: CelebrationContext = {
  handled: new Set(),
  reducedMotion: false,
  tabHidden: false,
  onScreen: true,
  onPitch: true,
  selectedId: null,
  busy: false,
};
const verdict = (over: Partial<CelebrationContext> = {}, e: CelebrationEvent = ev) => decideCelebration(e, { ...ok, ...over });

test("a new goal for a starter plays when nothing stands in the way", () => {
  assert.equal(verdict(), "play");
});
test("the same event is never played twice", () => {
  assert.equal(verdict({ handled: new Set([ev.key]) }), "drop");
});
test("the first poll after load never celebrates", () => {
  assert.equal(verdict({}, { ...ev, poll: 0 }), "drop");
});
test("reduced motion, a hidden tab, an off-screen pitch and a sub all drop it", () => {
  assert.equal(verdict({ reducedMotion: true }), "drop");
  assert.equal(verdict({ tabHidden: true }), "drop");
  assert.equal(verdict({ onScreen: false }), "drop");
  assert.equal(verdict({ onPitch: false }), "drop");
});
test("a selected player takes the stage: no celebration", () => {
  assert.equal(verdict({ selectedId: 3 }), "drop");
});
test("another celebration playing queues it", () => {
  assert.equal(verdict({ busy: true }), "queue");
});
test("a busy stage with a hidden tab drops rather than queues", () => {
  assert.equal(verdict({ busy: true, tabHidden: true }), "drop");
});
