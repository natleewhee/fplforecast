"use client";

import { useEffect, useRef, useState } from "react";
import type { RecapResponse } from "./api/recap/route";
import { rankMove, regretCopy, tier, verdict, type Recap } from "@/lib/recap";
import { renderRecapCard } from "./recapCanvas";

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
      const blob = await renderRecapCard(recap);
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
