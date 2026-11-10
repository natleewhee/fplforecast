import * as THREE from "three";
import { SKIN_STEPS, type HairStyle } from "@/lib/appearance";
import { clearOverlaps } from "./tagLayout";
import { ballAt, facing, kickLeg, nextReceiver, passSeconds, BALL_REST_Y, HOLD_SECONDS, KICK_AT, type Spot } from "./passes";
import {
  BROADCAST,
  WALL_BRICKS,
  WALL_PER_COURSE,
  GLIDE_SECONDS,
  benchCheerPose,
  blend,
  cleanSheetPose,
  clamp01,
  ease,
  focusShot,
  goalPose,
  momentSeconds,
  restingPose,
  momentsFor,
  type MomentKind,
  type Pose,
  type Shot,
} from "./moves";

/* The 3D Squad pitch: stylised low-poly figures in kit colours on a floodlit
 * pitch, with the bench seated in a dugout at the side. Built from rounded
 * shapes in code (no model files), each figure merged into a handful of
 * meshes with baked vertex colours.
 *
 * The scene is static, so it only draws when something changes (new lineup,
 * selection, resize): no frame loop, no idle battery cost. */

// Match the look the figures were designed with: colours used as-is (no
// colour-space conversion) and lights at the pre-"physical units" strength.
THREE.ColorManagement.enabled = false;
const LIGHT = Math.PI;

export type FigureDef = {
  id: number;
  name: string;
  kit: { shirt: string; shorts: string; socks: string };
  cm: number;
  skin: number; // index into SKIN_STEPS
  hair: [HairStyle, string];
  captain: boolean;
  bench: boolean; // a seated figure; unused while the subs are a strip under the pitch
  dim?: number; // 0..1, fades players who have not played or are off
  goals?: number; // goals scored: he celebrates when tapped
  cleanSheet?: boolean; // clean sheet: he builds the brick wall when tapped

  x: number;
  z: number;
};


type Part = { geo: THREE.BufferGeometry; color: string; m: THREE.Matrix4 };
type PartOpts = { x?: number; y?: number; z?: number; rx?: number; ry?: number; rz?: number; sx?: number; sy?: number; sz?: number };

function P(geo: THREE.BufferGeometry, color: string, o: PartOpts = {}): Part {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(o.x ?? 0, o.y ?? 0, o.z ?? 0),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0)),
    new THREE.Vector3(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1),
  );
  return { geo, color, m };
}

/** Merge shapes into one geometry, baking each shape's colour into its vertices. */
function bake(parts: Part[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  let off = 0;
  for (const p of parts) {
    const g = p.geo.clone();
    g.applyMatrix4(p.m);
    const c = new THREE.Color(p.color);
    const pa = g.attributes.position;
    const na = g.attributes.normal;
    for (let i = 0; i < pa.count; i++) {
      pos.push(pa.getX(i), pa.getY(i), pa.getZ(i));
      nor.push(na.getX(i), na.getY(i), na.getZ(i));
      col.push(c.r, c.g, c.b);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + off);
    else for (let i = 0; i < pa.count; i++) idx.push(i + off);
    off += pa.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  out.setIndex(idx);
  return out;
}

const lathe = (points: [number, number][], seg = 24) =>
  new THREE.LatheGeometry(points.map((p) => new THREE.Vector2(p[0], p[1])), seg);

/** A capsule (cylinder with round ends), standing along y and centred on the origin. */
function capsule(r: number, len: number, seg = 10) {
  const pts: [number, number][] = [];
  const h = len / 2;
  const n = 4;
  for (let i = 0; i <= n; i++) {
    const a = -Math.PI / 2 + (i / n) * (Math.PI / 2);
    pts.push([Math.max(r * Math.cos(a), 0.0001), -h + r * Math.sin(a)]);
  }
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * (Math.PI / 2);
    pts.push([Math.max(r * Math.cos(a), 0.0001), h + r * Math.sin(a)]);
  }
  return lathe(pts, seg);
}

// fewer faces for small details (eyes, ears, hands, curls) than for the head
const ball = (r: number) => (r < 0.2 ? new THREE.SphereGeometry(r, 8, 6) : new THREE.SphereGeometry(r, 14, 10));

function hairParts(style: HairStyle, color: string): Part[] {
  const hy = 2.5;
  const parts: Part[] = [];
  const cap = (r: number, theta: number, o: PartOpts) =>
    P(new THREE.SphereGeometry(r, 16, 8, 0, Math.PI * 2, 0, Math.PI * theta), color, o);
  switch (style) {
    case "bald":
      break;
    case "buzz":
      parts.push(cap(0.35, 0.5, { y: hy, z: -0.04, sy: 1.08, rx: -0.5 }));
      break;
    case "sidepart":
      parts.push(cap(0.365, 0.52, { y: hy, z: -0.05, sy: 1.08, rx: -0.5 }));
      parts.push(P(ball(0.2), color, { x: -0.1, y: hy + 0.36, z: 0.08, sx: 1.35, sy: 0.55 }));
      break;
    case "curlytop":
      parts.push(cap(0.36, 0.46, { y: hy, z: -0.05, sy: 1.08, rx: -0.5 }));
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        parts.push(P(ball(0.11), color, { x: Math.cos(a) * 0.19, y: hy + 0.38, z: Math.sin(a) * 0.19 - 0.1 }));
      }
      parts.push(P(ball(0.13), color, { y: hy + 0.45, z: -0.1 }));
      break;
    case "curly":
      parts.push(cap(0.43, 0.56, { y: hy + 0.04, z: -0.1, sy: 0.9, rx: -0.5 }));
      break;
    case "bun":
      parts.push(cap(0.365, 0.52, { y: hy, z: -0.03, sy: 1.08, rx: -0.5 }));
      parts.push(P(ball(0.27), color, { y: hy + 0.02, z: -0.24, sx: 0.95, sy: 1.0, sz: 0.7 }));
      parts.push(P(ball(0.16), color, { y: hy + 0.42, z: -0.2 }));
      break;
    case "waves":
      parts.push(cap(0.385, 0.58, { y: hy, z: -0.03, sy: 1.06, rx: -0.5 }));
      parts.push(P(ball(0.13), color, { x: -0.31, y: hy - 0.06, z: -0.08 }));
      parts.push(P(ball(0.13), color, { x: 0.31, y: hy - 0.06, z: -0.08 }));
      break;
    default: // crop
      parts.push(cap(0.365, 0.52, { y: hy, z: -0.05, sy: 1.08, rx: -0.5 }));
  }
  return parts;
}

