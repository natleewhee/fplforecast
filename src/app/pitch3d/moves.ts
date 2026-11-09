/* The 3D pitch's camera shots and celebrations, as pure functions of time.
 * No three.js in here, so the timings can be tested on their own: the stage
 * asks "what pose is this figure in at t seconds?" and applies the answer. */

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** Smooth start and stop. */
export const ease = (v: number) => {
  const x = clamp01(v);
  return x * x * (3 - 2 * x);
};
/** Fast start, soft landing. */
export const easeOut = (v: number) => 1 - (1 - clamp01(v)) ** 3;
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/* ---------- camera ---------- */

export type Shot = { pos: [number, number, number]; look: [number, number, number]; fov: number };

/** The centred, high view of the whole pitch. */
export const BROADCAST: Shot = { pos: [0, 21.5, 24.5], look: [0, 0, -3.6], fov: 46 };

/** A close view of one player from further back and higher than before: a narrow lens at a
 * distance keeps the perspective gentle, so a player in the foreground is not a giant head.
 * `scale` is his drawn size. */
export function focusShot(x: number, z: number, scale: number): Shot {
  return {
    pos: [x * 0.6, 1.5 * scale + 8, z + 15],
    look: [x, 1.1 * scale, z + 1.2],
    fov: 30,
  };
}

/** Seconds the camera takes to glide between shots. */
export const GLIDE_SECONDS = 0.75;

/* ---------- celebrations ---------- */

export type Arm = { x: number; z: number };
export type Pose = {
  /** Forward travel from the player's spot, along the pitch. */
  dz: number;
  yaw: number;
  /** Height of the whole body inside the figure (negative sinks it). */
  bodyY: number;
  bodyRx: number;
  armL: Arm;
  armR: Arm;
  hipL: Arm;
  hipR: Arm;
  kneeLx: number;
  kneeRx: number;
  /** Bricks laid so far in the wall around him (fractional: the newest is still falling into place),
   * and how intact the wall is (1) as it crumbles away (0). */
  bricks: number;
  wallFade: number;
  /** True from the moment the confetti should go off. */
  burst: boolean;
};

const NEUTRAL_ARM: Arm = { x: 0, z: 0 };
const base = (): Pose => ({
  dz: 0,
  yaw: 0,
  bodyY: 0,
  bodyRx: 0,
  armL: { ...NEUTRAL_ARM },
  armR: { ...NEUTRAL_ARM },
  hipL: { ...NEUTRAL_ARM },
  hipR: { ...NEUTRAL_ARM },
  kneeLx: 0,
  kneeRx: 0,
  bricks: 0,
  wallFade: 1,
  burst: false,
});

/** Standing (or seated) at rest: every joint at its resting value. */
export const restingPose = (): Pose => base();

export type MomentKind = "goal" | "cleanSheet";

/** How long each celebration lasts. A bench cheer is shorter. */
export const GOAL_SECONDS = 3.6;
export const BENCH_CHEER_SECONDS = 2.2;

const RUN = 0.9; // run towards the corner
const SLIDE = 0.6; // knee slide
const HOLD = 1.2; // arms out, fist pump (and the spin for a brace)
const BACK = 0.9; // up and back to his spot
const RUN_DIST = 3.4;
const SLIDE_DIST = 1.4;
const SINK = -0.5;

/** The knee slide: run, slide on the knees with arms spread, fist pump, jog back.
 * `goals` shapes it: two or more add a spin while kneeling, three or more a confetti burst. */
export function goalPose(t: number, goals: number): Pose {
  const p = base();
  const swing = Math.sin(t * 11);
  if (t < RUN) {
    const k = t / RUN;
    p.dz = RUN_DIST * ease(k);
    p.hipL.x = swing * 0.8;
    p.hipR.x = -swing * 0.8;
    p.kneeLx = Math.max(0, Math.cos(t * 11)) * 0.9;
    p.kneeRx = Math.max(0, -Math.cos(t * 11)) * 0.9;
    p.armL.x = -swing * 0.8;
    p.armR.x = swing * 0.8;
    p.bodyRx = 0.15;
    return p;
  }
  const slideK = easeOut((t - RUN) / SLIDE);
  if (t < RUN + SLIDE + HOLD) {
    p.dz = RUN_DIST + SLIDE_DIST * slideK;
    p.bodyY = SINK * slideK;
    p.bodyRx = -0.35 * slideK;
    p.kneeLx = p.kneeRx = 1.7 * slideK;
    p.armL.z = -1.55 * slideK;
    p.armR.z = 1.55 * slideK;
    const held = t - (RUN + SLIDE);
    if (held > 0) {
      if (goals >= 2) p.yaw = Math.PI * 2 * ease(held / HOLD);
      if (held > 0.3) {
        // right fist pumps while the left arm stays out
        p.armR.x = -2.6 + 0.25 * Math.sin((held - 0.3) * 14);
        p.armR.z = 0.3;
      }
      if (goals >= 3) p.burst = true;
    }
    return p;
  }
  const r = (t - (RUN + SLIDE + HOLD)) / BACK;
  const up = ease(r);
  p.dz = (RUN_DIST + SLIDE_DIST) * (1 - up);
  p.bodyY = SINK * (1 - up);
  p.bodyRx = -0.35 * (1 - up);
  p.kneeLx = p.kneeRx = 1.7 * (1 - up);
  p.armL.z = -1.55 * (1 - up);
  p.armR.z = 1.55 * (1 - up);
  if (r > 0.3 && r < 1) {
    // jog the last of the way
    p.hipL.x = swing * 0.6;
    p.hipR.x = -swing * 0.6;
  }
  return p;
}

