"use client";

import { useEffect, useRef, useState } from "react";
import type { RecapResponse } from "./api/recap/route";
import { rankMove, regretCopy, tier, verdict, type Recap } from "@/lib/recap";
import { pickCaption } from "@/lib/shareCaption";
import { renderRecapCard } from "./recapCanvas";

const RECENT_KEY = "gaffer-recent-captions";
const RECENT_KEEP = 12;

function readRecent(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function rememberCaption(id: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...readRecent().filter((x) => x !== id)].slice(0, RECENT_KEEP)));
  } catch {
    // not remembering just means a line may repeat sooner
  }
}

export default function RecapCard({ teamId }: { teamId?: string | null }) {
  const [recap, setRecap] = useState<Recap | null>(null);
  const [gameweeks, setGameweeks] = useState<number[]>([]);
  const [selected, setSelected] = useState<number | null>(null); // null = latest
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [showRegrets, setShowRegrets] = useState(false);
  const cache = useRef(new Map<number | "latest", Recap>());
  const chips = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const key = selected ?? "latest";
    const hit = cache.current.get(key);
    if (hit) {
      setRecap(hit);
      setNote(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const params = new URLSearchParams();
        if (teamId) params.set("teamId", teamId);
        if (selected != null) params.set("gw", String(selected));
        const qs = params.toString() ? `?${params.toString()}` : "";
        const res = await fetch(`/api/recap${qs}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        if (cancelled) return;
        const body = json as RecapResponse;
        if (body.recap) cache.current.set(key, body.recap);
        setGameweeks(body.gameweeks ?? []);
        setRecap(body.recap);
        setNote(null);
        setError(null);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [teamId, selected]);

  // keep the chosen week's chip in view as the picker scrolls
  useEffect(() => {
    chips.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.scrollIntoView({
      inline: "center",
      block: "nearest",
    });
  }, [recap?.gameweek, gameweeks.length]);

  // a recap is a nicety: with nothing to show, stay out of the live view
  if (!recap) return null;

  const move = rankMove(recap);
  const share = async () => {
    // The image carries the numbers; the message adds a reaction and the link.
    const caption = pickCaption(recap, readRecent());
    const link = `${window.location.origin}/${teamId ? `?team=${teamId}` : ""}`;
    const text = `${caption.text}\n${link}`;
    try {
      const blob = await renderRecapCard(recap);
      if (blob && navigator.canShare?.({ files: [new File([blob], "recap.png", { type: "image/png" })] })) {
        await navigator.share({ files: [new File([blob], `gw${recap.gameweek}-recap.png`, { type: "image/png" })], text });
        rememberCaption(caption.id);
        return;
      }
      if (navigator.share) {
        await navigator.share({ text });
        rememberCaption(caption.id);
        return;
      }
      await navigator.clipboard.writeText(text);
      rememberCaption(caption.id);
      setNote("Caption and link copied");
    } catch (err) {
      if ((err as DOMException).name !== "AbortError") setNote("Couldn't share from this browser");
    }
  };

  return (
    <section className={`panel rise space-y-3 p-3 transition-opacity ${loading ? "opacity-60" : ""}`} data-testid="recap">
      {gameweeks.length > 1 && (
        <div
          ref={chips}
          className="-mx-1 flex snap-x gap-1.5 overflow-x-auto px-1 pb-1"
          role="group"
          aria-label="Choose a gameweek"
        >
          {gameweeks.map((gw) => (
            <button
              key={gw}
              type="button"
              onClick={() => setSelected(gw === gameweeks[gameweeks.length - 1] ? null : gw)}
              aria-pressed={gw === recap.gameweek}
              className={`inline-flex h-11 shrink-0 snap-center items-center rounded-full border px-3.5 text-xs font-bold ${
                gw === recap.gameweek
                  ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--bg-0)]"
                  : "border-line text-ink-soft hover:border-border-strong"
              }`}
            >
              GW{gw}
            </button>
          ))}
        </div>
      )}
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
      {(note || error) && (
        <p className="text-[11px] text-ink-faint">{note ?? `Couldn't load that week: ${error}`}</p>
      )}

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
