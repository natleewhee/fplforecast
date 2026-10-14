import { kitFor } from "@/lib/teamColors";
import { rankMove, tier, verdict, type Recap } from "@/lib/recap";

/* Draws the shareable recap as a collectible card: a metallic rarity frame,
 * a big rating (the gameweek score), the best player's photo, a name plate,
 * a banter ribbon and a stat grid. Plain canvas, no dependencies. */

const W = 800;
const H = 1200;

function displayFamily(): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--font-display-face").trim();
  return `${raw ? `${raw}, ` : ""}"Arial Narrow", system-ui, sans-serif`;
}

function loadPhoto(code: number | null | undefined): Promise<HTMLImageElement | null> {
  if (!code) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = `/api/photo?code=${code}`;
  });
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function spaced(ctx: CanvasRenderingContext2D, px: number) {
  (ctx as unknown as { letterSpacing: string }).letterSpacing = `${px}px`;
}

function fit(ctx: CanvasRenderingContext2D, text: string, maxW: number, size: number, weight: string, fam: string) {
  let s = size;
  ctx.font = `${weight} ${s}px ${fam}`;
  while (ctx.measureText(text).width > maxW && s > 24) {
    s -= 2;
    ctx.font = `${weight} ${s}px ${fam}`;
  }
  return s;
}