/** The brick wall: he builds it round himself one brick at a time, dusts his hands, folds his
 * arms with a nod, and the wall crumbles away. */
export const WALL_BRICKS = 30;
export const WALL_PER_COURSE = 10;
const BUILD_START = 0.3;
const BRICK_EVERY = 0.075;
const BUILD_END = BUILD_START + WALL_BRICKS * BRICK_EVERY; // 2.55
const DUST_END = BUILD_END + 0.9;
const FOLD_END = DUST_END + 1.0;
const CRUMBLE = 0.6;
export const CLEAN_SHEET_SECONDS = FOLD_END + CRUMBLE; // 5.05

export function cleanSheetPose(t: number): Pose {
  const p = base();
  const settle = ease(t / 0.3);
  p.hipL.z = -0.12 * settle;
  p.hipR.z = 0.12 * settle;
  p.bricks = clamp01((t - BUILD_START) / (BUILD_END - BUILD_START)) * WALL_BRICKS;
  if (t < BUILD_END) {
    // placing bricks: stooping a little, hands reaching forward in turn
    const w = Math.sin(t * 9);
    p.bodyRx = 0.16 * settle;
    p.armL = { x: (-1.0 + 0.35 * w) * settle, z: 0.2 * settle };
    p.armR = { x: (-1.0 - 0.35 * w) * settle, z: -0.2 * settle };
  } else if (t < DUST_END) {
    // dusting his hands: palms rubbing together in front of him
    const rub = Math.sin((t - BUILD_END) * 20);
    const bring = lerp(0.2, 0.55, ease((t - BUILD_END) / 0.15)); // hands come together, not a jump
    p.bodyRx = 0.05;
    p.armL = { x: -1.0 + 0.18 * rub * ease((t - BUILD_END) / 0.15), z: bring };
    p.armR = { x: -1.0 - 0.18 * rub * ease((t - BUILD_END) / 0.15), z: -bring };
  } else {
    // arms folded across the chest, a slow nod
    const fold = ease((t - DUST_END) / 0.25); // from where the hands were, to folded
    p.armL = { x: lerp(-1.0, -1.1, fold), z: lerp(0.55, 0.95, fold) };
    p.armR = { x: lerp(-1.0, -1.1, fold), z: -lerp(0.55, 0.95, fold) };
    p.bodyRx = 0.09 * Math.sin((t - DUST_END) * 5);
  }
  p.wallFade = t < FOLD_END ? 1 : clamp01(1 - (t - FOLD_END) / CRUMBLE);
  return p;
}

/** A player on the bench stays seated and cheers: arms up, bouncing. The seat pose is the
 * stage's own, so this only returns the changes on top of it. */
export function benchCheerPose(t: number): Pose {
  const p = base();
  const fade = clamp01(1 - (t - (BENCH_CHEER_SECONDS - 0.3)) / 0.3);
  p.bodyY = Math.abs(Math.sin(t * 7)) * 0.22 * fade;
  const pump = Math.sin(t * 12) * 0.25;
  p.armL.z = -(2.55 + pump) * fade;
  p.armR.z = (2.55 - pump) * fade;
  return p;
}

export function momentSeconds(kind: MomentKind, bench: boolean): number {
  if (bench && kind === "goal") return BENCH_CHEER_SECONDS;
  return kind === "goal" ? GOAL_SECONDS : CLEAN_SHEET_SECONDS;
}

/** Blend two poses (used to ease from a figure's resting pose into a celebration). */
export function blend(a: Pose, b: Pose, k: number): Pose {
  const arm = (x: Arm, y: Arm): Arm => ({ x: lerp(x.x, y.x, k), z: lerp(x.z, y.z, k) });
  return {
    dz: lerp(a.dz, b.dz, k),
    yaw: lerp(a.yaw, b.yaw, k),
    bodyY: lerp(a.bodyY, b.bodyY, k),
    bodyRx: lerp(a.bodyRx, b.bodyRx, k),
    armL: arm(a.armL, b.armL),
    armR: arm(a.armR, b.armR),
    hipL: arm(a.hipL, b.hipL),
    hipR: arm(a.hipR, b.hipR),
    kneeLx: lerp(a.kneeLx, b.kneeLx, k),
    kneeRx: lerp(a.kneeRx, b.kneeRx, k),
    bricks: b.bricks,
    wallFade: b.wallFade,
    burst: b.burst,
  };
}

/** The moments to play for a player, in order: goals first, then the clean sheet. */
export function momentsFor(goals: number | undefined, cleanSheet: boolean | undefined): MomentKind[] {
  const out: MomentKind[] = [];
  if ((goals ?? 0) > 0) out.push("goal");
  if (cleanSheet) out.push("cleanSheet");
  return out;
}