function pitchTexture() {
  const c = document.createElement("canvas");
  c.width = 470;
  c.height = 768;
  const g = c.getContext("2d")!;
  const bands = 12;
  for (let i = 0; i < bands; i++) {
    g.fillStyle = i % 2 ? "#1d6a3a" : "#1a6035";
    g.fillRect(0, (i * c.height) / bands, c.width, c.height / bands + 1);
  }
  g.strokeStyle = "rgba(255,255,255,0.7)";
  g.lineWidth = 4;
  const m = 20;
  g.strokeRect(m, m, c.width - m * 2, c.height - m * 2);
  g.beginPath();
  g.moveTo(m, c.height / 2);
  g.lineTo(c.width - m, c.height / 2);
  g.stroke();
  g.beginPath();
  g.arc(c.width / 2, c.height / 2, 58, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = "rgba(255,255,255,0.7)";
  g.beginPath();
  g.arc(c.width / 2, c.height / 2, 4, 0, Math.PI * 2);
  g.fill();
  for (const [y, d] of [[m, 1], [c.height - m, -1]] as const) {
    g.strokeRect(c.width / 2 - 115, d > 0 ? y : y - 130, 230, 130);
    g.strokeRect(c.width / 2 - 54, d > 0 ? y : y - 48, 108, 48);
    g.beginPath();
    g.arc(c.width / 2, y + d * 92, 3, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}

/** Heights about 1.5 times stronger than real, so the differences read on a phone. */
const scaleFor = (cm: number) => 1 + ((cm - 183) / 183) * 1.5;

type Joints = { body: THREE.Group; armL: THREE.Group; armR: THREE.Group; hipL: THREE.Group; hipR: THREE.Group; kneeL: THREE.Group; kneeR: THREE.Group };
/** What a figure is doing besides standing: celebrations queued for a tap, a glide to a new spot. */
type Anim = {
  queue: MomentKind[];
  current: { kind: MomentKind; t: number; burst: boolean } | null;
  slide: { fromX: number; fromZ: number; t: number } | null;
  pop: number | null; // seconds since he appeared, for a new arrival
  yaw: number; // how far he is turned (towards the ball while it is passed around)
};
type Figure = {
  g: THREE.Group;
  ring: THREE.Mesh;
  hit: THREE.Mesh;
  scale: number;
  def: FigureDef;
  owned: THREE.BufferGeometry[];
  disposables: { dispose(): void }[];
  mat: THREE.Material;
  joints: Joints;
  wall: THREE.InstancedMesh | null; // the clean-sheet brick wall
  anim: Anim;
  homeX: number;
  homeZ: number;
};

function buildFigure(def: FigureDef): Figure {
  const { kit } = def;
  const skin = SKIN_STEPS[def.skin] ?? SKIN_STEPS[2];
  const boot = "#15171c";
  const owned: THREE.BufferGeometry[] = [];
  const keep = (g: THREE.BufferGeometry) => (owned.push(g), g);

  const body = keep(
    bake([
      P(lathe([[0.0001, 1.0], [0.34, 1.02], [0.38, 1.2], [0.37, 1.42], [0.44, 1.7], [0.47, 1.88], [0.4, 2.04], [0.22, 2.12], [0.15, 2.16], [0.0001, 2.18]], 20), kit.shirt, { sx: 1.1, sz: 0.8 }),
      P(lathe([[0.0001, 0.78], [0.42, 0.78], [0.46, 0.86], [0.43, 1.1], [0.36, 1.2], [0.0001, 1.2]], 20), kit.shorts, { sx: 1.05, sz: 0.85 }),
      P(capsule(0.13, 0.2, 8), skin, { y: 2.2 }),
      P(ball(0.34), skin, { y: 2.5, sy: 1.08 }),
      P(ball(0.07), skin, { x: -0.33, y: 2.48 }),
      P(ball(0.07), skin, { x: 0.33, y: 2.48 }),
      P(ball(0.05), skin, { y: 2.45, z: 0.33 }),
      P(ball(0.052), "#17110d", { x: -0.125, y: 2.54, z: 0.3 }),
      P(ball(0.052), "#17110d", { x: 0.125, y: 2.54, z: 0.3 }),
      ...hairParts(def.hair[0], def.hair[1]),
    ]),
  );
  const armGeo = (band: boolean) => {
    const parts = [
      P(capsule(0.115, 0.42), kit.shirt, { y: -0.22 }),
      P(capsule(0.09, 0.4), skin, { y: -0.58 }),
      P(ball(0.1), skin, { y: -0.84 }),
    ];
    if (band) parts.push(P(new THREE.CylinderGeometry(0.135, 0.135, 0.13, 10), "#f3b94d", { y: -0.3 }));
    return keep(bake(parts));
  };
  const thigh = keep(bake([P(capsule(0.15, 0.3), skin, { y: -0.22 }), P(capsule(0.16, 0.18), kit.shorts, { y: -0.08 })]));
  const shin = keep(bake([P(capsule(0.115, 0.34), kit.socks, { y: -0.22 }), P(ball(0.14), boot, { y: -0.43, z: 0.07, sx: 1, sy: 0.7, sz: 1.5 })]));

  const dim = def.dim ?? 1;
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: dim < 1, opacity: dim });
  const g = new THREE.Group();
  const b = new THREE.Group();
  g.add(b);
  b.add(new THREE.Mesh(body, mat));

  const arms: THREE.Group[] = [];
  const hips: THREE.Group[] = [];
  const knees: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const piv = new THREE.Group();
    piv.position.set(side * 0.58, 1.95, 0);
    piv.add(new THREE.Mesh(armGeo(def.captain && side === -1), mat));
    // standing: arms hang a little away from the body; seated: hands on knees
    piv.rotation.set(def.bench ? -0.7 : 0, 0, side * (def.bench ? 0.12 : 0.08));
    b.add(piv);
    arms.push(piv);

    const hip = new THREE.Group();
    hip.position.set(side * 0.2, 0.92, 0);
    hip.add(new THREE.Mesh(thigh, mat));
    const knee = new THREE.Group();
    knee.position.set(0, -0.44, 0);
    knee.add(new THREE.Mesh(shin, mat));
    hip.add(knee);
    if (def.bench) {
      hip.rotation.x = -1.5;
      knee.rotation.x = 1.5;
    }
    b.add(hip);
    hips.push(hip);
    knees.push(knee);
  }
  if (def.bench) b.position.y = -0.43;

  const blob = new THREE.Mesh(new THREE.CircleGeometry(0.95, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3 }));
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.03;
  blob.visible = !def.bench;
  g.add(blob);
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.15, 1.32, 36), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.05;
  ring.visible = false;
  g.add(ring);

  const hit = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 3, 8), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  hit.position.y = def.bench ? 1.2 : 1.5;
  hit.userData.id = def.id;
  g.add(hit);

  const disposables: { dispose(): void }[] = [];
  let wall: THREE.InstancedMesh | null = null;
  if (def.cleanSheet) {
    // thirty bricks in three courses round him, laid one at a time when he celebrates
    const brickGeo = new THREE.BoxGeometry(0.95, 0.36, 0.34);
    const brickMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true });
    wall = new THREE.InstancedMesh(brickGeo, brickMat, WALL_BRICKS);
    const tint = new THREE.Color();
    for (let i = 0; i < WALL_BRICKS; i++) wall.setColorAt(i, tint.setHSL(0.03 + (i % 3) * 0.008, 0.55, 0.38 + ((i * 7) % 5) * 0.025));
    wall.count = 0;
    wall.visible = false;
    wall.frustumCulled = false;
    g.add(wall);
    disposables.push(brickGeo, brickMat, wall);
  }

  const scale = scaleFor(def.cm);
  g.scale.setScalar(scale);
  g.position.set(def.x, 0.05, def.z);
  g.rotation.y = 0;
  return {
    g,
    ring,
    hit,
    scale,
    def,
    owned,
    disposables,
    mat,
    joints: { body: b, armL: arms[0], armR: arms[1], hipL: hips[0], hipR: hips[1], kneeL: knees[0], kneeR: knees[1] },
    wall,
    anim: { queue: [], current: null, slide: null, pop: null, yaw: 0 },
    homeX: def.x,
    homeZ: def.z,
  };
}

