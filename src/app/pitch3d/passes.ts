/* The ball going round the pitch while nobody is selected. Players stay on their spots: the
 * holder turns to a teammate and kicks, the ball rolls across, the receiver turns to meet it.
 * Pure functions, so the choices and timings can be tested without three.js. */

export type Spot = { id: number; x: number; z: number };

export const PASS_SPEED = 8; // units per second along the ground
export const HOLD_SECONDS = 0.6; // how long a player has the ball before he kicks
export const KICK_AT = 0.3; // seconds into the hold when his foot meets the ball
export const BALL_REST_Y = 0.36;

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

/** Who gets the ball next: one of the three nearest, never straight back to where it came from
 * unless there is no one else. `rnd` is a 0-to-1 random source. Null when nobody else is on the pitch. */
export function nextReceiver(spots: Spot[], holder: number, previous: number | null, rnd: () => number): Spot | null {
  const close = nearest(spots, holder, 3);
  const options = close.filter((s) => s.id !== previous);
  const pool = options.length ? options : close;
  if (!pool.length) return null;
  return pool[Math.min(pool.length - 1, Math.floor(rnd() * pool.length))];
}

/** How long the ball takes to roll between two spots. */
export function passSeconds(distance: number): number {
  return Math.max(0.35, distance / PASS_SPEED);
}

/** Where the ball is `p` (0 to 1) of the way along a pass: rolling, with a small hop. */
export function ballAt(from: { x: number; z: number }, to: { x: number; z: number }, p: number) {
  const k = p < 0 ? 0 : p > 1 ? 1 : p;
  return {
    x: from.x + (to.x - from.x) * k,
    y: BALL_REST_Y + 0.45 * Math.sin(Math.PI * k),
    z: from.z + (to.z - from.z) * k,
  };
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
