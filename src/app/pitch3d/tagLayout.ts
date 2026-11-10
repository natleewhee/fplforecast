/* Last step of the name-tag layout, free of three.js so it can be tested. A tag is drawn centred on x with
 * its bottom edge at y (the stage applies translate(-50%,-100%)). */

export type TagBox = { x: number; y: number; w: number; h: number };

const MARGIN = 1;
const STEP = 6;

const touches = (a: TagBox, b: TagBox) =>
  Math.abs(a.x - b.x) < (a.w + b.w) / 2 + MARGIN && Math.abs(a.y - a.h / 2 - (b.y - b.h / 2)) < (a.h + b.h) / 2 + MARGIN;

const inside = (a: TagBox, W: number, H: number) =>
  a.x - a.w / 2 >= MARGIN && a.x + a.w / 2 <= W - MARGIN && a.y - a.h >= MARGIN && a.y <= H - MARGIN;

/**
 * Moves tags the earlier passes left on top of each other, or outside the frame, to the nearest free
 * spot. Nearest-to-camera tags (lowest on screen) keep their place; the farther ones give way, preferring
 * to move up then sideways. A layout that is already clean is left exactly as it is.
 */
export function clearOverlaps<T extends TagBox>(items: T[], W: number, H: number): T[] {
  const order = [...items].sort((a, b) => b.y - a.y);
  const placed: T[] = [];
  for (const it of order) {
    const bad = (c: TagBox) => !inside(c, W, H) || placed.some((p) => touches(c, p));
    if (bad(it)) {
      const home = { x: it.x, y: it.y };
      let best: { x: number; y: number; cost: number } | null = null;
      for (let dy = -16 * STEP; dy <= 8 * STEP; dy += STEP) {
        for (let dx = -12 * STEP; dx <= 12 * STEP; dx += STEP) {
          const cost = Math.abs(dx) + Math.abs(dy) * (dy < 0 ? 1.1 : 1.6);
          if (best && cost >= best.cost) continue;
          const cand = { x: home.x + dx, y: home.y + dy, w: it.w, h: it.h };
          if (!bad(cand)) best = { x: cand.x, y: cand.y, cost };
        }
      }
      if (best) {
        it.x = best.x;
        it.y = best.y;
      }
    }
    placed.push(it);
  }
  return items;
}