export type StageHandle = {
  setPlayers(defs: FigureDef[]): void;
  /** Tapping a player: the camera glides to him and he celebrates; null glides back. */
  setSelected(id: number | null): void;
  /** A live event: the player plays that moment where he stands, with no selection and no camera move.
   * "busy": a moment is already playing (the caller may queue one). "refused": reduced motion, someone
   * is selected, or he is not a starter free to move (the caller should drop it). */
  celebrate(id: number, kind: MomentKind): "played" | "busy" | "refused";
  /** The ball going round the XI while nobody is selected; the players stay on their spots. */
  setAmbient(on: boolean): void;
  dispose(): void;
};

/** What the stage reports for the page (and the tests) to show. */
export type StageState = { focusId: number | null; celebrating: MomentKind | null };

export type StageOptions = {
  host: HTMLElement; // sized by CSS; the stage fills it
  tagLayer: HTMLElement; // holds one element per player, marked data-tag="<id>"
  onPick(id: number): void;
  onState?(state: StageState): void;
  onPass?(count: number): void; // how many passes so far; kept apart from onState so a pass does not re-render the page
  ambient?: boolean; // start with the passing on (default true)
};

/** Create the scene on a canvas of its own (so a remount never reuses a lost context).
 * Throws if WebGL is unavailable or setup fails, so the caller can fall back to 2D. */
export function createStage(opts: StageOptions): StageHandle {
  const canvas = document.createElement("canvas");
  canvas.className = "absolute inset-0 block h-full w-full";
  canvas.setAttribute("aria-hidden", "true");
  opts.host.insertBefore(canvas, opts.host.firstChild);
  let renderer: THREE.WebGLRenderer | null = null;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "low-power" });
    return setup(renderer, canvas, opts);
  } catch (e) {
    renderer?.dispose();
    renderer?.forceContextLoss();
    canvas.remove();
    throw e;
  }
}

