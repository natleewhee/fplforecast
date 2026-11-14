/* How the 3D pitch looks: the grass, the soft shadows and the floodlit night around it.
 * The drawing runs once per stage (canvas textures), so none of it costs anything per frame.
 * The maths that is not drawing is kept pure so it is unit-tested without a browser. */

import { BALL_REST_Y } from "./passes";

/** The ball's shadow as it rises: smaller, fainter and softer the higher it goes. */
export function ballShadow(y: number): { scale: number; opacity: number } {
  const lift = Math.max(0, y - BALL_REST_Y);
  const k = Math.min(1, lift / 1.6); // 1.6 is the highest a long pass lofts
  return { scale: 1 - 0.45 * k, opacity: 0.5 - 0.32 * k };
}

/** A small deterministic random (mulberry32), so the grass looks the same on every visit. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Where the floodlights throw their pools, in 0..1 of the pitch (four towers at the corners). */
export const FLOODLIGHTS: readonly [number, number][] = [
  [0.08, 0.06],
  [0.92, 0.06],
  [0.08, 0.94],
  [0.92, 0.94],
];

/** A round soft-edged shadow, white on transparent (tinted black by its material). */
export function softShadowCanvas(size = 128): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const r = size / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.75)");
  grad.addColorStop(0.7, "rgba(255,255,255,0.2)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

/** The pitch: mown stripes both ways, a fine grain, worn goalmouths and centre spot, the full
 * markings, and the four floodlight pools with a darker fall-off towards the edges. */
export function pitchCanvas(w = 940, h = 1536): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  const rand = seeded(20261114);

  // mown stripes along the pitch, with a fainter cross-cut so it reads as a checker under the lights
  const bands = 12;
  for (let i = 0; i < bands; i++) {
    g.fillStyle = i % 2 ? "#1f6e3c" : "#1a6035";
    g.fillRect(0, (i * h) / bands, w, h / bands + 1);
  }
  const cross = 8;
  for (let i = 0; i < cross; i++) {
    if (i % 2) continue;
    g.fillStyle = "rgba(255,255,255,0.025)";
    g.fillRect((i * w) / cross, 0, w / cross + 1, h);
  }

  // grain: thousands of short blades, light and dark
  for (let i = 0; i < 9000; i++) {
    const x = rand() * w;
    const y = rand() * h;
    g.fillStyle = rand() < 0.5 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.07)";
    g.fillRect(x, y, 1.5, 3 + rand() * 3);
  }

  // wear: the goalmouths and the centre circle are a little bare and browner
  const worn = (x: number, y: number, rx: number, ry: number, a: number) => {
    g.save();
    g.translate(x, y);
    g.scale(1, ry / rx);
    const grad = g.createRadialGradient(0, 0, 0, 0, 0, rx);
    grad.addColorStop(0, `rgba(120,104,60,${a})`);
    grad.addColorStop(1, "rgba(120,104,60,0)");
    g.fillStyle = grad;
    g.beginPath();
    g.arc(0, 0, rx, 0, Math.PI * 2);
    g.fill();
    g.restore();
  };
  worn(w / 2, 46, 120, 70, 0.32);
  worn(w / 2, h - 46, 120, 70, 0.32);
  worn(w / 2, h / 2, 90, 90, 0.14);

  // markings (scaled from the original 470 x 768 layout)
  const s = w / 470;
  const m = 20 * s;
  g.strokeStyle = "rgba(255,255,255,0.78)";
  g.fillStyle = "rgba(255,255,255,0.78)";
  g.lineWidth = 3.5 * s;
  g.strokeRect(m, m, w - m * 2, h - m * 2);
  g.beginPath();
  g.moveTo(m, h / 2);
  g.lineTo(w - m, h / 2);
  g.stroke();
  g.beginPath();
  g.arc(w / 2, h / 2, 58 * s, 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  g.arc(w / 2, h / 2, 4 * s, 0, Math.PI * 2);
  g.fill();
  for (const [y, d] of [[m, 1], [h - m, -1]] as const) {
    const boxH = 130 * s;
    g.strokeRect(w / 2 - 115 * s, d > 0 ? y : y - boxH, 230 * s, boxH);
    g.strokeRect(w / 2 - 54 * s, d > 0 ? y : y - 48 * s, 108 * s, 48 * s);
    const spotY = y + d * 92 * s;
    g.beginPath();
    g.arc(w / 2, spotY, 3 * s, 0, Math.PI * 2);
    g.fill();
    // the D: the part of the penalty-spot circle outside the box
    const r = 58 * s;
    const edge = y + d * boxH;
    const half = Math.acos(Math.min(1, Math.abs(edge - spotY) / r));
    const mid = d > 0 ? Math.PI / 2 : -Math.PI / 2;
    g.beginPath();
    g.arc(w / 2, spotY, r, mid - half, mid + half);
    g.stroke();
  }
  // corner arcs
  for (const [x, y, a] of [[m, m, 0], [w - m, m, Math.PI / 2], [w - m, h - m, Math.PI], [m, h - m, -Math.PI / 2]] as const) {
    g.beginPath();
    g.arc(x, y, 9 * s, a, a + Math.PI / 2);
    g.stroke();
  }

  // floodlight pools, then a fall-off to darker edges
  g.globalCompositeOperation = "lighter";
  for (const [fx, fy] of FLOODLIGHTS) {
    const grad = g.createRadialGradient(fx * w, fy * h, 0, fx * w, fy * h, w * 0.85);
    grad.addColorStop(0, "rgba(255,248,220,0.07)");
    grad.addColorStop(1, "rgba(255,248,220,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  }
  g.globalCompositeOperation = "source-over";
  const edge = g.createRadialGradient(w / 2, h / 2, h * 0.28, w / 2, h / 2, h * 0.62);
  edge.addColorStop(0, "rgba(0,0,0,0)");
  edge.addColorStop(1, "rgba(0,0,0,0.36)");
  g.fillStyle = edge;
  g.fillRect(0, 0, w, h);
  return c;
}

/** The night beyond the pitch: a glow behind the far stand fading into dark. */
export function skyCanvas(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 256;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, "#050c0a");
  grad.addColorStop(0.55, "#0d2a1f");
  grad.addColorStop(1, "#0a1a14");
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  return c;
}

/* Drawn once per page and shared: each stage makes its own texture from the same canvas, so a
 * page with several pitches (Scenarios) does not redraw 9,000 grass blades each time. */
let pitchOnce: HTMLCanvasElement | null = null;
let shadowOnce: HTMLCanvasElement | null = null;
let skyOnce: HTMLCanvasElement | null = null;
export const sharedPitchCanvas = () => (pitchOnce ??= pitchCanvas());
export const sharedShadowCanvas = () => (shadowOnce ??= softShadowCanvas());
export const sharedSkyCanvas = () => (skyOnce ??= skyCanvas());
