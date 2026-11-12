/* The ball going round the pitch while nobody is selected. Players stay on their spots: the
 * holder turns to a teammate and kicks, the ball rolls across, the receiver cushions it, sets it
 * for his next pass and either plays it first time or holds it a moment. Passes lean forward
 * (+z is towards the opposition goal), slow down as they travel, and only long ones leave the
 * ground. Pure functions, so the choices and timings can be tested without three.js. */

export type Spot = { id: number; x: number; z: number };

export const PASS_SPEED = 8; // units per second along the ground
export const KICK_AT = 0.3; // seconds into the wind-up when his foot meets the ball
export const BALL_REST_Y = 0.36;
export const LONG_PASS = 9; // passes at least this long are lofted; shorter ones roll flat
export const ONE_TOUCH_CHANCE = 0.25; // how often a receiver plays it first time
export const CUSHION_SECONDS = 0.3; // the receiving touch

const dist = (a: Spot, b: Spot) => Math.hypot(a.x - b.x, a.z - b.z);

/** The teammates standing closest to a player, nearest first. */
export function nearest(spots: Spot[], id: number, n = 3): Spot[] {
  const me = spots.find((s) => s.id === id);
  if (!me) return [];
  return spots
    .filter((s) => s.id !== id)
    .sort((a, b) => dist(me, a) - dist(me, b))
    .slice(0, n);
}

/** How much a holder prefers passing to `to`: forward passes most, square passes next, backward
 * passes least (but still sometimes, so play can be recycled). */
export function passWeight(from: { z: number }, to: { z: number }): number {
  const dz = to.z - from.z;
  if (dz > 0.5) return 1 + Math.min(dz, 8) / 4; // up to 3x for a ball well forward
  if (dz < -0.5) return 0.45;
  return 1;
}

/** Who gets the ball next: one of the four nearest, picked with a lean towards forward passes,
 * never straight back to where it came from unless there is no one else. `rnd` is a 0-to-1 random
 * source. Null when nobody else is on the pitch. */
export function nextReceiver(spots: Spot[], holder: number, previous: number | null, rnd: () => number): Spot | null {
  const me = spots.find((s) => s.id === holder);
  const close = nearest(spots, holder, 4);
  const options = close.filter((s) => s.id !== previous);
  const pool = options.length ? options : close;
  if (!pool.length || !me) return null;
  const weights = pool.map((s) => passWeight(me, s));
  let r = rnd() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r < 0) return pool[i];
  }
  return pool[pool.length - 1];
}

/** How long a receiver keeps the ball before his wind-up starts: sometimes none at all (a
 * first-time pass), otherwise anything from a quick touch to a look around. */
export function receiveHold(rnd: () => number): number {
  const r = rnd();
  if (r < ONE_TOUCH_CHANCE) return 0;
  return 0.15 + ((r - ONE_TOUCH_CHANCE) / (1 - ONE_TOUCH_CHANCE)) * 0.75;
}

/** How long the ball takes to roll between two spots. */
export function passSeconds(distance: number): number {
  return Math.max(0.35, distance / PASS_SPEED);
}

/** How far along the pass the ball is at time-fraction `p`: quick off the boot, slowing as it goes
 * (it arrives at 40% of its starting pace, never dead). */
export function travel(p: number): number {
  const k = p < 0 ? 0 : p > 1 ? 1 : p;
  return k + 0.6 * k * (1 - k);
}

/** Where the ball is `p` (0 to 1) of the way along a pass. A short pass rolls along the ground;
 * a long one is lofted, higher the longer it is. */
export function ballAt(from: { x: number; z: number }, to: { x: number; z: number }, p: number) {
  const k = p < 0 ? 0 : p > 1 ? 1 : p;
  const d = travel(k);
  const length = Math.hypot(to.x - from.x, to.z - from.z);
  const loft = length >= LONG_PASS ? Math.min(1.6, 0.09 * length) : 0;
  return {
    x: from.x + (to.x - from.x) * d,
    y: BALL_REST_Y + loft * Math.sin(Math.PI * k),
    z: from.z + (to.z - from.z) * d,
  };
}

/** The ball being set for the next pass during a hold: `q` (0 to 1) of the way from where it came to
 * rest after the first touch to where he kicks it from, easing in. */
export function setBall(from: { x: number; z: number }, to: { x: number; z: number }, q: number) {
  const k = q < 0 ? 0 : q > 1 ? 1 : q;
  const e = 1 - (1 - k) * (1 - k);
  return { x: from.x + (to.x - from.x) * e, z: from.z + (to.z - from.z) * e };
}

/** The receiving leg for `t` seconds after the ball arrives: lifted a little forward to meet it and
 * brought back down, over `span` seconds (shorter when he passes again quickly). */
export function cushionLeg(t: number, span = CUSHION_SECONDS): { hip: number; knee: number } {
  if (t <= 0 || span <= 0 || t >= span) return { hip: 0, knee: 0 };
  const s = Math.sin((Math.PI * t) / span);
  return { hip: -0.35 * s, knee: 0.4 * s };
}

/** The kicking leg's hip and knee for `t` seconds into the hold: the leg draws back, then swings through
 * at KICK_AT, then settles. Hip rotation about x is positive backwards, negative forwards. */
export function kickLeg(t: number): { hip: number; knee: number } {
  if (t <= 0) return { hip: 0, knee: 0 };
  if (t < KICK_AT) {
    const k = t / KICK_AT; // draw back
    return { hip: 0.7 * k, knee: 0.9 * k };
  }
  const k = Math.min(1, (t - KICK_AT) / 0.25); // swing through
  const settle = Math.max(0, Math.min(1, (t - KICK_AT - 0.25) / 0.2));
  return { hip: (0.7 - 1.7 * k) * (1 - settle), knee: (0.9 - 0.8 * k) * (1 - settle) };
}

/** The turn (radians, 0 = facing the camera) to look from one spot towards another, kept short of a
 * full turn so nobody turns his back on the viewer. */
export function facing(from: { x: number; z: number }, to: { x: number; z: number }, limit = 1.2): number {
  const a = Math.atan2(to.x - from.x, to.z - from.z);
  return a < -limit ? -limit : a > limit ? limit : a;
}
