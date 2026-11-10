import { test } from "node:test";
import assert from "node:assert/strict";
import { clearOverlaps, type TagBox } from "../../src/app/pitch3d/tagLayout.ts";

const rect = (t: TagBox) => ({ l: t.x - t.w / 2, r: t.x + t.w / 2, t: t.y - t.h, b: t.y });
const overlap = (a: TagBox, b: TagBox) => {
  const p = rect(a), q = rect(b);
  return p.l < q.r && q.l < p.r && p.t < q.b && q.t < p.b;
};

test("a clean layout is left exactly as it was", () => {
  const items = [{ x: 60, y: 100, w: 50, h: 24 }, { x: 140, y: 100, w: 50, h: 24 }];
  const before = JSON.stringify(items);
  clearOverlaps(items, 200, 200);
  assert.equal(JSON.stringify(items), before);
});

test("tags on top of each other are separated and stay in frame", () => {
  const items = Array.from({ length: 6 }, (_, i) => ({ x: 100 + i * 4, y: 60 + i * 3, w: 56, h: 24 }));
  clearOverlaps(items, 200, 200);
  for (let i = 0; i < items.length; i++) {
    const r = rect(items[i]);
    assert.ok(r.l >= 0 && r.r <= 200 && r.t >= 0 && r.b <= 200, "inside the frame");
    for (let j = i + 1; j < items.length; j++) assert.equal(overlap(items[i], items[j]), false);
  }
});

test("a tag poking out of the top is brought back in", () => {
  const items = [{ x: 100, y: 10, w: 50, h: 24 }];
  clearOverlaps(items, 200, 200);
  assert.ok(items[0].y - items[0].h >= 0);
});

test("the tag nearest the camera keeps its place", () => {
  const near = { x: 100, y: 150, w: 50, h: 24 };
  const far = { x: 105, y: 140, w: 50, h: 24 };
  clearOverlaps([far, near], 200, 200);
  assert.deepEqual([near.x, near.y], [100, 150]);
});