function setup(renderer: THREE.WebGLRenderer, canvas: HTMLCanvasElement, opts: StageOptions): StageHandle {
  const { host, tagLayer, onPick } = opts;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a1a14);
  scene.fog = new THREE.Fog(0x0a1a14, 66, 130);
  const camera = new THREE.PerspectiveCamera(48, 0.8, 0.5, 160);
  const raycaster = new THREE.Raycaster();
  scene.add(new THREE.HemisphereLight(0xe6f4ff, 0x1b3a2a, 1.0 * LIGHT));
  const sun = new THREE.DirectionalLight(0xffffff, 0.7 * LIGHT);
  sun.position.set(8, 18, 12);
  scene.add(sun);

  const staticOwned: { dispose(): void }[] = [];
  const own = <T extends { dispose(): void }>(o: T) => (staticOwned.push(o), o);

  const pitchTex = own(pitchTexture());
  const pitch = new THREE.Mesh(own(new THREE.PlaneGeometry(22, 36)), own(new THREE.MeshLambertMaterial({ map: pitchTex })));
  pitch.rotation.x = -Math.PI / 2;
  scene.add(pitch);
  const apron = new THREE.Mesh(own(new THREE.PlaneGeometry(200, 200)), own(new THREE.MeshLambertMaterial({ color: 0x0c1f17 })));
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = -0.03;
  scene.add(apron);

  let reduceMotion = false;
  try {
    reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {}

  // The camera: where it is now, and a glide to somewhere else. fov is for a stage 0.8 wide per
  // 1 high, widened or narrowed to the real shape.
  const cam: Shot = { pos: [...BROADCAST.pos], look: [...BROADCAST.look], fov: BROADCAST.fov };
  let glide: { from: Shot; to: Shot; t: number } | null = null;
  const lookAt = new THREE.Vector3();
  function applyCamera() {
    camera.fov = ((2 * Math.atan((Math.tan((cam.fov * Math.PI) / 360) * 0.8) / Math.min(camera.aspect, 1))) * 180) / Math.PI;
    camera.position.fromArray(cam.pos);
    camera.lookAt(lookAt.fromArray(cam.look));
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }
  function goTo(shot: Shot) {
    if (reduceMotion) {
      cam.pos = [...shot.pos];
      cam.look = [...shot.look];
      cam.fov = shot.fov;
      glide = null;
      applyCamera();
      draw();
      return;
    }
    glide = { from: { pos: [...cam.pos], look: [...cam.look], fov: cam.fov }, to: shot, t: 0 };
    draw();
  }

  let figures: Figure[] = [];
  let selected: number | null = null;
  let size = { w: 0, h: 0 };
  let raf = 0;
  let lastTs = 0;
  let ambientOnly = false;
  let disposed = false;
  let celebrating: MomentKind | null = null;
  let reported = { focusId: null as number | null, celebrating: null as MomentKind | null };
  const report = () => {
    // the page re-renders on this, so only say so when something it shows has changed
    if (reported.focusId === selected && reported.celebrating === celebrating) return;
    reported = { focusId: selected, celebrating };
    opts.onState?.({ focusId: selected, celebrating });
  };

  /* ambient passing: the ball goes round the starting eleven, who stay where they are. */
  let ambient = opts.ambient !== false && !reduceMotion;
  let passes = 0;
  type Pass = { from: Figure; to: Figure; phase: "hold" | "fly"; t: number; legT: number; dur: number; last: number | null };
  let pass: Pass | null = null;
  // a kicker's leg keeps swinging through and settles for a moment after the ball has gone
  let settling: { f: Figure; t: number }[] = [];
  let ball: THREE.Mesh | null = null;
  const spotOf = (f: Figure): Spot => ({ id: f.def.id, x: f.homeX, z: f.homeZ });
  function ensureBall(): THREE.Mesh {
    if (ball) return ball;
    const geo = new THREE.IcosahedronGeometry(0.36, 1).toNonIndexed();
    const n = geo.attributes.position.count / 3;
    const col = new Float32Array(n * 9);
    for (let i = 0; i < n; i++) {
      const dark = i % 5 === 0 ? 0.12 : 0.95;
      for (let k = 0; k < 9; k++) col[i * 9 + k] = dark;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    ball = new THREE.Mesh(own(geo), own(new THREE.MeshLambertMaterial({ vertexColors: true })));
    ball.visible = false;
    scene.add(ball);
    return ball;
  }
  const legReset = (f: Figure) => {
    f.joints.hipR.rotation.x = 0;
    f.joints.kneeR.rotation.x = 0;
  };
  /** Stand everyone square again and put the ball away (when a player is picked, or passing is switched off). */
  function stopPassing() {
    if (pass) legReset(pass.from);
    for (const s of settling) legReset(s.f);
    settling = [];
    pass = null;
    if (ball) ball.visible = false;
    for (const f of figures) {
      if (f.def.bench) continue;
      f.anim.yaw = 0;
      if (!f.anim.current && !f.anim.slide) f.g.rotation.y = 0;
    }
  }
  const xi = () => figures.filter((f) => !f.def.bench && !f.anim.slide && f.anim.pop == null);
  /** `wait` is extra time he keeps the ball before the usual wind-up (a receiver holds it a moment first). */
  function startPass(from: Figure, last: number | null, wait = 0): boolean {
    const pool = xi();
    if (pool.length < 3) return false;
    const to = nextReceiver(pool.map(spotOf), from.def.id, last, Math.random);
    const target = to && pool.find((f) => f.def.id === to.id);
    if (!target) return false;
    settling = settling.filter((s) => s.f !== from);
    pass = {
      from,
      to: target,
      phase: "hold",
      t: -wait,
      legT: -wait,
      dur: passSeconds(Math.hypot(from.homeX - target.homeX, from.homeZ - target.homeZ)),
      last,
    };
    return true;
  }
  /** Advance the passing by dt. Returns true while it is running. */
  function stepPassing(dt: number): boolean {
    if (!ambient || selected != null || celebrating !== null || figures.length === 0 || figures.some((f) => f.anim.current)) {
      if (pass || settling.length || ball?.visible) stopPassing();
      return false;
    }
    if (!pass) {
      const pool = xi();
      if (!pool.length || !startPass(pool[Math.floor(Math.random() * pool.length)], null)) return false;
    }
    const cur = pass!;
    const b = ensureBall();
    b.visible = true;
    const dir = Math.atan2(cur.to.homeX - cur.from.homeX, cur.to.homeZ - cur.from.homeZ);
    const startX = cur.from.homeX + Math.sin(dir) * 0.8;
    const startZ = cur.from.homeZ + Math.cos(dir) * 0.8;
    const endX = cur.to.homeX - Math.sin(dir) * 0.8;
    const endZ = cur.to.homeZ - Math.cos(dir) * 0.8;
    cur.t += dt;
    if (cur.phase === "hold") {
      cur.legT = cur.t; // the wind-up runs with the hold, so the foot meets the ball as it is released
      b.position.set(startX, BALL_REST_Y, startZ);
      if (cur.t >= KICK_AT) {
        cur.phase = "fly";
        cur.t = 0;
        cur.legT = KICK_AT;
      }
    } else {
      cur.legT += dt;
      const p = cur.t / cur.dur;
      const at = ballAt({ x: startX, z: startZ }, { x: endX, z: endZ }, p);
      b.position.set(at.x, at.y, at.z);
      b.rotation.x += dt * 9;
      if (p >= 1) {
        const next = cur.to;
        passes += 1;
        opts.onPass?.(passes);
        settling.push({ f: cur.from, t: cur.legT });
        pass = null;
        startPass(next, cur.from.def.id, HOLD_SECONDS - KICK_AT);
      }
    }
    const leg = kickLeg(cur.legT);
    cur.from.joints.hipR.rotation.x = leg.hip;
    cur.from.joints.kneeR.rotation.x = leg.knee;
    // legs of men who have just kicked finish their swing
    for (const s of settling) {
      s.t += dt;
      const l = kickLeg(s.t);
      s.f.joints.hipR.rotation.x = l.hip;
      s.f.joints.kneeR.rotation.x = l.knee;
    }
    settling = settling.filter((s) => {
      if (s.t > KICK_AT + 0.5) {
        legReset(s.f);
        return false;
      }
      return true;
    });
    // he who has the ball looks at the man he is passing to; the receiver watches it come
    const now = pass ?? cur;
    for (const f of figures) {
      if (f.def.bench || f.anim.current || f.anim.slide) continue;
      let want = 0;
      if (f === now.from) want = facing(spotOf(f), spotOf(now.to));
      else if (f === now.to && now.phase === "fly") want = facing(spotOf(f), { x: b.position.x, z: b.position.z });
      f.anim.yaw += (want - f.anim.yaw) * Math.min(1, 9 * dt);
      f.g.rotation.y = f.anim.yaw;
    }
    return true;
  }

  /* confetti: one Points object, reused */
  const CONFETTI = 90;
  let confetti: { pts: THREE.Points; vel: Float32Array; life: Float32Array; pos: Float32Array; col: Float32Array } | null = null;
  function burst(x: number, y: number, z: number) {
    if (reduceMotion) return;
    if (!confetti) {
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(CONFETTI * 3);
      const col = new Float32Array(CONFETTI * 3);
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
      const pts = new THREE.Points(own(geo), own(new THREE.PointsMaterial({ size: 0.4, vertexColors: true, transparent: true, depthWrite: false })));
      pts.frustumCulled = false;
      scene.add(pts);
      confetti = { pts, vel: new Float32Array(CONFETTI * 3), life: new Float32Array(CONFETTI), pos, col };
    }
    const palette = [[0.21, 0.88, 0.64], [0.95, 0.73, 0.3], [1, 1, 1], [0.5, 0.77, 0.94]];
    for (let i = 0; i < CONFETTI; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * 5;
      confetti.pos.set([x, y, z], i * 3);
      confetti.vel.set([Math.cos(a) * sp, 5 + Math.random() * 4, Math.sin(a) * sp], i * 3);
      confetti.life[i] = 1.6 + Math.random() * 0.8;
      confetti.col.set(palette[i % palette.length], i * 3);
    }
  }
  function stepConfetti(dt: number): boolean {
    if (!confetti) return false;
    let alive = false;
    for (let i = 0; i < CONFETTI; i++) {
      if (confetti.life[i] <= 0) {
        confetti.pos[i * 3 + 1] = -100;
        continue;
      }
      alive = true;
      confetti.life[i] -= dt;
      confetti.vel[i * 3 + 1] -= 14 * dt;
      for (let k = 0; k < 3; k++) confetti.pos[i * 3 + k] += confetti.vel[i * 3 + k] * dt;
    }
    confetti.pts.geometry.attributes.position.needsUpdate = true;
    confetti.pts.geometry.attributes.color.needsUpdate = true;
    return alive;
  }

  const brickMatrix = new THREE.Matrix4();
  const brickPos = new THREE.Vector3();
  const brickQuat = new THREE.Quaternion();
  const brickEuler = new THREE.Euler();
  const brickOne = new THREE.Vector3(1, 1, 1);

  /** Put a figure's joints in a pose, on top of its resting pose (standing or seated). */
  function applyPose(f: Figure, pose: Pose) {
    const j = f.joints;
    const seated = f.def.bench;
    j.body.position.y = (seated ? -0.43 : 0) + pose.bodyY;
    j.body.rotation.x = pose.bodyRx;
    const standArm = (side: number) => ({ x: seated ? -0.7 : 0, z: side * (seated ? 0.12 : 0.08) });
    const L = standArm(-1);
    const R = standArm(1);
    j.armL.rotation.set(L.x + pose.armL.x, 0, L.z + pose.armL.z);
    j.armR.rotation.set(R.x + pose.armR.x, 0, R.z + pose.armR.z);
    j.hipL.rotation.set((seated ? -1.5 : 0) + pose.hipL.x, 0, pose.hipL.z);
    j.hipR.rotation.set((seated ? -1.5 : 0) + pose.hipR.x, 0, pose.hipR.z);
    j.kneeL.rotation.x = (seated ? 1.5 : 0) + pose.kneeLx;
    j.kneeR.rotation.x = (seated ? 1.5 : 0) + pose.kneeRx;
    f.g.position.set(f.homeX, 0.05, f.homeZ + pose.dz);
    f.g.rotation.y = pose.yaw;
    if (f.wall) {
      const w = f.wall;
      const on = pose.bricks > 0.01 && pose.wallFade > 0.01;
      w.visible = on;
      if (on) {
        const whole = Math.floor(pose.bricks);
        w.count = Math.min(WALL_BRICKS, Math.ceil(pose.bricks));
        for (let i = 0; i < w.count; i++) {
          const drop = i === whole ? 1 - (pose.bricks - whole) : 0; // the newest brick is still dropping in
          const course = Math.floor(i / WALL_PER_COURSE);
          const a = (((i % WALL_PER_COURSE) + (course % 2) * 0.5) / WALL_PER_COURSE) * Math.PI * 2;
          brickMatrix.compose(
            brickPos.set(Math.cos(a) * 1.55, 0.18 + course * 0.37 + drop * 1.4 - (1 - pose.wallFade) * 0.6, Math.sin(a) * 1.55),
            brickQuat.setFromEuler(brickEuler.set(0, -a - Math.PI / 2, 0)),
            brickOne,
          );
          w.setMatrixAt(i, brickMatrix);
        }
        w.instanceMatrix.needsUpdate = true;
        (w.material as THREE.MeshLambertMaterial).opacity = pose.wallFade;
      }
    }
  }
  const restPose = (f: Figure) => {
    f.anim.yaw = 0;
    applyPose(f, restingPose());
  };

  function startNext(f: Figure, delay = 0) {
    const kind = f.anim.queue.shift();
    f.anim.current = kind ? { kind, t: -delay, burst: false } : null;
    const now = f.anim.current?.kind ?? null;
    if (now !== celebrating) {
      celebrating = now;
      report();
    }
  }

  /** Advance every animation by dt. Returns 0 when nothing moves, 1 while only the ambient
   * passing runs (the loop may take it easy), 2 while something else is moving. */
  function update(dt: number): 0 | 1 | 2 {
    let active = false;
    if (glide) {
      glide.t += dt;
      const k = ease(glide.t / GLIDE_SECONDS);
      for (let i = 0; i < 3; i++) {
        cam.pos[i] = glide.from.pos[i] + (glide.to.pos[i] - glide.from.pos[i]) * k;
        cam.look[i] = glide.from.look[i] + (glide.to.look[i] - glide.from.look[i]) * k;
      }
      cam.fov = glide.from.fov + (glide.to.fov - glide.from.fov) * k;
      applyCamera();
      if (glide.t >= GLIDE_SECONDS) glide = null;
      else active = true;
    }
    for (const f of figures) {
      const a = f.anim;
      // arriving or gliding to a new spot (another gameweek's lineup)
      if (a.pop != null) {
        a.pop += dt;
        const k = ease(a.pop / 0.45);
        f.g.scale.setScalar(Math.max(0.001, f.scale * k));
        if (a.pop >= 0.45) {
          a.pop = null;
          f.g.scale.setScalar(f.scale);
        } else active = true;
      }
      if (a.slide) {
        a.slide.t += dt;
        const k = ease(a.slide.t / 0.8);
        const x = a.slide.fromX + (f.homeX - a.slide.fromX) * k;
        const z = a.slide.fromZ + (f.homeZ - a.slide.fromZ) * k;
        f.g.position.set(x, 0.05, z);
        const phase = a.slide.t * 11;
        const moving = k < 1;
        const j = f.joints;
        if (moving && !f.def.bench) {
          j.hipL.rotation.x = Math.sin(phase) * 0.6;
          j.hipR.rotation.x = -Math.sin(phase) * 0.6;
          j.kneeL.rotation.x = Math.max(0, Math.cos(phase)) * 0.7;
          j.kneeR.rotation.x = Math.max(0, -Math.cos(phase)) * 0.7;
        }
        if (!moving) {
          a.slide = null;
          if (!a.current) restPose(f); // back to standing or seated, as he was built
          f.g.position.set(f.homeX, 0.05, f.homeZ);
        } else active = true;
      }
      if (a.current) {
        const cur = a.current;
        cur.t += dt;
        const len = momentSeconds(cur.kind, f.def.bench);
        if (cur.t < 0) {
          active = true; // waiting for the camera to arrive
        } else if (cur.t >= len) {
          restPose(f);
          startNext(f, 0.2);
          if (!a.current) {
            // finished: nothing left to play for this player
            if (celebrating !== null) {
              celebrating = null;
              report();
            }
          }
        } else {
          const raw = cur.kind === "goal" ? (f.def.bench ? benchCheerPose(cur.t) : goalPose(cur.t, f.def.goals ?? 1)) : cleanSheetPose(cur.t);
          // ease out of the resting pose over the first moments
          applyPose(f, blend(restingPose(), raw, clamp01(cur.t / 0.15)));
          if (raw.burst && !cur.burst) {
            cur.burst = true;
            burst(f.g.position.x, 3 * f.scale, f.g.position.z);
          }
          active = true;
        }
      }
    }
    if (stepConfetti(dt)) active = true;
    const passing = stepPassing(dt);
    return active ? 2 : passing ? 1 : 0;
  }

  function frame(ts: number) {
    raf = 0;
    if (disposed || !size.w) return;
    // while only the ball is going round, 30 frames a second is plenty and saves the battery
    if (ambientOnly && lastTs && ts - lastTs < 30) {
      raf = requestAnimationFrame(frame);
      return;
    }
    const dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 1 / 60;
    lastTs = ts;
    const state = update(dt);
    ambientOnly = state === 1;
    renderer.render(scene, camera);
    placeTags();
    if (state > 0 && !document.hidden) raf = requestAnimationFrame(frame);
    else {
      lastTs = 0;
      ambientOnly = false;
    }
  }
  const draw = () => {
    if (!raf && !disposed) raf = requestAnimationFrame(frame);
  };
  const onVisible = () => {
    if (!document.hidden) draw();
  };
  document.addEventListener("visibilitychange", onVisible);

  const tmp = new THREE.Vector3();
  /** Screen position of a point, and whether it is inside (or just outside) the frame. */
  const px = (x: number, y: number, z: number): [number, number, boolean] => {
    tmp.set(x, y, z).project(camera);
    const inFrame = tmp.z < 1 && Math.abs(tmp.x) < 1.1 && Math.abs(tmp.y) < 1.1;
    return [(tmp.x * 0.5 + 0.5) * size.w, (-tmp.y * 0.5 + 0.5) * size.h, inFrame];
  };

  function placeTags() {
    const items: { el: HTMLElement; x: number; y: number; w: number; h: number }[] = [];
    for (const f of figures) {
      const el = tagLayer.querySelector<HTMLElement>(`[data-tag="${f.def.id}"]`);
      if (!el) continue;
      const [x, y, inFrame] = px(f.g.position.x, f.g.position.y + 3.05 * f.scale, f.g.position.z);
      // a player outside the close-up is not drawn; his tag is made invisible (still reachable by keyboard)
      el.toggleAttribute("data-pitch-off", !inFrame);
      if (inFrame) items.push({ el, x, y, w: el.offsetWidth || 60, h: el.offsetHeight || 26 });
    }
    // tags side by side on one line spread apart first, so each stays close to its own player
    const lo = (it: { w: number }) => it.w / 2 + 3;
    const clampX = (it: { x: number; w: number }) => {
      it.x = Math.min(size.w - lo(it), Math.max(lo(it), it.x));
    };
    const byX = [...items].sort((a, b) => a.x - b.x);
    const gap = (l: (typeof byX)[number], r: (typeof byX)[number]) => (l.w + r.w) / 2 + 2 - (r.x - l.x);
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 1; i < byX.length; i++) {
        const l = byX[i - 1];
        const r = byX[i];
        if (Math.abs(l.y - r.y) > 20) continue;
        const overlap = gap(l, r);
        if (overlap > 0) {
          l.x -= overlap / 2;
          r.x += overlap / 2;
        }
      }
      byX.forEach(clampX);
    }
    // whatever is still touching (squeezed against an edge): push along, then back from the other edge
    for (let i = 1; i < byX.length; i++) {
      if (Math.abs(byX[i - 1].y - byX[i].y) <= 20 && gap(byX[i - 1], byX[i]) > 0) byX[i].x += gap(byX[i - 1], byX[i]);
    }
    for (let i = byX.length - 2; i >= 0; i--) {
      if (Math.abs(byX[i + 1].y - byX[i].y) <= 20 && gap(byX[i], byX[i + 1]) > 0) byX[i].x -= gap(byX[i], byX[i + 1]);
    }
    byX.forEach(clampX);
    // lowest on screen first; anything still sitting on top of a tag below it is lifted clear
    items.sort((a, b) => b.y - a.y);
    for (let i = 1; i < items.length; i++) {
      for (let pass = 0; pass < 4; pass++) {
        let moved = false;
        for (let j = 0; j < i; j++) {
          if (Math.abs(items[i].x - items[j].x) < (items[i].w + items[j].w) / 2 - 2 && Math.abs(items[i].y - items[j].y) < Math.max(26, items[j].h + 1)) {
            items[i].y = items[j].y - Math.max(26, items[j].h + 1);
            moved = true;
          }
        }
        if (!moved) break;
      }
    }
    for (const it of items) {
      clampX(it); // the vertical lift above can only have moved y, but keep a wide name at the edge in frame
      it.y = Math.max(it.h + 1, it.y); // and a lifted tag never rises out of the top (the keeper's)
    }
    clearOverlaps(items, size.w, size.h);
    for (const it of items) {
      it.el.style.transform = `translate(${Math.round(it.x)}px,${Math.round(it.y)}px) translate(-50%,-100%)`;
    }
  }

  function resize() {
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (!w || !h || (w === size.w && h === size.h)) return;
    size = { w, h };
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    applyCamera();
    draw();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();

  const onClick = (e: MouseEvent) => {
    const r = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObjects(figures.map((f) => f.hit), false)[0];
    if (hit) onPick(hit.object.userData.id as number);
  };
  canvas.addEventListener("click", onClick);
  // a phone can drop the GL context in the background; draw again when it returns
  canvas.addEventListener("webglcontextrestored", draw);

  function clearFigures() {
    for (const f of figures) {
      scene.remove(f.g);
      f.owned.forEach((g) => g.dispose());
      f.disposables.forEach((d) => d.dispose());
      f.mat.dispose();
      f.g.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && (m === f.ring || m === f.hit || m.geometry.type === "CircleGeometry")) {
          m.geometry.dispose();
          (m.material as THREE.Material).dispose();
        }
      });
    }
    figures = [];
  }

  return {
    setPlayers(defs) {
      const before = new Map(figures.map((f) => [f.def.id, { x: f.g.position.x, z: f.g.position.z, homeX: f.homeX, homeZ: f.homeZ, anim: f.anim }]));
      // a live update rebuilds the figures; keep the ball going round across it
      const saved = pass && { fromId: pass.from.def.id, toId: pass.to.def.id, phase: pass.phase, t: pass.t, legT: pass.legT, dur: pass.dur, last: pass.last };
      const settlingIds = settling.map((s) => ({ id: s.f.def.id, t: s.t }));
      clearFigures();
      figures = defs.map(buildFigure);
      for (const f of figures) {
        f.ring.visible = f.def.id === selected;
        const prev = before.get(f.def.id);
        if (prev) {
          f.anim.queue = prev.anim.queue;
          f.anim.current = prev.anim.current;
          f.anim.yaw = prev.anim.yaw;
          f.g.rotation.y = prev.anim.yaw;
          // a different lineup (another gameweek): glide from where he stood
          const moved = Math.abs(prev.homeX - f.homeX) > 0.05 || Math.abs(prev.homeZ - f.homeZ) > 0.05;
          if (moved && !reduceMotion) {
            f.anim.slide = { fromX: prev.x, fromZ: prev.z, t: 0 };
            f.g.position.set(prev.x, 0.05, prev.z);
          }
        } else if (before.size > 0 && !reduceMotion) {
          f.anim.pop = 0;
          f.g.scale.setScalar(0.001);
        }
        scene.add(f.g);
      }
      const same = (id: number) => {
        const a = before.get(id);
        const f = figures.find((x) => x.def.id === id);
        return !!a && !!f && !f.anim.slide && f.anim.pop == null && Math.abs(a.homeX - f.homeX) < 0.05 && Math.abs(a.homeZ - f.homeZ) < 0.05;
      };
      const from = saved && figures.find((x) => x.def.id === saved.fromId);
      const to = saved && figures.find((x) => x.def.id === saved.toId);
      if (saved && from && to && same(saved.fromId) && same(saved.toId) && !from.def.bench && !to.def.bench) {
        pass = { from, to, phase: saved.phase, t: saved.t, legT: saved.legT, dur: saved.dur, last: saved.last };
        settling = settlingIds.flatMap((x) => {
          const f = figures.find((y) => y.def.id === x.id);
          return f && f !== from ? [{ f, t: x.t }] : [];
        });
      } else {
        pass = null;
        settling = [];
        stopPassing();
      }
      if (selected != null) {
        // the focused player may have moved, or may no longer be in the lineup
        const f = figures.find((x) => x.def.id === selected);
        const was = before.get(selected);
        if (!f) {
          selected = null;
          celebrating = null;
          goTo(BROADCAST);
          report();
        } else if (was && (Math.abs(was.homeX - f.homeX) > 0.05 || Math.abs(was.homeZ - f.homeZ) > 0.05)) {
          goTo(focusShot(f.homeX, f.homeZ, f.scale));
        }
      }
      // a rebuild may have dropped the player who was celebrating: never stay "celebrating" with nobody doing it
      const now = figures.find((x) => x.anim.current)?.anim.current?.kind ?? null;
      if (now !== celebrating) {
        celebrating = now;
        report();
      }
      draw();
    },
    setAmbient(on) {
      ambient = on && !reduceMotion;
      if (!ambient) stopPassing();
      draw();
    },
    celebrate(id, kind) {
      if (reduceMotion || selected != null || disposed) return "refused";
      if (celebrating !== null) return "busy";
      const f = figures.find((x) => x.def.id === id);
      if (!f || f.def.bench || f.anim.current || f.anim.slide || f.anim.pop != null) return "refused";
      stopPassing(); // the ball is put down; he takes the moment where he stands
      f.anim.queue = [kind];
      startNext(f, 0);
      draw();
      return "played";
    },
    setSelected(id) {
      if (id === selected) return;
      // a live celebration in progress ends at once: the tap takes over the stage
      for (const f of figures) {
        if (f.anim.current || f.anim.queue.length) {
          f.anim.queue = [];
          f.anim.current = null;
          restPose(f);
        }
      }
      const prev = figures.find((f) => f.def.id === selected);
      if (prev) {
        prev.anim.queue = [];
        prev.anim.current = null;
        restPose(prev);
      }
      selected = id;
      stopPassing(); // everyone squares up now, before his celebration is queued
      for (const f of figures) f.ring.visible = f.def.id === id;
      celebrating = null;
      const f = figures.find((x) => x.def.id === id);
      if (!f) {
        goTo(BROADCAST);
      } else {
        goTo(focusShot(f.homeX, f.homeZ, f.scale));
        if (!reduceMotion) {
          f.anim.queue = momentsFor(f.def.goals, f.def.cleanSheet);
          startNext(f, GLIDE_SECONDS * 0.7);
        }
      }
      report();
      draw();
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("click", onClick);
      canvas.removeEventListener("webglcontextrestored", draw);
      document.removeEventListener("visibilitychange", onVisible);
      selected = null;
      celebrating = null;
      report();
      pass = null;
      clearFigures();
      staticOwned.forEach((o) => o.dispose());
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
