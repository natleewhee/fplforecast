import { test } from "node:test";
import assert from "node:assert/strict";
import { clearOverlaps, fitTags, type TagBox, type TagItem, type TagState } from "../../src/app/pitch3d/tagLayout.ts";

const rect = (t: TagBox) => ({ l: t.x - t.w / 2, r: t.x + t.w / 2, t: t.y - t.h, b: t.y });
const overlap = (a: TagBox, b: TagBox) => {
  const p = rect(a), q = rect(b);
  return p.l < q.r && q.l < p.r && p.t < q.b && q.t < p.b;
};
const it = (key: string, x: number, y: number, w = 50, h = 24): TagItem => ({ key, x, y, w, h });

test("a clean layout is left exactly as it was", () => {
  const items = [it("a", 60, 100), it("b", 140, 100)];
  const before = JSON.stringify(items);
  assert.equal(clearOverlaps(items, 200, 200).unresolved, 0);
  assert.equal(JSON.stringify(items), before);
});

test("a tag on top of another moves exactly clear of it, and never down", () => {
  const near = it("near", 100, 150);
  const far = it("far", 105, 145);
  const { unresolved } = clearOverlaps([far, near], 200, 200);
  assert.equal(unresolved, 0);
  assert.deepEqual([near.x, near.y], [100, 150]); // nearest the camera keeps its place
  assert.equal(overlap(far, near), false);
  assert.ok(far.y <= 145, "not moved down onto his own player");
});

test("a tag poking out of the side is brought back in", () => {
  const items = [it("a", 10, 100)];
  clearOverlaps(items, 200, 200);
  assert.ok(items[0].x - items[0].w / 2 >= 0);
});

test("a tag that cannot be cleared within reach is reported, not silently left", () => {
  const blockers = Array.from({ length: 6 }, (_, i) => it("b" + i, 20 + i * 32, 100, 60));
  const stuck = it("stuck", 100, 100, 60);
  assert.equal(clearOverlaps([...blockers, stuck], 200, 200).unresolved > 0, true);
});

test("a tag whose true position slides 1px a frame never jumps", () => {
  const memory = new Map();
  let last: { x: number; y: number } | null = null;
  let worst = 0;
  for (let f = 0; f < 120; f++) {
    const fixed = it("fixed", 120, 100, 56);
    const mover = it("mover", 40 + f, 104, 56); // slides right across him
    clearOverlaps([fixed, mover], 400, 200, memory);
    if (last) worst = Math.max(worst, Math.abs(mover.x - last.x), Math.abs(mover.y - last.y));
    last = { x: mover.x, y: mover.y };
    assert.equal(overlap(fixed, mover), false, `frame ${f}`);
  }
  assert.ok(worst <= 3, `moved ${worst}px in one frame`);
});

// Four formations of long surnames, laid out as a camera sees a pitch: rows narrow toward the keeper.
const FORMATIONS: Record<string, number[]> = { "4-4-2": [1, 4, 4, 2], "3-5-2": [1, 3, 5, 2], "5-3-2": [1, 5, 3, 2], "5-4-1": [1, 5, 4, 1] };
for (const W of [272, 302]) {
  for (const [name, rows] of Object.entries(FORMATIONS)) {
    test(`${name} with long names fits a ${W}px card: no overlaps, inside, near their players`, () => {
      const H = Math.round(W * 1.2);
      const items: TagItem[] = [];
      const home: { x: number; y: number }[] = [];
      rows.forEach((n, r) => {
        const rowW = W * (0.45 + 0.5 * (r / 3)); // far row narrow, near row wide
        const y = H * (0.2 + 0.2 * r);
        for (let i = 0; i < n; i++) {
          const x = W / 2 + (n === 1 ? 0 : (i / (n - 1) - 0.5) * rowW);
          items.push({ key: `${r}-${i}`, x, y, w: 66, h: 25, figure: { l: x - 9, r: x + 9, t: y, b: y + 40 } });
          home.push({ x, y });
        }
      });
      const widths = [66, 52, 24];
      const state: TagState = { tier: 0, memory: new Map() };
      fitTags(items, home, W, H, state, (tier) => items.forEach((t) => (t.w = widths[tier])));
      items.forEach((a, i) => {
        const r = rect(a);
        assert.ok(r.l >= 0 && r.r <= W && r.t >= 0 && r.b <= H, `tag ${a.key} inside`);
        assert.ok(a.y <= home[i].y, "never below his own player");
        assert.ok(Math.hypot(a.x - home[i].x, a.y - home[i].y) <= 90, `tag ${a.key} stays near his player`);
        for (let j = i + 1; j < items.length; j++) assert.equal(overlap(a, items[j]), false, `${a.key} / ${items[j].key}`);
      });
    });
  }
}
