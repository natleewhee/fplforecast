"use client";

import { useEffect, useRef, useState } from "react";
import type { RecapResponse } from "./api/recap/route";
import { rankMove, regretCopy, tier, verdict, type Recap } from "@/lib/recap";

function shareLines(r: Recap): string[] {
  const lines = [verdict(r), `GW${r.gameweek}: ${r.points} pts${r.hit ? ` (−${r.hit} hit)` : ""}`];
  if (r.averageScore != null) lines.push(`Average: ${r.averageScore}`);
  const move = rankMove(r);
  if (move) lines.push(move);
  if (r.captain) lines.push(`Captain: ${r.captain.name} ${r.captain.raw} (×${r.captain.multiplier})`);
  if (r.best) lines.push(`Best: ${r.best.name} ${r.best.points}`);
  if (r.worst) lines.push(`Worst: ${r.worst.name} ${r.worst.points}`);
  for (const a of r.achievements.slice(0, 3)) lines.push(`${a.emoji} ${a.title}`);
  return lines;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lh: number): number {
  let line = "";
  for (const word of text.split(" ")) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y);
      line = word;
      y += lh;
    } else line = test;
  }
  ctx.fillText(line, x, y);
  return y;
}

/** A shareable PNG of the recap, drawn on a canvas (no dependencies): a
 * floodlit-pitch poster with a banter headline and a trading-card rarity. */
