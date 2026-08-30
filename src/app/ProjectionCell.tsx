"use client";

import { useState } from "react";
import type { ProjectionBreakdown } from "@/lib/snapshots";

function fmt(n: number | undefined | null, digits = 2): string {
  return n === undefined || n === null ? "—" : n.toFixed(digits);
}

function BreakdownPanel({ breakdown }: { breakdown: ProjectionBreakdown }) {
  const b = breakdown;
  return (
    <span
      role="tooltip"
      className="absolute right-0 top-full z-20 mt-1 block w-60 rounded-lg border border-line bg-card p-3 text-left text-xs font-normal text-ink shadow-lg"
    >
      <span className="mb-1 block font-semibold text-ink">How this is projected</span>
      <span className="grid grid-cols-[1fr_auto] gap-x-2 gap-y-0.5 tabular-nums">
        <span className="text-ink-soft">base (avg · ICT · form)</span>
        <span>{fmt(b.base)}</span>
        <span className="text-ink-soft">× fixture (FDR + strength)</span>
        <span>{fmt(b.fixtureMultiplier)}</span>
        <span className="text-ink-soft">× minutes</span>
        <span>{fmt(b.minutesMultiplier)}</span>
        <span className="text-ink-soft">× availability</span>
        <span>{fmt(b.availabilityMultiplier)}</span>
        <span className="mt-0.5 border-t border-line pt-0.5 font-semibold">projected</span>
        <span className="mt-0.5 border-t border-line pt-0.5 font-semibold">{fmt(b.points, 1)}</span>
      </span>
      {b.opponents.length > 0 && (
        <span className="mt-1.5 block border-t border-line pt-1.5 text-ink-soft">
          {b.opponents.map((o, i) => (
            <span key={i} className="block">
              {o.wasHome ? "vs" : "@"} {o.team ?? "?"} · FDR {o.fdrRating ?? "—"}
              {o.strengthMultiplier !== 1 && ` · strength ×${o.strengthMultiplier.toFixed(2)}`}
            </span>
          ))}
        </span>
      )}
    </span>
  );
}

export default function ProjectionCell({
  points,
  breakdown,
}: {
  points: number | null;
  breakdown: ProjectionBreakdown;
}) {
  const [open, setOpen] = useState(false);

  if (points === null || breakdown.coldStart) {
    return <span className="text-xs italic text-ink-soft">no history</span>;
  }

  return (
    <span
      className="relative inline-block cursor-help font-semibold text-[var(--pitch-dark)] underline decoration-dotted decoration-1 underline-offset-2 tabular-nums"
      tabIndex={0}
      aria-label={`Projected ${points.toFixed(1)} points — tap for the calculation`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onClick={() => setOpen((v) => !v)}
    >
      {points.toFixed(1)}
      {open && <BreakdownPanel breakdown={breakdown} />}
    </span>
  );
}
