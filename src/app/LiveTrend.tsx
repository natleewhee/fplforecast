"use client";

import { useEffect, useState } from "react";
import type { TrackerView } from "@/lib/liveBlend";

/* The gameweek so far as two small charts: your projected total against the
 * par and safety lines, and your estimated rank. FPL doesn't publish history
 * for either, so each refresh is saved in this browser (per team and
 * gameweek) and the charts build up while the app is open. */

type Point = { t: number; total: number; par: number; safe: number; rank: number | null };

const MAX_POINTS = 400;

function keyFor(teamId: string | null | undefined, gameweek: number) {
  return `fpl-live-trend:${teamId ?? "me"}:${gameweek}`;
}

function load(key: string): Point[] {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as Point[]) : [];
  } catch {
    return [];
  }
}

function useTrend(key: string, point: Point): Point[] {
  const [state, setState] = useState<{ key: string; points: Point[] }>(() => ({ key, points: load(key) }));
  let points = state.points;
  if (state.key !== key) {
    points = load(key);
    setState({ key, points });
  }
  // A new refresh (a new generatedAt) adds a point; the same one never twice.
  if (!points.some((p) => p.t === point.t)) {
    points = [...points, point].slice(-MAX_POINTS);
    setState({ key, points });
  }
  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(points));
    } catch {
      /* storage can be blocked; the charts just won't survive a reload */
    }
  }, [key, points]);
  return points;
}

const W = 320;
const H = 90;
const PAD = { l: 6, r: 6, t: 8, b: 8 };

function scale(vals: number[], pad = 0.1): [number, number] {
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (hi - lo < 1e-6) {
    lo -= 1;
    hi += 1;
  }
  const span = hi - lo;
  return [lo - span * pad, hi + span * pad];
}

function Chart({
  points,
  lines,
  band,
  label,
  invert = false,
}: {
  points: Point[];
  lines: { get: (p: Point) => number | null; color: string; dash?: string; width?: number }[];
  band?: { lo: (p: Point) => number; hi: (p: Point) => number };
  label: string;
  invert?: boolean;
}) {
  const t0 = points[0].t;
  const span = Math.max(1, points[points.length - 1].t - t0);
  const all: number[] = [];
  for (const p of points) {
    for (const l of lines) {
      const v = l.get(p);
      if (v != null) all.push(invert ? Math.log(v) : v);
    }
    if (band) all.push(band.lo(p), band.hi(p));
  }
  const [lo, hi] = scale(all);
  const x = (t: number) => PAD.l + ((t - t0) / span) * (W - PAD.l - PAD.r);
  const y = (v: number) => {
    const val = invert ? Math.log(v) : v;
    const f = (val - lo) / (hi - lo);
    // rank: a smaller number is better, so it sits higher
    return invert ? PAD.t + f * (H - PAD.t - PAD.b) : H - PAD.b - f * (H - PAD.t - PAD.b);
  };
  const path = (get: (p: Point) => number | null) => {
    let d = "";
    for (const p of points) {
      const v = get(p);
      if (v == null) continue;
      d += `${d ? "L" : "M"}${x(p.t).toFixed(1)} ${y(v).toFixed(1)}`;
    }
    return d;
  };
  const bandPath =
    band &&
    points.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)} ${y(band.hi(p)).toFixed(1)}`).join("") +
      [...points].reverse().map((p) => `L${x(p.t).toFixed(1)} ${y(band.lo(p)).toFixed(1)}`).join("") +
      "Z";
  const last = points[points.length - 1];
  const lead = lines[0].get(last);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={label}>
      {bandPath && <path d={bandPath} fill="var(--accent)" fillOpacity="0.1" />}
      {lines.map((l, i) => (
        <path
          key={i}
          d={path(l.get)}
          fill="none"
          stroke={l.color}
          strokeWidth={l.width ?? 1.4}
          strokeDasharray={l.dash}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ))}
      {lead != null && <circle cx={x(last.t)} cy={y(lead)} r="3" fill={lines[0].color} />}
    </svg>
  );
}

export default function LiveTrend({
  view,
  gameweek,
  generatedAt,
  teamId,
}: {
  view: TrackerView;
  gameweek: number;
  generatedAt: string;
  teamId?: string | null;
}) {
  const t = Date.parse(generatedAt);
  const points = useTrend(keyFor(teamId, gameweek), {
    t: Number.isFinite(t) ? t : 0,
    total: view.projectedTotal,
    par: view.par,
    safe: view.par + view.buffer,
    rank: view.estimatedRank?.rank ?? null,
  });

  if (!view.anyMatchStarted) return null;
  if (points.length < 2) {
    return (
      <p className="rounded-lg border border-line px-3 py-2 text-[11px] text-ink-faint">
        The projection chart draws itself as the page refreshes. Keep this tab open and it fills in
        (each refresh is saved on this device).
      </p>
    );
  }

  const first = points[0];
  const last = points[points.length - 1];
  const ranked = points.filter((p) => p.rank != null);
  const rankDelta =
    ranked.length >= 2 ? (ranked[0].rank as number) - (ranked[ranked.length - 1].rank as number) : null;

  return (
    <div className="space-y-3 rounded-xl border border-line p-3">
      <div>
        <div className="flex items-baseline justify-between">
          <span className="eyebrow">Projected total</span>
          <span className="font-mono text-xs text-ink">
            {last.total.toFixed(1)}{" "}
            <span className={last.total - first.total >= 0 ? "text-[var(--accent)]" : "text-[var(--danger)]"}>
              {last.total - first.total >= 0 ? "+" : "−"}
              {Math.abs(last.total - first.total).toFixed(1)}
            </span>
          </span>
        </div>
        <Chart
          points={points}
          label={`Projected total over the gameweek, now ${last.total.toFixed(1)}, with par ${last.par.toFixed(0)} and safety ${last.safe.toFixed(0)}`}
          band={{ lo: (p) => p.par, hi: (p) => p.safe }}
          lines={[
            { get: (p) => p.total, color: "var(--accent)", width: 2 },
            { get: (p) => p.par, color: "var(--warn)", dash: "3 3", width: 1 },
            { get: (p) => p.safe, color: "var(--accent-2)", dash: "3 3", width: 1 },
          ]}
        />
        <p className="text-[10px] text-ink-faint">
          Green line = your projection · shaded band = par to safety score
        </p>
      </div>
      {ranked.length >= 2 && (
        <div>
          <div className="flex items-baseline justify-between">
            <span className="eyebrow">Estimated rank</span>
            <span className="font-mono text-xs text-ink">
              ~{(ranked[ranked.length - 1].rank as number).toLocaleString()}{" "}
              {rankDelta != null && rankDelta !== 0 && (
                <span className={rankDelta > 0 ? "text-[var(--accent)]" : "text-[var(--danger)]"}>
                  {rankDelta > 0 ? "▲" : "▼"} {Math.abs(rankDelta).toLocaleString()}
                </span>
              )}
            </span>
          </div>
          <Chart
            points={ranked}
            invert
            label="Estimated overall rank over the gameweek; higher on the chart is a better rank"
            lines={[{ get: (p) => p.rank, color: "var(--accent-2)", width: 2 }]}
          />
          <p className="text-[10px] text-ink-faint">Higher on the chart = better rank</p>
        </div>
      )}
    </div>
  );
}