function drawCard(r: Recap): Promise<Blob | null> {
  const W = 800;
  const H = 1000;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.resolve(null);
  const t = tier(r);

  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#06100b");
  bg.addColorStop(1, "#0f2a1a");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  // mown stripes + pitch lines
  for (let i = 0; i < 10; i++) {
    ctx.fillStyle = i % 2 ? "rgba(61,220,132,0.05)" : "rgba(61,220,132,0.0)";
    ctx.fillRect(0, 440 + i * 56, W, 56);
  }
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(W / 2, 760, 150, 0, Math.PI * 2);
  ctx.moveTo(0, 760);
  ctx.lineTo(W, 760);
  ctx.stroke();
  // floodlight glow in the tier colour
  const glow = ctx.createRadialGradient(W / 2, 0, 20, W / 2, 0, 700);
  glow.addColorStop(0, `${t.color}55`);
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  // card frame
  ctx.strokeStyle = t.color;
  ctx.lineWidth = 6;
  ctx.strokeRect(24, 24, W - 48, H - 48);

  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = t.color;
  ctx.font = "800 26px system-ui, sans-serif";
  ctx.fillText(`GAMEWEEK ${r.gameweek}`, 60, 92);
  ctx.textAlign = "right";
  ctx.fillText(t.label, W - 60, 92);
  ctx.textAlign = "left";

  ctx.fillStyle = "#ffffff";
  ctx.font = "800 58px system-ui, sans-serif";
  const endY = wrap(ctx, verdict(r), 60, 175, W - 120, 66);

  ctx.font = "800 190px system-ui, sans-serif";
  ctx.shadowColor = t.color;
  ctx.shadowBlur = 40;
  ctx.fillText(String(r.points), 60, endY + 200);
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#9fb3a8";
  ctx.font = "600 30px system-ui, sans-serif";
  const sub = [r.averageScore != null ? `avg ${r.averageScore}` : null, r.hit ? `−${r.hit} hit` : null, rankMove(r)]
    .filter(Boolean)
    .join("  ·  ");
  ctx.fillText(sub, 60, endY + 252);

  // stat panels
  let y = endY + 310;
  const panel = (label: string, value: string, color = "#ffffff") => {
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fillRect(60, y, W - 120, 64);
    ctx.fillStyle = "#9fb3a8";
    ctx.font = "600 24px system-ui, sans-serif";
    ctx.fillText(label, 80, y + 41);
    ctx.fillStyle = color;
    ctx.font = "700 30px system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(value, W - 80, y + 42);
    ctx.textAlign = "left";
    y += 76;
  };
  if (r.captain) panel("Captain", `${r.captain.name} ${r.captain.raw} (×${r.captain.multiplier})`);
  if (r.best) panel("Best pick", `${r.best.name} ${r.best.points}`, "#3ddc84");
  if (r.worst) panel("Worst pick", `${r.worst.name} ${r.worst.points}`, "#ff6b6b");

  // achievement stickers
  let x = 60;
  y += 54;
  ctx.font = "700 26px system-ui, sans-serif";
  for (const a of r.achievements.slice(0, 4)) {
    const label = `${a.emoji} ${a.title}`;
    const w = ctx.measureText(label).width + 36;
    if (x + w > W - 60) {
      x = 60;
      y += 58;
    }
    ctx.fillStyle = a.good ? "rgba(61,220,132,0.18)" : "rgba(255,107,107,0.18)";
    ctx.beginPath();
    ctx.roundRect(x, y - 34, w, 46, 23);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.fillText(label, x + 18, y);
    x += w + 12;
  }

  ctx.fillStyle = "#6d8478";
  ctx.font = "600 24px system-ui, sans-serif";
  ctx.fillText("fplforecast", 60, H - 56);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

export default function RecapCard({ teamId }: { teamId?: string | null }) {
  const [recap, setRecap] = useState<Recap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [showRegrets, setShowRegrets] = useState(false);
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    (async () => {
      try {
        const qs = teamId ? `?teamId=${teamId}` : "";
        const res = await fetch(`/api/recap${qs}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        setRecap((json as RecapResponse).recap);
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }, [teamId]);

  if (error) return null; // a recap is a nicety; never block the live view
  if (!recap) return null;

  const move = rankMove(recap);
  const share = async () => {
    const text = shareLines(recap).join("\n");
    try {
      const blob = await drawCard(recap);
      if (blob && navigator.canShare?.({ files: [new File([blob], "recap.png", { type: "image/png" })] })) {
        await navigator.share({ files: [new File([blob], `gw${recap.gameweek}-recap.png`, { type: "image/png" })], text });
        return;
      }
      if (navigator.share) {
        await navigator.share({ text });
        return;
      }
      await navigator.clipboard.writeText(text);
      setNote("Copied to clipboard");
    } catch (err) {
      if ((err as DOMException).name !== "AbortError") setNote("Couldn't share from this browser");
    }
  };

  return (
    <section className="panel rise space-y-3 p-3" data-testid="recap">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="eyebrow">
            GW{recap.gameweek} recap ·{" "}
            <span style={{ color: tier(recap).color }}>{tier(recap).label}</span>
          </p>
          <p className="mb-1 text-base font-bold text-ink">{verdict(recap)}</p>
          <div className="flex items-baseline gap-2">
            <span className="stat stat-glow text-4xl leading-none">{recap.points}</span>
            <span className="text-xs text-ink-soft">
              pts{recap.hit ? ` (−${recap.hit} hit)` : ""}
              {recap.averageScore != null ? ` · avg ${recap.averageScore}` : ""}
            </span>
          </div>
          {move && <p className="mt-1 text-xs text-ink-soft">{move}</p>}
        </div>
        <button
          type="button"
          onClick={share}
          className="inline-flex h-11 shrink-0 items-center rounded-full bg-[var(--accent)] px-4 text-xs font-bold text-[var(--bg-0)]"
        >
          Share
        </button>
      </div>
      {note && <p className="text-[11px] text-ink-faint">{note}</p>}

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11.5px]">
        {recap.captain && (
          <>
            <dt className="text-ink-faint">Captain</dt>
            <dd className="text-right">
              {recap.captain.name} {recap.captain.raw}
              <span className="text-ink-faint"> ×{recap.captain.multiplier}</span>
            </dd>
          </>
        )}
        {recap.best && (
          <>
            <dt className="text-ink-faint">Best pick</dt>
            <dd className="text-right text-[var(--accent)]">
              {recap.best.name} {recap.best.points}
            </dd>
          </>
        )}
        {recap.worst && (
          <>
            <dt className="text-ink-faint">Worst pick</dt>
            <dd className="text-right text-[var(--danger)]">
              {recap.worst.name} {recap.worst.points}
            </dd>
          </>
        )}
        <dt className="text-ink-faint">Bench</dt>
        <dd className="text-right">{recap.benchPoints} pts</dd>
      </dl>

      {recap.achievements.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" data-testid="achievements">
          {recap.achievements.map((a) => (
            <li
              key={a.id}
              title={a.detail}
              className={`chip ${a.good ? "chip-accent" : ""}`}
            >
              {a.emoji} {a.title}
            </li>
          ))}
        </ul>
      )}
      {recap.achievements.length > 0 && (
        <ul className="space-y-0.5 text-[10.5px] text-ink-faint">
          {recap.achievements.map((a) => (
            <li key={a.id}>
              {a.emoji} {a.detail}
            </li>
          ))}
        </ul>
      )}

      {recap.regrets.length > 0 && (
        <div className="border-t border-line pt-2">
          <button
            type="button"
            onClick={() => setShowRegrets((v) => !v)}
            className="inline-flex h-11 items-center text-xs font-semibold text-ink-soft"
            aria-expanded={showRegrets}
          >
            🔮 Regret machine {showRegrets ? "▾" : "▸"}
          </button>
          {showRegrets && (
            <ul className="space-y-1.5 text-[11.5px]" data-testid="regrets">
              {recap.regrets.map((r) => (
                <li key={r.id}>{regretCopy(r)}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