export async function renderRecapCard(r: Recap): Promise<Blob | null> {
  const fam = displayFamily();
  try {
    await Promise.all([
      document.fonts.load(`italic 800 100px ${fam}`),
      document.fonts.load(`700 40px ${fam}`),
    ]);
  } catch {
    // fall back to the system face
  }
  const photo = await loadPhoto(r.best?.code);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const t = tier(r);

  // ---- metallic frame ----
  const frame = ctx.createLinearGradient(0, 0, W, H);
  frame.addColorStop(0, "#ffffff");
  frame.addColorStop(0.22, t.color);
  frame.addColorStop(0.5, "#ffffffcc");
  frame.addColorStop(0.75, t.color);
  frame.addColorStop(1, "#00000088");
  ctx.fillStyle = "#050b08";
  ctx.fillRect(0, 0, W, H);
  rr(ctx, 14, 14, W - 28, H - 28, 54);
  ctx.fillStyle = frame;
  ctx.fill();

  // ---- inner panel ----
  ctx.save();
  rr(ctx, 30, 30, W - 60, H - 60, 42);
  ctx.clip();
  const panel = ctx.createLinearGradient(0, 0, 0, H);
  panel.addColorStop(0, "#0c1a13");
  panel.addColorStop(0.55, "#07110c");
  panel.addColorStop(1, "#050b08");
  ctx.fillStyle = panel;
  ctx.fillRect(0, 0, W, H);

  // diagonal weave
  ctx.strokeStyle = "rgba(255,255,255,0.035)";
  ctx.lineWidth = 2;
  for (let x = -H; x < W; x += 26) {
    ctx.beginPath();
    ctx.moveTo(x, H);
    ctx.lineTo(x + H, 0);
    ctx.stroke();
  }
  // tier glow behind the hero
  const glow = ctx.createRadialGradient(560, 330, 20, 560, 330, 460);
  glow.addColorStop(0, `${t.color}66`);
  glow.addColorStop(0.5, `${t.color}18`);
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  // floodlight beams
  for (const [x, w, a] of [[420, 110, 0.07], [620, 80, 0.05]] as const) {
    const beam = ctx.createLinearGradient(x, 0, x - 120, 760);
    beam.addColorStop(0, `rgba(255,255,255,${a})`);
    beam.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(x, 30);
    ctx.lineTo(x + w, 30);
    ctx.lineTo(x + w - 230, 760);
    ctx.lineTo(x - 230, 760);
    ctx.closePath();
    ctx.fill();
  }
  // giant watermark
  ctx.fillStyle = "rgba(255,255,255,0.04)";
  ctx.font = `italic 800 330px ${fam}`;
  ctx.textAlign = "right";
  ctx.fillText(`GW${r.gameweek}`, W - 40, 470);
  ctx.textAlign = "left";

  // ---- hero: photo, or a kit-coloured shirt when there is none ----
  const heroBottom = 600;
  if (photo) {
    const ph = 490;
    const pw = (photo.width / photo.height) * ph;
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = 30;
    ctx.drawImage(photo, 590 - pw / 2, heroBottom - ph, pw, ph);
    ctx.shadowBlur = 0;
  } else {
    const kit = kitFor(r.best?.team);
    ctx.save();
    ctx.translate(430, 150);
    ctx.fillStyle = kit.primary;
    ctx.beginPath();
    ctx.moveTo(60, 0);
    ctx.lineTo(120, 36);
    ctx.lineTo(200, 0);
    ctx.lineTo(280, 36);
    ctx.lineTo(340, 0);
    ctx.lineTo(420, 80);
    ctx.lineTo(366, 150);
    ctx.lineTo(320, 112);
    ctx.lineTo(320, 400);
    ctx.lineTo(100, 400);
    ctx.lineTo(100, 112);
    ctx.lineTo(54, 150);
    ctx.lineTo(0, 80);
    ctx.closePath();
    ctx.globalAlpha = 0.9;
    ctx.fill();
    ctx.restore();
  }
  // fade the hero into the name plate
  const fade = ctx.createLinearGradient(0, heroBottom - 150, 0, heroBottom + 20);
  fade.addColorStop(0, "rgba(7,17,12,0)");
  fade.addColorStop(1, "#07110c");
  ctx.fillStyle = fade;
  ctx.fillRect(0, heroBottom - 150, W, 170);

  // ---- rating block (top left) ----
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = t.color;
  ctx.shadowBlur = 36;
  ctx.font = `italic 800 190px ${fam}`;
  ctx.fillText(String(r.points), 66, 232);
  ctx.shadowBlur = 0;
  ctx.fillStyle = t.color;
  ctx.font = `700 40px ${fam}`;
  spaced(ctx, 6);
  ctx.fillText("PTS", 72, 282);
  ctx.font = `700 34px ${fam}`;
  ctx.fillText(`GW${r.gameweek}`, 72, 332);
  spaced(ctx, 0);
  ctx.fillRect(72, 352, 110, 4);
  const move = rankMove(r);
  if (move) {
    ctx.fillStyle = "#dbe7df";
    ctx.font = `600 30px ${fam}`;
    ctx.fillText(move.replace(" places", ""), 72, 402);
    ctx.fillStyle = "#8aa396";
    ctx.font = `600 22px ${fam}`;
    spaced(ctx, 3);
    ctx.fillText("OVERALL RANK", 72, 432);
    spaced(ctx, 0);
  }
  // rarity chip
  ctx.font = `800 26px ${fam}`;
  spaced(ctx, 4);
  const chipW = ctx.measureText(t.label).width + 36;
  ctx.fillStyle = t.color;
  rr(ctx, 72, 460, chipW, 44, 22);
  ctx.fill();
  ctx.fillStyle = "#06100a";
  ctx.fillText(t.label, 90, 492);
  spaced(ctx, 0);

  // ---- name plate ----
  const plate = ctx.createLinearGradient(0, 0, W, 0);
  plate.addColorStop(0, `${t.color}`);
  plate.addColorStop(1, `${t.color}00`);
  ctx.fillStyle = plate;
  ctx.fillRect(66, heroBottom + 4, 6, 108);
  if (r.best) {
    ctx.fillStyle = "#ffffff";
    const size = fit(ctx, r.best.name.toUpperCase(), 640, 92, "italic 800", fam);
    ctx.font = `italic 800 ${size}px ${fam}`;
    ctx.fillText(r.best.name.toUpperCase(), 92, heroBottom + 68);
    ctx.fillStyle = t.color;
    ctx.font = `700 28px ${fam}`;
    spaced(ctx, 5);
    ctx.fillText(`BEST PICK  ·  ${r.best.points} PTS`, 94, heroBottom + 108);
    spaced(ctx, 0);
  }

  // ---- banter ribbon ----
  const ribbonY = heroBottom + 140;
  ctx.fillStyle = "rgba(255,255,255,0.07)";
  ctx.beginPath();
  ctx.moveTo(66, ribbonY);
  ctx.lineTo(W - 46, ribbonY);
  ctx.lineTo(W - 70, ribbonY + 74);
  ctx.lineTo(42, ribbonY + 74);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  const vs = fit(ctx, verdict(r), W - 220, 48, "italic 700", fam);
  ctx.font = `italic 700 ${vs}px ${fam}`;
  ctx.fillText(verdict(r), 92, ribbonY + 53);

  // ---- stat grid ----
  const cells: [string, string][] = [
    ["CAPTAIN", r.captain ? `${r.captain.name} ${r.captain.raw}` : "–"],
    ["WORST", r.worst ? `${r.worst.name} ${r.worst.points}` : "–"],
    ["BENCH", `${r.benchPoints} pts`],
    ["AVERAGE", r.averageScore != null ? String(r.averageScore) : "–"],
    ["HIT", r.hit ? `−${r.hit}` : "none"],
    ["CHIP", r.chip ? r.chip.toUpperCase() : "none"],
  ];
  const gx = [92, 430];
  const gy = ribbonY + 128;
  cells.forEach(([label, value], i) => {
    const x = gx[i % 2];
    const y = gy + Math.floor(i / 2) * 64;
    ctx.fillStyle = "#8aa396";
    ctx.font = `600 22px ${fam}`;
    spaced(ctx, 3);
    ctx.fillText(label, x, y);
    spaced(ctx, 0);
    ctx.fillStyle = "#ffffff";
    ctx.font = `700 40px ${fam}`;
    ctx.fillText(value, x + 160, y + 2, 170);
  });

  // ---- stickers ----
  let sx = 66;
  let sy = gy + 2 * 64 + 70;
  ctx.font = `700 26px ${fam}`;
  for (const a of r.achievements.slice(0, 4)) {
    const label = `${a.emoji} ${a.title}`;
    const w = ctx.measureText(label).width + 34;
    if (sx + w > W - 60) {
      sx = 66;
      sy += 54;
    }
    ctx.fillStyle = a.good ? "rgba(61,220,132,0.2)" : "rgba(255,107,107,0.2)";
    rr(ctx, sx, sy - 32, w, 44, 22);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.fillText(label, sx + 17, sy);
    sx += w + 10;
  }

  // ---- brand lockup ----
  ctx.save();
  ctx.translate(66, H - 118);
  ctx.scale(0.72, 0.72);
  ctx.strokeStyle = "#3ddc84";
  ctx.lineWidth = 6;
  ctx.lineCap = "round";
  ctx.stroke(new Path2D("M10 50V30c0-4 3-7 7-7h30c4 0 7 3 7 7v20M8 50h48"));
  ctx.fillStyle = "#f2f5ef";
  ctx.beginPath();
  ctx.arc(32, 13, 6.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.font = `800 44px ${fam}`;
  ctx.fillStyle = "#f2f5ef";
  ctx.fillText("Gaffer", 124, H - 80);
  const gw = ctx.measureText("Gaffer").width;
  ctx.fillStyle = "#3ddc84";
  ctx.fillText("FPL", 124 + gw, H - 80);
  ctx.restore();

  // holographic sheen across the whole card
  ctx.save();
  rr(ctx, 14, 14, W - 28, H - 28, 54);
  ctx.clip();
  const sheen = ctx.createLinearGradient(0, 120, W, H - 220);
  sheen.addColorStop(0, "rgba(255,255,255,0)");
  sheen.addColorStop(0.42, "rgba(255,255,255,0)");
  sheen.addColorStop(0.5, "rgba(255,255,255,0.09)");
  sheen.addColorStop(0.58, "rgba(255,255,255,0)");
  sheen.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}
