"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  buildTracker,
  withinMatchWindow,
  type LivePayload,
  type TrackerView,
} from "@/lib/liveBlend";
import { clockTime } from "@/lib/time";
import { staleness } from "@/lib/staleness";
import DuelMini from "./DuelMini";
import LivePitch from "./LivePitch";

/* The in-gameweek surface (KTD7): while matches are live it leads the page with
 * a projected final total, the par band and arrow, and a per-player breakdown,
 * repolling `/api/live` about once a minute. Outside a match window it renders
 * the last figures with no polling (AE6); before the first kickoff it hides so
 * the planning table and pitch lead. All blend maths live in `liveBlend.ts`. */

const POLL_MS = 60_000;

const BAND_CLASS: Record<TrackerView["band"], string> = {
  green: "chip chip-accent",
  amber: "chip chip-warn",
  red: "chip chip-danger",
};

type Polls = { cur: LivePayload | null; prev: LivePayload | null };

function subscribeOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}
const useOnline = () =>
  useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);

export default function LiveTracker({
  teamId,
  onActive,
}: {
  // Told whenever matches go live or stop, so other cards can make way.
  onActive?: (active: boolean) => void;
  // Set only while viewing a shared link that differs from the saved
  // cookie (AppShell's isViewingSharedLink) -- passed through explicitly
  // so this tab follows the URL's team, not whatever's saved, per the
  // experience-roadmap plan's Phase 2 "Done when" list.
  teamId?: string | null;
}) {
  // Keep the last two polls: `prev` feeds off-pitch inference (frozen minutes).
  const [polls, setPolls] = useState<Polls>({ cur: null, prev: null });
  const [now, setNow] = useState<number>(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const [lastOk, setLastOk] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const online = useOnline();

  const tick = useCallback(async () => {
    try {
      const qs = teamId ? `?teamId=${teamId}` : "";
      const res = await fetch(`/api/live${qs}`, { cache: "no-store" });
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
  }, [teamId]);

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
    onActive?.(active);
  }, [active, onActive]);

  useEffect(() => {
    if (!active) return; // stopped outside match windows (AE6, R8)
    const id = setInterval(() => {
      // Nobody is looking: skip the poll to save battery and data. The wake
      // handler below catches up the moment the tab is visible again.
      if (document.visibilityState === "hidden") return;
      setNow(Date.now());
      void tick();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [active, tick]);

  // A light clock so "updated 3 min ago" keeps counting between polls.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  // Back online: don't wait for the next scheduled poll.
  useEffect(() => {
    const onOnline = () => void tick();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [tick]);

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
  // First load failed outright (no live payload at all) -- still show
  // whatever we have (last result, and the deadline once a payload lands).
  if (!polls.cur || !view) {
    return error ? <LoadFailed error={error} online={online} onRetry={() => void tick()} /> : null;
  }

  const anyStarted = polls.cur.fixtures.some((f) => f.started);
  // Before any match kicks off there is nothing to *track* and par is
  // meaningless (KD6), and once the gameweek is data_checked (bonus applied,
  // stats final) the tracker's job is done too (KTD7) -- but the tab used to
  // just go blank for that whole stretch (deadline day through kickoff, and
  // again once the gameweek wraps up). Show the idle recap/countdown instead
  // of nothing so the tab always has content, and hand the *planning* lead
  // back to the Squad/Scenarios tabs rather than a frozen live score.
  if (!active && (!anyStarted || polls.cur.dataChecked)) {
    return null;
  }

  return (
    <TrackerPanel
      view={view}
      payload={polls.cur}
      active={active}
      error={error}
      lastOk={lastOk}
      now={now}
      online={online}
    />
  );
}

/** The very first load failed and there is nothing to show: say why, and let
 * the user retry rather than leaving a silent blank. */
function LoadFailed({ error, online, onRetry }: { error: string; online: boolean; onRetry: () => void }) {
  return (
    <div className="panel rise flex items-center justify-between gap-3 p-4" role="alert" data-testid="live-failed">
      <p className="text-xs text-[var(--warn)]">
        {online ? `Couldn't load live data: ${error}` : "You're offline. Live data will load when you're back."}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex h-11 shrink-0 items-center rounded-full border border-line px-3 text-[11px] text-ink-soft hover:border-border-strong"
      >
        Retry
      </button>
    </div>
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
  now,
  online,
}: {
  view: TrackerView;
  payload: LivePayload;
  active: boolean;
  error: string | null;
  lastOk: string | null;
  now: number;
  online: boolean;
}) {
  const fresh = staleness({
    lastOkMs: lastOk ? Date.parse(lastOk) : null,
    nowMs: now,
    active,
    error,
    online,
  });
  const starters = view.rows.filter((r) => !r.isBench || r.subbedIn || view.benchBoost);
  const currentScore = starters.reduce((sum, r) => sum + r.pointsSoFar, 0);

  // Safety score: score above this and you're in the clear (green) --
  // reframed from the raw par/gap numbers, which read as unexplained jargon
  // rather than a single actionable threshold.
  const safetyScore = view.par + view.buffer;
  const bandStatus: Record<TrackerView["band"], string> = {
    green: "In the clear",
    amber: "Borderline",
    red: "At risk",
  };

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
        <span className="text-[11px] text-ink-faint">
          {fresh.level === "ok" ? fresh.text : `updated ${clockTime(lastOk)}`}
        </span>
      </div>

      {fresh.level !== "ok" && (
        <p
          role="status"
          data-testid="live-stale"
          data-level={fresh.level}
          className="rounded-lg border border-[color-mix(in_srgb,var(--warn)_40%,transparent)] bg-[color-mix(in_srgb,var(--warn)_10%,transparent)] px-3 py-2 text-xs font-medium text-[var(--warn)]"
        >
          {fresh.text}
        </p>
      )}

      <DuelMini refreshKey={lastOk} />

      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <div>
          <div className="stat text-4xl leading-none">{currentScore.toFixed(0)}</div>
          <div className="eyebrow mt-1">current score</div>
        </div>
        <div>
          <div className="stat stat-glow text-4xl leading-none">
            {view.projectedTotal.toFixed(1)}
          </div>
          <div className="eyebrow mt-1">projected GW total</div>
        </div>
        {view.estimatedRank && (
          <div>
            <div className="stat text-4xl leading-none text-ink">
              ~{view.estimatedRank.rank.toLocaleString()}
            </div>
            <div className="eyebrow mt-1">est. overall rank</div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className={BAND_CLASS[view.band]}>{bandStatus[view.band]}</span>
        <span className="text-xs text-ink-soft">
          score above <span className="font-mono font-semibold text-ink">{safetyScore.toFixed(0)}</span>{" "}
          and you&rsquo;re in the clear
        </span>
        {view.lowConfidence && <span className="chip">low confidence</span>}
      </div>

      <details className="text-[11px] text-ink-faint">
        <summary className="cursor-pointer font-medium text-ink-soft hover:text-ink">
          How is the safety score worked out?
        </summary>
        <div className="mt-1.5 space-y-1.5">
          <p>
            It&rsquo;s built from the gameweek average ({payload.liveAverage.toFixed(1)}) plus
            your own hold-rank margin (+{payload.parMargin.toFixed(1)}, from how far above the
            average you&rsquo;ve typically needed to score to hold rank in past gameweeks) — that
            sum is &ldquo;par&rdquo; ({view.par.toFixed(1)}), the break-even line. The safety score
            adds a buffer on top ({view.buffer.toFixed(0)} pts, a cushion since the margin itself
            is an estimate): score above the safety score and you&rsquo;re safely in the clear;
            between par and the safety score is borderline; below par you&rsquo;re on track to
            lose rank.
          </p>
          {view.lowConfidence && (
            <p>
              {payload.marginProvisional
                ? "Shown as low confidence right now because your hold-rank margin is still provisional (too few completed gameweeks) — the wider buffer applies and the band won't show green yet."
                : "Shown as low confidence right now because no match has kicked off — the projection is still the pre-match expectation and par isn't meaningful yet."}
            </p>
          )}
        </div>
      </details>

      {view.estimatedRank && (
        <details className="text-[11px] text-ink-faint">
          <summary className="cursor-pointer font-medium text-ink-soft hover:text-ink">
            How is the overall rank estimated?
          </summary>
          <div className="mt-1.5 space-y-1.5">
            <p>
              FPL doesn&rsquo;t publish the live population&rsquo;s score distribution, so this is
              a personal calibration instead: fitted from how far your projected total
              ({view.projectedTotal.toFixed(1)}) sits above or below the gameweek average
              ({payload.liveAverage.toFixed(1)}), against how your own overall rank has actually
              moved with that gap over your last {view.estimatedRank.sampleSize} finished
              gameweeks. Treat it as a rough steer, not a real-time population estimate.
            </p>
            {view.estimatedRank.lastKnownRank != null && (
              <p>Last known rank: {view.estimatedRank.lastKnownRank.toLocaleString()}.</p>
            )}
          </div>
        </details>
      )}

      <LivePitch
        rows={view.rows}
        gameweek={payload.gameweek}
        cover={view.benchCover}
        polledAt={lastOk ? Date.parse(lastOk) : 0}
      />
    </div>
  );
}
