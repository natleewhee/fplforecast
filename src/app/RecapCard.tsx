"use client";

import { useEffect, useRef, useState } from "react";
import type { RecapResponse } from "./api/recap/route";
import { rankMove, regretCopy, tier, verdict, type Recap } from "@/lib/recap";
import { pickCaption } from "@/lib/shareCaption";
import { ChevronIcon, CrystalIcon } from "./Icons";
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

/** The recap for a finished gameweek: the same collectible card that gets
 * shared, shown here first, with the achievements and the regret machine
 * under it. While matches are live it folds to a single bar so it stays out
 * of the way; tap the bar to open it. */
export default function RecapCard({
  teamId,
  collapsed = false,
}: {
  teamId?: string | null;
  /** Fold to a bar by default (e.g. while matches are live). A tap on the bar overrides this. */
  collapsed?: boolean;
}) {
  const [recap, setRecap] = useState<Recap | null>(null);
  const [gameweeks, setGameweeks] = useState<number[]>([]);
  const [selected, setSelected] = useState<number | null>(null); // null = latest
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [showRegrets, setShowRegrets] = useState(false);
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const [preview, setPreview] = useState<{ url: string; blob: Blob; gw: number } | null>(null);
  const cache = useRef(new Map<number | "latest", Recap>());
  const chips = useRef<HTMLDivElement>(null);
  const open = userOpen ?? !collapsed;

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

  // Draw the share image once per week and reuse it for the preview and for sharing.
  useEffect(() => {
    if (!recap) return;
    let cancelled = false;
    let url: string | null = null;
    renderRecapCard(recap).then((blob) => {
      if (cancelled || !blob) return;
      url = URL.createObjectURL(blob);
      setPreview({ url, blob, gw: recap.gameweek });
    });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [recap]);

  // Keep the chosen week's chip in view by scrolling the chip row itself.
  // (scrollIntoView would also scroll every ancestor, including the tab
  // carousel, and throw the page sideways.)
  useEffect(() => {
    const row = chips.current;
    const chip = row?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (row && chip) row.scrollLeft = chip.offsetLeft - (row.clientWidth - chip.offsetWidth) / 2;
  }, [recap?.gameweek, gameweeks.length, open]);

  // A recap is a nicety: with nothing to show, stay out of the live view. While
  // the first one loads, hold a bar's worth of space so nothing jumps.
  if (!recap) {
    return loading && !error ? (
      <div className="panel h-[52px] animate-pulse" aria-hidden="true" data-testid="recap-loading" />
    ) : null;
  }

  const move = rankMove(recap);
  const t = tier(recap);
  const ready = preview && preview.gw === recap.gameweek ? preview : null;
  const share = async () => {
    // The image carries the numbers; the message adds a reaction and the link.
    const caption = pickCaption(recap, readRecent());
    const link = `${window.location.origin}/${teamId ? `?team=${teamId}` : ""}`;
    const text = `${caption.text}\n${link}`;
    try {
      const blob = ready?.blob ?? (await renderRecapCard(recap));
      const file = blob ? new File([blob], `gw${recap.gameweek}-recap.png`, { type: "image/png" }) : null;
      if (file && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text });
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
      <button
        type="button"
        onClick={() => setUserOpen(!open)}
        aria-expanded={open}
        className="flex min-h-11 w-full items-center justify-between gap-3 text-left"
      >
        <span className="min-w-0">
          <span className="eyebrow block">
            GW{recap.gameweek} recap · <span style={{ color: t.color }}>{t.label}</span>
          </span>
          <span className="block truncate text-sm font-bold text-ink">
            <span className="stat text-lg text-[var(--accent)]">{recap.points}</span> pts · {verdict(recap)}
          </span>
        </span>
        <ChevronIcon open={open} className="shrink-0 text-ink-faint" />
      </button>

      {open && (
        <>
          {gameweeks.length > 1 && (
            <div
              ref={chips}
              className="relative -mx-1 flex snap-x gap-1.5 overflow-x-auto px-1 pb-1"
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

          {/* also drawn on the card; kept as text for screen readers */}
          {move && <p className="sr-only">{move}</p>}

          <div className="mx-auto w-full max-w-[340px]">
            {ready ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={ready.url}
                alt={`GW${recap.gameweek} recap card: ${recap.points} points. ${verdict(recap)}`}
                className="w-full rounded-2xl"
                data-testid="recap-image"
              />
            ) : (
              <div className="aspect-[800/1300] w-full animate-pulse rounded-2xl bg-white/[0.05]" aria-hidden="true" />
            )}
          </div>

          <button
            type="button"
            onClick={share}
            className="inline-flex h-11 w-full items-center justify-center rounded-full bg-[var(--accent)] px-4 text-sm font-bold text-[var(--bg-0)]"
          >
            Share this card
          </button>
          {(note || error) && (
            <p className="text-[11px] text-ink-faint">{note ?? `Couldn't load that week: ${error}`}</p>
          )}

          {recap.achievements.length > 0 && (
            <ul className="space-y-1.5 text-[11.5px]" data-testid="achievements">
              {recap.achievements.map((a) => (
                <li key={a.id} className="flex items-baseline gap-2">
                  <span className={`chip shrink-0 ${a.good ? "chip-accent" : ""}`}>
                    {a.emoji} {a.title}
                  </span>
                  <span className="text-ink-faint">{a.detail}</span>
                </li>
              ))}
            </ul>
          )}

          {recap.regrets.length > 0 && (
            <div className="border-t border-line pt-2">
              <button
                type="button"
                onClick={() => setShowRegrets((v) => !v)}
                className="inline-flex h-11 items-center gap-1.5 text-xs font-semibold text-ink-soft"
                aria-expanded={showRegrets}
              >
                <CrystalIcon /> Regret machine <ChevronIcon open={showRegrets} width={14} height={14} />
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
        </>
      )}
    </section>
  );
}
