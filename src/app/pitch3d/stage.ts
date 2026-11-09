import * as THREE from "three";
import { SKIN_STEPS, type HairStyle } from "@/lib/appearance";
import { BENCH_X, BENCH_Z0, SEAT_Y } from "./spots";

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
  bench: boolean;
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

type Figure = { g: THREE.Group; ring: THREE.Mesh; hit: THREE.Mesh; scale: number; def: FigureDef; owned: THREE.BufferGeometry[]; mat: THREE.Material };

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

  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const g = new THREE.Group();
  const b = new THREE.Group();
  g.add(b);
  b.add(new THREE.Mesh(body, mat));

  for (const side of [-1, 1]) {
    const piv = new THREE.Group();
    piv.position.set(side * 0.58, 1.95, 0);
    piv.add(new THREE.Mesh(armGeo(def.captain && side === -1), mat));
    // standing: arms hang a little away from the body; seated: hands on knees
    piv.rotation.set(def.bench ? -0.7 : 0, 0, side * (def.bench ? 0.12 : 0.08));
    b.add(piv);

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

  const scale = scaleFor(def.cm);
  g.scale.setScalar(scale);
  g.position.set(def.x, def.bench ? 0.05 : 0.05, def.z);
  g.rotation.y = def.bench ? -Math.PI / 2 : 0;
  return { g, ring, hit, scale, def, owned, mat };
}

export type StageHandle = {
  setPlayers(defs: FigureDef[]): void;
  setSelected(id: number | null): void;
  dispose(): void;
};

export type StageOptions = {
  host: HTMLElement; // sized by CSS; the stage fills it
  tagLayer: HTMLElement; // holds one element per player, marked data-tag="<id>"
  onPick(id: number): void;
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

function setup(renderer: THREE.WebGLRenderer, canvas: HTMLCanvasElement, { host, tagLayer, onPick }: StageOptions): StageHandle {
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

  // the dugout: seat, back, posts, and a see-through roof so nobody is hidden
  {
    const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
    const len = 8.2;
    const parts: Part[] = [
      P(box(1.25, 0.16, len), "#243b52", { x: BENCH_X + 0.15, y: SEAT_Y - 0.08, z: BENCH_Z0 }),
      P(box(0.12, 1.6, len), "#18283a", { x: BENCH_X + 0.85, y: 0.95, z: BENCH_Z0 }),
    ];
    for (const zs of [-1, 1])
      for (const xs of [-0.9, 1.1])
        parts.push(P(new THREE.CylinderGeometry(0.07, 0.07, 3.8, 10), "#9fb2c4", { x: BENCH_X + 0.2 + xs, y: 1.9, z: BENCH_Z0 + zs * (len / 2 + 0.2) }));
    scene.add(new THREE.Mesh(own(bake(parts)), own(new THREE.MeshLambertMaterial({ vertexColors: true }))));
    const roof = bake([
      P(box(3.0, 0.16, len + 0.8), "#2d4863", { x: BENCH_X + 0.2, y: 3.9, z: BENCH_Z0 }),
      P(box(3.0, 0.06, len + 0.8), "#36e0a2", { x: BENCH_X + 0.2, y: 3.78, z: BENCH_Z0 }),
    ]);
    scene.add(new THREE.Mesh(own(roof), own(new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.32, depthWrite: false }))));
  }

  // the broadcast view: fov is for a stage 0.8 wide per 1 high, widened/narrowed to the real shape
  const CAM = { pos: [2.2, 19, 33], look: [2.2, 0, -3.5], fov: 50 };
  let figures: Figure[] = [];
  let selected: number | null = null;
  let size = { w: 0, h: 0 };
  let raf = 0;
  let disposed = false;

  function frame() {
    raf = 0;
    if (disposed || !size.w) return;
    renderer.render(scene, camera);
    placeTags();
  }
  const draw = () => {
    if (!raf && !disposed) raf = requestAnimationFrame(frame);
  };

  const tmp = new THREE.Vector3();
  const px = (x: number, y: number, z: number): [number, number] => {
    tmp.set(x, y, z).project(camera);
    return [(tmp.x * 0.5 + 0.5) * size.w, (-tmp.y * 0.5 + 0.5) * size.h];
  };

  function placeTags() {
    const items: { el: HTMLElement; x: number; y: number; w: number }[] = [];
    for (const f of figures) {
      const el = tagLayer.querySelector<HTMLElement>(`[data-tag="${f.def.id}"]`);
      if (!el) continue;
      const [x, y] = px(f.g.position.x, f.g.position.y + 3.05 * f.scale, f.g.position.z);
      items.push({ el, x, y, w: el.offsetWidth || 60 });
    }
    // lowest on screen first; anything that would sit on top of a tag below it is lifted clear
    items.sort((a, b) => b.y - a.y);
    for (let i = 1; i < items.length; i++) {
      for (let pass = 0; pass < 4; pass++) {
        let moved = false;
        for (let j = 0; j < i; j++) {
          if (Math.abs(items[i].x - items[j].x) < (items[i].w + items[j].w) / 2 - 2 && Math.abs(items[i].y - items[j].y) < 26) {
            items[i].y = items[j].y - 26;
            moved = true;
          }
        }
        if (!moved) break;
      }
    }
    for (const it of items) it.el.style.transform = `translate(${Math.round(it.x)}px,${Math.round(it.y)}px) translate(-50%,-100%)`;
  }

  function resize() {
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (!w || !h || (w === size.w && h === size.h)) return;
    size = { w, h };
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = ((2 * Math.atan((Math.tan((CAM.fov * Math.PI) / 360) * 0.8) / Math.min(camera.aspect, 1))) * 180) / Math.PI;
    camera.position.fromArray(CAM.pos);
    camera.lookAt(new THREE.Vector3().fromArray(CAM.look));
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
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
      clearFigures();
      figures = defs.map(buildFigure);
      for (const f of figures) {
        f.ring.visible = f.def.id === selected;
        scene.add(f.g);
      }
      draw();
    },
    setSelected(id) {
      selected = id;
      for (const f of figures) f.ring.visible = f.def.id === id;
      draw();
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("click", onClick);
      canvas.removeEventListener("webglcontextrestored", draw);
      clearFigures();
      staticOwned.forEach((o) => o.dispose());
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
