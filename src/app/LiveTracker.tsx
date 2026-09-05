"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildTracker,
  withinMatchWindow,
  type BreakdownItem,
  type LivePayload,
  type TrackerRow,
  type TrackerView,
} from "@/lib/liveBlend";
import { fdrColor } from "@/lib/teamColors";

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

/** Status label that reflects minutes/kickoff, not just the state name — a
 * finished player reads "FT 90'" rather than an ambiguous "finished". */
function statusLabel(row: TrackerRow): string {
  switch (row.status) {
    case "finished":
      return `FT ${row.minutes}'`;
    case "playing":
      return `${row.minutes}'`;
    case "offPitch":
      return `${row.minutes}' off`;
    case "didNotPlay":
      return "did not play";
    case "notStarted":
      return sgKickoff(row.kickoffTime);
  }
}

/** Kickoff day + time in Singapore Time, e.g. "Sat 21:00 SGT". */
function sgKickoff(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const day = d.toLocaleDateString("en-GB", { weekday: "short", timeZone: "Asia/Singapore" });
  const time = d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Singapore",
  });
  return `${day} ${time} SGT`;
}

const BAND_CLASS: Record<TrackerView["band"], string> = {
  green: "chip chip-accent",
  amber: "chip chip-warn",
  red: "chip chip-danger",
};

// FPL's own `explain` identifiers -> a short human label for the breakdown.
const STAT_LABEL_MAP: Record<string, string> = {
  minutes: "Minutes",
  goals_scored: "Goals",
  assists: "Assists",
  clean_sheets: "Clean sheet",
  goals_conceded: "Goals conceded",
  own_goals: "Own goals",
  penalties_saved: "Penalties saved",
  penalties_missed: "Penalties missed",
  yellow_cards: "Yellow card",
  red_cards: "Red card",
  saves: "Saves",
  bonus: "Bonus",
  defensive_contribution: "Defensive contribution",
  mng_win: "Win",
  mng_draw: "Draw",
  mng_loss: "Loss",
  mng_clean_sheets: "Clean sheet",
  mng_goals_scored: "Goals scored",
};

function statLabel(identifier: string): string {
  return (
    STAT_LABEL_MAP[identifier] ??
    identifier
      .split("_")
      .map((w) => w[0]?.toUpperCase() + w.slice(1))
      .join(" ")
  );
}

/** A compact one-line summary for the hover title, e.g. "90' · Clean sheet +4 · 6 pts". */
function breakdownSummary(breakdown: BreakdownItem[], total: number): string {
  const parts = breakdown
    .filter((b) => b.points !== 0 || b.identifier === "minutes")
    .map((b) =>
      b.identifier === "minutes" ? `${b.value}'` : `${statLabel(b.identifier)} ${b.points >= 0 ? "+" : ""}${b.points}`,
    );
  return [...parts, `${total} pts`].join(" · ");
}

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

  // The interval above has no heartbeat of its own: if a poll is missed while
  // the tab is backgrounded right as a match ends, the tracker can freeze on
  // stale "playing" data indefinitely. Force an immediate re-check whenever
  // the tab regains focus/visibility so it self-heals instead of waiting up
  // to a full POLL_MS for the next scheduled tick.
  useEffect(() => {
    const onWake = () => {
      if (document.visibilityState === "visible") {
        setNow(Date.now());
        void tick();
      }
    };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", onWake);
    return () => {
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", onWake);
    };
  }, [tick]);

  const view = useMemo(
    () => (polls.cur ? buildTracker(polls.cur, polls.prev) : null),
    [polls],
  );

  if (loading) return <TrackerSkeleton />;
  if (!polls.cur || !view) return null; // first load failed — pitch and table still render

  const anyStarted = polls.cur.fixtures.some((f) => f.started);
  // Before any match kicks off there is nothing to track and par is meaningless
  // (KD6) — stay hidden so the planning table and pitch lead. Once the
  // gameweek is data_checked (bonus applied, stats final) the tracker's job
  // is done too — hand the lead back to the planning table for the next
  // gameweek's decisions (KTD7), rather than sitting on top showing a frozen
  // final score for the days until the next deadline.
  if (!active && (!anyStarted || polls.cur.dataChecked)) return null;

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
  const finished = row.status === "finished";
  const hasBreakdown = row.breakdown.length > 0;

  const rowContent = (
    <>
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
      <span className="ml-auto flex items-center gap-1 text-[11px] text-ink-faint">
        {row.status === "notStarted" && row.fdrRating != null && (
          <span
            className="inline-block h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: fdrColor(row.fdrRating) }}
            title={`FDR ${row.fdrRating}`}
          />
        )}
        {row.opponent ?? "—"}
      </span>
      <span
        className={`w-28 shrink-0 text-right text-[11px] ${
          finished ? "font-semibold text-[var(--accent)]" : "text-ink-soft"
        }`}
      >
        {finished ? "✓ " : ""}
        {statusLabel(row)}
      </span>
      <span className="w-10 shrink-0 text-right font-mono font-bold tabular-nums text-ink">
        {row.pointsSoFar.toFixed(0)}
      </span>
      <span className="w-12 shrink-0 text-right font-mono text-[11px] tabular-nums text-[var(--accent)]">
        {showRemaining ? `+${row.remainingXp.toFixed(1)}` : ""}
      </span>
    </>
  );

  const rowClass = `flex items-center gap-2 rounded-md px-1 py-1.5 text-sm ${dim ? "opacity-50" : ""} ${
    finished
      ? "bg-[color-mix(in_srgb,var(--accent)_6%,transparent)]"
      : row.subbedIn
        ? "bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]"
        : ""
  }`;

  // Score is clickable once FPL's own breakdown exists (from kickoff onward);
  // <summary> gives both a hover preview (native title tooltip) and a click
  // to expand the full per-category breakdown below — no JS state needed.
  if (!hasBreakdown) {
    return <div className={rowClass}>{rowContent}</div>;
  }

  return (
    <details>
      <summary
        className={`${rowClass} cursor-pointer list-none marker:content-none [&::-webkit-details-marker]:hidden`}
        title={breakdownSummary(row.breakdown, row.pointsSoFar)}
      >
        {rowContent}
      </summary>
      <div className="ml-9 mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 border-l border-line pl-2 pb-1.5 text-[11px] text-ink-soft">
        {row.breakdown
          .filter((b) => b.points !== 0 || b.identifier === "minutes")
          .map((b) => (
            <span key={b.identifier} className="tabular-nums">
              {statLabel(b.identifier)}
              {b.identifier === "minutes" ? (
                <span className="text-ink-faint"> {b.value}&apos;</span>
              ) : (
                <span className={b.points >= 0 ? "text-[var(--accent)]" : "text-[var(--danger)]"}>
                  {" "}
                  {b.points >= 0 ? "+" : ""}
                  {b.points}
                </span>
              )}
            </span>
          ))}
      </div>
    </details>
  );
}
