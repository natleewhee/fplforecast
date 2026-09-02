"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildTracker,
  withinMatchWindow,
  type LivePayload,
  type PlayerStatus,
  type TrackerRow,
  type TrackerView,
} from "@/lib/liveBlend";

/* The in-gameweek surface (KTD7): while matches are live it leads the page with
 * a projected final total, the par band and arrow, and a per-player breakdown,
 * repolling `/api/live` about once a minute. Outside a match window it renders
 * the last figures with no polling (AE6); before the first kickoff it hides so
 * the planning table and pitch lead. All blend maths live in `liveBlend.ts`. */

const POLL_MS = 60_000;

const POSITION_COLOR: Record<string, string> = {
  GKP: "bg-[var(--gkp)]",
  DEF: "bg-[var(--def)]",
  MID: "bg-[var(--mid)]",
  FWD: "bg-[var(--fwd)]",
};

const STATUS_LABEL: Record<PlayerStatus, string> = {
  notStarted: "not started",
  playing: "playing",
  offPitch: "off",
  finished: "finished",
  didNotPlay: "did not play",
};

const BAND_CLASS: Record<TrackerView["band"], string> = {
  green: "chip chip-accent",
  amber: "chip chip-warn",
  red: "chip chip-danger",
};

function hhmm(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

type Polls = { cur: LivePayload | null; prev: LivePayload | null };

export default function LiveTracker() {
  // Keep the last two polls: `prev` feeds off-pitch inference (frozen minutes).
  const [polls, setPolls] = useState<Polls>({ cur: null, prev: null });
  const [now, setNow] = useState<number>(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const [lastOk, setLastOk] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const tick = useCallback(async () => {
    try {
      const res = await fetch("/api/live", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setPolls((p) => ({ cur: json as LivePayload, prev: p.cur }));
      setError(null);
      setLastOk(new Date().toISOString());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
      setNow(Date.now());
    }
  }, []);

  useEffect(() => {
    // Deferred one tick so the first poll's setState lands after mount, not
    // synchronously inside the effect.
    const t = setTimeout(tick, 0);
    return () => clearTimeout(t);
  }, [tick]);

  const active =
    polls.cur != null &&
    (polls.cur.matchesLive || withinMatchWindow(polls.cur.fixtures, now));

  useEffect(() => {
    if (!active) return; // stopped outside match windows (AE6, R8)
    const id = setInterval(() => {
      setNow(Date.now());
      void tick();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [active, tick]);

  const view = useMemo(
    () => (polls.cur ? buildTracker(polls.cur, polls.prev) : null),
    [polls],
  );

  if (loading) return <TrackerSkeleton />;
  if (!polls.cur || !view) return null; // first load failed — pitch and table still render

  const anyStarted = polls.cur.fixtures.some((f) => f.started);
  // Before any match kicks off there is nothing to track and par is meaningless
  // (KD6) — stay hidden so the planning table and pitch lead (KTD7).
  if (!active && !anyStarted) return null;

  return (
    <TrackerPanel view={view} payload={polls.cur} active={active} error={error} lastOk={lastOk} />
  );
}

function TrackerSkeleton() {
  return (
    <div className="panel rise space-y-3 p-4">
      <div className="h-3 w-24 animate-pulse rounded bg-white/10" />
      <div className="h-9 w-40 animate-pulse rounded bg-white/[0.08]" />
      <div className="space-y-1.5">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-7 animate-pulse rounded bg-white/[0.05]" />
        ))}
      </div>
    </div>
  );
}

function TrackerPanel({
  view,
  payload,
  active,
  error,
  lastOk,
}: {
  view: TrackerView;
  payload: LivePayload;
  active: boolean;
  error: string | null;
  lastOk: string | null;
}) {
  const up = view.gapToPar >= 0;
  const gapLabel = `${up ? "+" : "−"}${Math.abs(view.gapToPar).toFixed(1)} vs par`;
  const starters = view.rows.filter((r) => !r.isBench || r.subbedIn);
  const bench = view.rows.filter((r) => r.isBench && !r.subbedIn);

  return (
    <div className="panel rise space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="eyebrow">
          Live · GW{payload.gameweek}
          {active ? (
            <span className="ml-2 inline-flex items-center gap-1 text-[var(--accent)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] pulse" /> updating
            </span>
          ) : (
            <span className="ml-2 text-ink-faint">final</span>
          )}
        </span>
        <span className="text-[11px] text-ink-faint">updated {hhmm(lastOk)}</span>
      </div>

      {error && (
        <p className="rounded-lg border border-[color-mix(in_srgb,var(--warn)_40%,transparent)] bg-[color-mix(in_srgb,var(--warn)_10%,transparent)] px-3 py-2 text-xs font-medium text-[var(--warn)]">
          Live data unavailable — last update {hhmm(lastOk)}. Retrying…
        </p>
      )}

      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <div>
          <div className="stat stat-glow text-4xl leading-none">
            {view.projectedTotal.toFixed(1)}
          </div>
          <div className="eyebrow mt-1">projected GW total</div>
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className={BAND_CLASS[view.band]}>
              {up ? "▲" : "▼"} {gapLabel}
            </span>
            {view.lowConfidence && <span className="chip">low confidence</span>}
          </div>
          <div className="eyebrow mt-1 tabular-nums">
            par {view.par.toFixed(1)}{" "}
            <span className="text-ink-faint">
              (avg {payload.liveAverage.toFixed(1)} + margin {payload.parMargin.toFixed(1)}, buffer{" "}
              {view.buffer.toFixed(0)})
            </span>
          </div>
        </div>
      </div>

      {view.lowConfidence && (
        <p className="text-[11px] text-ink-faint">
          {payload.marginProvisional
            ? "Hold-rank margin still provisional — the wider buffer applies and the band will not show green yet."
            : "No match has kicked off — the projection is the pre-baked expectation and par is not yet meaningful."}
        </p>
      )}

      <div className="space-y-1">
        {starters.map((r) => (
          <PlayerRow key={r.id} row={r} />
        ))}
        {bench.length > 0 && (
          <>
            <div className="eyebrow px-1 pt-2">Bench</div>
            {bench.map((r) => (
              <PlayerRow key={r.id} row={r} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function PlayerRow({ row }: { row: TrackerRow }) {
  const dim = row.isBench && !row.subbedIn;
  const showRemaining = row.status === "notStarted" || row.status === "playing";
  return (
    <div
      className={`flex items-center gap-2 rounded-md px-1 py-1.5 text-sm ${
        dim ? "opacity-50" : ""
      } ${row.subbedIn ? "bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]" : ""}`}
    >
      <span
        className={`inline-block w-8 shrink-0 rounded py-0.5 text-center text-[9px] font-bold tracking-wide text-black/85 ${
          POSITION_COLOR[row.position] ?? "bg-ink-soft"
        }`}
      >
        {row.position}
      </span>
      <span className={`font-medium text-ink ${row.subbedOut ? "line-through opacity-60" : ""}`}>
        {row.webName}
      </span>
      {row.isArmband && <span className="chip chip-accent !py-0 text-[10px]">C</span>}
      {row.subbedIn && <span className="chip chip-accent !py-0 text-[10px]">sub ▲</span>}
      {row.subbedOut && <span className="chip chip-danger !py-0 text-[10px]">sub ▼</span>}
      {row.noBakedXp && (
        <span className="chip !py-0 text-[10px]" title="no baked xP in the latest snapshot">
          no xP
        </span>
      )}
      <span className="ml-auto text-[11px] text-ink-faint">{row.opponent ?? "—"}</span>
      <span className="w-20 shrink-0 text-right text-[11px] text-ink-soft">
        {STATUS_LABEL[row.status]}
      </span>
      <span className="w-10 shrink-0 text-right font-mono font-bold tabular-nums text-ink">
        {row.pointsSoFar.toFixed(0)}
      </span>
      <span className="w-12 shrink-0 text-right font-mono text-[11px] tabular-nums text-[var(--accent)]">
        {showRemaining ? `+${row.remainingXp.toFixed(1)}` : ""}
      </span>
    </div>
  );
}
