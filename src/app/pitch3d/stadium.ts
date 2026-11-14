import * as THREE from "three";
import { seeded } from "./look";

/* The ground around the pitch: goals with nets, advertising boards and, where the device can take
 * it, stands with a crowd. Built once per stage; the crowd is one instanced draw call and only
 * moves while it is cheering. Pure helpers are exported for the unit tests. */

/** Half the pitch's width and length (the grass plane is 22 x 36). */
export const PITCH_HALF_W = 11;
export const PITCH_HALF_L = 18;
/** The goal line, where the markings end (20px margin on the 470 x 768 texture). */
export const GOAL_LINE = PITCH_HALF_L - (20 / 768) * 36;

/** Whether a device should skip the crowd: few cores, little memory, or data saver on. */
export function lowPowerDevice(nav: { hardwareConcurrency?: number; deviceMemory?: number; connection?: { saveData?: boolean } } | undefined): boolean {
  if (!nav) return true;
  if (nav.connection?.saveData) return true;
  if (nav.deviceMemory != null && nav.deviceMemory <= 2) return true;
  if (nav.hardwareConcurrency != null && nav.hardwareConcurrency <= 4) return true;
  return false;
}

/** How far the back of the net bellies out at time t (s) after a goal, at a point u, v (0..1 across
 * and up the net). A ripple that starts where the ball hit and dies away within RIPPLE_SECONDS. */
export const RIPPLE_SECONDS = 1.4;
export function netBulge(t: number, u: number, v: number, hitU = 0.6, hitV = 0.4): number {
  if (t < 0 || t >= RIPPLE_SECONDS) return 0;
  const d = Math.hypot(u - hitU, v - hitV);
  const decay = 1 - t / RIPPLE_SECONDS;
  const edge = Math.sin(Math.PI * u) * Math.sin(Math.PI * Math.min(1, v * 1.2)); // fixed at the frame
  return 0.55 * decay * decay * edge * Math.cos(9 * d - 14 * t) * Math.exp(-2.2 * d);
}

/** How high a fan is lifted at time t (s) after a goal: everyone jumps, each a little out of step. */
export const CHEER_SECONDS = 1.8;
export function cheerLift(t: number, offset: number): number {
  const s = t - offset;
  if (s <= 0 || s >= CHEER_SECONDS - 0.2) return 0;
  return Math.max(0, Math.sin(s * 9)) * 0.28 * (1 - s / CHEER_SECONDS);
}

export type Stadium = {
  /** A goal for our eleven: the near net ripples and the crowd jumps; step() animates it. */
  goal(): void;
  /** Advance the net and crowd by dt. True while either is still moving. */
  step(dt: number): boolean;
};

function boardCanvas(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 64;
  const g = c.getContext("2d")!;
  const words = ["GAFFERFPL", "PLAN AHEAD", "CAPTAIN WELL", "BANK THE FT", "TRUST THE xP"];
  const seg = c.width / words.length;
  words.forEach((w, i) => {
    g.fillStyle = i % 2 ? "#0d3b2a" : "#102a45";
    g.fillRect(i * seg, 0, seg, c.height);
    g.fillStyle = i % 2 ? "#35e0a3" : "#f3f6fa";
    g.font = "bold 34px system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(w, i * seg + seg / 2, c.height / 2 + 2);
  });
  return c;
}

