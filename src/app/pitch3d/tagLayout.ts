/* Last step of the name-tag layout, free of three.js so it can be tested. A tag is drawn centred on x with
 * its bottom edge at y (the stage applies translate(-50%,-100%)); y is just above its own player's head. */

export type TagBox = { x: number; y: number; w: number; h: number };
export type Rect = { l: number; r: number; t: number; b: number };
export type TagItem = TagBox & {
  /** Identity across frames, so a tag that had to move keeps its offset steady while the camera glides. */
  key: string;
  /** Where his own player stands on screen (he may be covered); every other figure is something to keep clear of. */
  figure?: Rect;
};
/** How far each tag was moved from its own spot, kept between frames. */
export type TagMemory = Map<string, { dx: number; dy: number }>;

const MARGIN = 2; // a little more than the 0.5px the stage rounds a tag by
/** A displaced tag is never moved down (onto his own body) and stays this close to his player. */
const MAX_UP = 44;
const MAX_SIDE = 64;
/** Per frame, a tag eases toward a new spot at most this far, so a glide never makes it jump. */
const EASE = 2;
/** Keep the previous frame's spot while it still works and costs about as little as the best one. */
const KEEP_WITHIN = 10;
const FIGURE_PENALTY = 30;

const rectOf = (c: TagBox): Rect => ({ l: c.x - c.w / 2, r: c.x + c.w / 2, t: c.y - c.h, b: c.y });
const hit = (a: Rect, b: Rect, m = MARGIN) => a.l < b.r + m && b.l < a.r + m && a.t < b.b + m && b.t < a.b + m;
const inside = (c: TagBox, W: number, H: number) => {
  const r = rectOf(c);
  return r.l >= MARGIN && r.r <= W - MARGIN && r.t >= MARGIN && r.b <= H - MARGIN;
};

/**
 * Moves tags the earlier passes left on top of each other, or outside the frame, by the least that clears
 * them: exactly far enough to get past the box in the way (up, left or right, never down), not a fixed step,
 * so a tag moves smoothly as the camera does. The tag nearest the camera keeps its place; farther ones give
 * way. A tag that cannot be cleared within a short reach is left in place and counted in the result, so the
 * caller can try smaller tags. A layout that is already clean is left exactly as it is.
 */
export function clearOverlaps(items: TagItem[], W: number, H: number, memory: TagMemory = new Map()): { unresolved: number } {
  const order = [...items].sort((a, b) => b.y - a.y);
  const placed: TagBox[] = [];
  let unresolved = 0;
  for (const it of order) {
    const home = { x: it.x, y: it.y };
    const at = (dx: number, dy: number): TagBox => ({ x: home.x + dx, y: home.y + dy, w: it.w, h: it.h });
    const free = (c: TagBox) => inside(c, W, H) && !placed.some((p) => hit(rectOf(c), rectOf(p)));
    const reach = (dx: number, dy: number) => dy <= 0 && dy >= -MAX_UP && Math.abs(dx) <= MAX_SIDE;
    const cost = (dx: number, dy: number) => {
      const r = rectOf(at(dx, dy));
      let c = Math.abs(dx) + Math.abs(dy) * 1.1;
      for (const o of items) if (o !== it && o.figure && hit(r, o.figure, 0)) c += FIGURE_PENALTY;
      return c;
    };

    let target: { dx: number; dy: number } | null = free(at(0, 0)) ? { dx: 0, dy: 0 } : null;
    if (!target) {
      // each step clears one blocking box exactly; a second or third may be needed for a crowd
      let frontier = [{ dx: 0, dy: 0 }];
      const seen: { dx: number; dy: number; cost: number }[] = [];
      for (let depth = 0; depth < 3 && frontier.length; depth++) {
        const next: { dx: number; dy: number }[] = [];
        for (const f of frontier) {
          const c = at(f.dx, f.dy);
          const rc = rectOf(c);
          const blockers = placed.filter((p) => hit(rc, rectOf(p)));
          const moves: { dx: number; dy: number }[] = [];
          for (const p of blockers) {
            const pr = rectOf(p);
            moves.push({ dx: f.dx, dy: pr.t - MARGIN - home.y }); // up, just clear of him
            moves.push({ dx: pr.l - MARGIN - it.w / 2 - home.x, dy: f.dy }); // left
            moves.push({ dx: pr.r + MARGIN + it.w / 2 - home.x, dy: f.dy }); // right
          }
          if (!blockers.length) {
            // only out of the frame: bring it back in along the way it left
            const W2 = it.w / 2;
            moves.push({ dx: Math.min(W - MARGIN - W2, Math.max(MARGIN + W2, c.x)) - home.x, dy: f.dy });
            moves.push({ dx: f.dx, dy: Math.min(H - MARGIN, Math.max(MARGIN + it.h, c.y)) - home.y });
          }
          for (const m of moves) {
            if (!reach(m.dx, m.dy)) continue;
            if (free(at(m.dx, m.dy))) seen.push({ ...m, cost: cost(m.dx, m.dy) });
            else next.push(m);
          }
        }
        frontier = next;
      }
      if (seen.length) {
        seen.sort((a, b) => a.cost - b.cost);
        target = seen[0];
        // keep the spot from the last frame if it still works and is nearly as good, so ties never flip
        const prev = memory.get(it.key);
        if (prev && reach(prev.dx, prev.dy) && free(at(prev.dx, prev.dy)) && cost(prev.dx, prev.dy) <= seen[0].cost + KEEP_WITHIN) target = prev;
      }
    }

    if (!target) {
      unresolved++;
      memory.delete(it.key);
      placed.push(it);
      continue;
    }
    // ease from where it was last frame toward the new spot, as long as every step is clear
    let { dx, dy } = target;
    const prev = memory.get(it.key);
    if (prev && (prev.dx !== dx || prev.dy !== dy)) {
      const step = (a: number, b: number) => a + Math.max(-EASE, Math.min(EASE, b - a));
      const eased = { dx: step(prev.dx, dx), dy: step(prev.dy, dy) };
      if (reach(eased.dx, eased.dy) && free(at(eased.dx, eased.dy))) ({ dx, dy } = eased);
      else if (reach(prev.dx, prev.dy) && free(at(prev.dx, prev.dy))) ({ dx, dy } = prev);
    }
    if (dx === 0 && dy === 0) memory.delete(it.key);
    else memory.set(it.key, { dx, dy });
    it.x = home.x + dx;
    it.y = home.y + dy;
    placed.push(it);
  }
  return { unresolved };
}

export type TagState = { tier: number; memory: TagMemory };

/**
 * Clears overlaps at the normal tag size; if some tag cannot be cleared close to his player, every tag goes
 * smaller (tier 1: shorter name, tier 2: number only) and it is tried again. `resize(tier)` must apply the
 * size for that tier and update each item's w/h; `home` is where each tag starts (index-aligned with items).
 */
export function fitTags(items: TagItem[], home: { x: number; y: number }[], W: number, H: number, state: TagState, resize: (tier: number) => void): void {
  for (let tier = 0; tier <= 2; tier++) {
    resize(tier);
    items.forEach((it, i) => {
      it.x = home[i].x;
      it.y = home[i].y;
    });
    const memory = tier === state.tier ? new Map(state.memory) : new Map();
    const { unresolved } = clearOverlaps(items, W, H, memory);
    if (!unresolved || tier === 2) {
      state.tier = tier;
      state.memory = memory;
      return;
    }
  }
}