export function buildStadium(
  scene: THREE.Scene,
  own: <T extends { dispose(): void }>(o: T) => T,
  opts: { crowd: boolean; reduceMotion: boolean },
): Stadium {
  const white = own(new THREE.MeshLambertMaterial({ color: 0xf2f4f7 }));

  // goals: posts and bar, with a net of lines that can ripple
  const W = 3.4;
  const H = 1.25;
  const D = 1.1;
  const post = own(new THREE.CylinderGeometry(0.07, 0.07, H, 8));
  const bar = own(new THREE.CylinderGeometry(0.07, 0.07, W, 8));
  const COLS = 14;
  const ROWS = 6;
  // the net our eleven score in: the near one (the keeper stands at the far end)
  let scoringNet: { geo: THREE.BufferGeometry; base: Float32Array; z: number } | null = null;
  for (const end of [-1, 1]) {
    const z = end * GOAL_LINE;
    const back = z + end * D;
    for (const x of [-W / 2, W / 2]) {
      const m = new THREE.Mesh(post, white);
      m.position.set(x, H / 2, z);
      scene.add(m);
    }
    const b = new THREE.Mesh(bar, white);
    b.rotation.z = Math.PI / 2;
    b.position.set(0, H, z);
    scene.add(b);
    // the net: a grid on the back (which ripples) and the roof and sides as plain lines
    const pts: number[] = [];
    const line = (a: number[], c: number[]) => pts.push(...a, ...c);
    for (let i = 0; i <= COLS; i++) {
      const x = -W / 2 + (W * i) / COLS;
      line([x, 0, back], [x, H * 0.9, back]);
      line([x, H * 0.9, back], [x, H, z]);
    }
    for (let j = 0; j <= ROWS; j++) {
      const y = (H * 0.9 * j) / ROWS;
      line([-W / 2, y, back], [W / 2, y, back]);
      line([-W / 2, y, back], [-W / 2, Math.min(H, y), z]);
      line([W / 2, y, back], [W / 2, Math.min(H, y), z]);
    }
    const geo = own(new THREE.BufferGeometry());
    const arr = new Float32Array(pts);
    geo.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    const net = new THREE.LineSegments(geo, own(new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 })));
    net.frustumCulled = false;
    scene.add(net);
    if (end > 0) scoringNet = { geo, base: arr.slice(), z: back };
  }

  // advertising boards along both sides and behind each goal
  const boardTex = own(new THREE.CanvasTexture(boardCanvas()));
  boardTex.wrapS = THREE.RepeatWrapping;
  const boardMat = own(new THREE.MeshBasicMaterial({ map: boardTex }));
  const sideBoard = own(new THREE.BoxGeometry(0.12, 0.62, PITCH_HALF_L * 2 + 1));
  const endBoard = own(new THREE.BoxGeometry(PITCH_HALF_W * 2 + 1, 0.62, 0.12));
  const sideTex = boardTex.clone();
  sideTex.repeat.set(3, 1);
  sideTex.needsUpdate = true;
  own(sideTex);
  const sideMat = own(new THREE.MeshBasicMaterial({ map: sideTex }));
  for (const sx of [-1, 1]) {
    const m = new THREE.Mesh(sideBoard, sideMat);
    m.position.set(sx * (PITCH_HALF_W + 0.9), 0.31, 0);
    scene.add(m);
  }
  for (const sz of [-1, 1]) {
    const m = new THREE.Mesh(endBoard, boardMat);
    m.position.set(0, 0.31, sz * (PITCH_HALF_L + 1.6));
    scene.add(m);
  }

  // stands and crowd: tiers rising behind the boards on the two sides and the far end
  const fans: { x: number; y: number; z: number; off: number }[] = [];
  let crowd: THREE.InstancedMesh | null = null;
  if (opts.crowd) {
    const standMat = own(new THREE.MeshLambertMaterial({ color: 0x0b1712 }));
    const TIERS = 6;
    const STEP_UP = 0.55;
    const STEP_BACK = 0.75;
    const rand = seeded(1888);
    const addStand = (alongX: boolean, sign: number, start: number, length: number) => {
      for (let t = 0; t < TIERS; t++) {
        const depth = STEP_BACK;
        const geo = own(alongX ? new THREE.BoxGeometry(length, STEP_UP * (t + 1), depth) : new THREE.BoxGeometry(depth, STEP_UP * (t + 1), length));
        const m = new THREE.Mesh(geo, standMat);
        const out = start + t * STEP_BACK + depth / 2;
        if (alongX) m.position.set(0, (STEP_UP * (t + 1)) / 2, sign * out);
        else m.position.set(sign * out, (STEP_UP * (t + 1)) / 2, 0);
        scene.add(m);
        // a fan every ~0.7 along the tier, with a few gaps
        const n = Math.floor(length / 0.7);
        for (let i = 0; i < n; i++) {
          if (rand() < 0.12) continue;
          const a = -length / 2 + (i + 0.5) * (length / n) + (rand() - 0.5) * 0.2;
          const y = STEP_UP * (t + 1) + 0.28;
          fans.push(alongX ? { x: a, y, z: sign * out, off: rand() * 0.35 } : { x: sign * out, y, z: a, off: rand() * 0.35 });
        }
      }
    };
    addStand(false, -1, PITCH_HALF_W + 1.4, PITCH_HALF_L * 2 + 4);
    addStand(false, 1, PITCH_HALF_W + 1.4, PITCH_HALF_L * 2 + 4);
    addStand(true, -1, PITCH_HALF_L + 2.1, PITCH_HALF_W * 2 + 6);

    const body = own(new THREE.CapsuleGeometry(0.17, 0.26, 2, 6));
    const fanMat = own(new THREE.MeshLambertMaterial({ color: 0xffffff }));
    crowd = new THREE.InstancedMesh(body, fanMat, fans.length);
    const palette = ["#c8102e", "#f3f6fa", "#1d4ed8", "#35e0a3", "#f3b94d", "#6b7280", "#111827", "#7c3aed"];
    const tint = new THREE.Color();
    const m = new THREE.Matrix4();
    fans.forEach((f, i) => {
      m.makeTranslation(f.x, f.y, f.z);
      crowd!.setMatrixAt(i, m);
      crowd!.setColorAt(i, tint.set(palette[Math.floor(rand() * palette.length)]).multiplyScalar(0.75));
    });
    crowd.instanceMatrix.needsUpdate = true;
    if (crowd.instanceColor) crowd.instanceColor.needsUpdate = true;
    scene.add(crowd);
  }

  let rippleT: number | null = null;
  let cheerT: number | null = null;
  const tmp = new THREE.Matrix4();
  return {
    goal() {
      if (opts.reduceMotion) return;
      rippleT = 0;
      if (crowd) cheerT = 0;
    },
    step(dt) {
      let moving = false;
      if (rippleT != null && scoringNet) {
        rippleT += dt;
        const pos = scoringNet.geo.attributes.position.array as Float32Array;
        for (let i = 0; i < pos.length; i += 3) {
          const bx = scoringNet.base[i];
          const by = scoringNet.base[i + 1];
          const bz = scoringNet.base[i + 2];
          // only the back of the net (at the back depth) bellies out
          if (Math.abs(bz - scoringNet.z) > 1e-3) continue;
          const u = (bx + W / 2) / W;
          const v = by / H;
          pos[i + 2] = bz + netBulge(rippleT, u, v); // out, away from the pitch
        }
        scoringNet.geo.attributes.position.needsUpdate = true;
        if (rippleT >= RIPPLE_SECONDS) {
          (scoringNet.geo.attributes.position.array as Float32Array).set(scoringNet.base);
          scoringNet.geo.attributes.position.needsUpdate = true;
          rippleT = null;
        } else moving = true;
      }
      if (cheerT != null && crowd) {
        cheerT += dt;
        fans.forEach((f, i) => {
          tmp.makeTranslation(f.x, f.y + cheerLift(cheerT!, f.off), f.z);
          crowd!.setMatrixAt(i, tmp);
        });
        crowd.instanceMatrix.needsUpdate = true;
        if (cheerT >= CHEER_SECONDS) cheerT = null;
        else moving = true;
      }
      return moving;
    },
  };
}
