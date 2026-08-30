"use client";

import { useState } from "react";
import type { ProjectionBreakdown, ProjectionComponents } from "@/lib/snapshots";

const COMPONENT_LABELS: [keyof ProjectionComponents, string][] = [
  ["appearance", "appearance"],
  ["goals", "goals"],
  ["assists", "assists"],
  ["cleanSheet", "clean sheet"],
  ["goalsConceded", "goals conceded"],
  ["saves", "saves"],
  ["defensiveContribution", "def. contribution"],
  ["bonus", "bonus"],
  ["cards", "cards"],
];

function BreakdownPanel({ breakdown }: { breakdown: ProjectionBreakdown }) {
  const c = breakdown.components;
  const opp = breakdown.opponents;
  return (
    <span
      role="tooltip"
      className="absolute right-0 top-full z-20 mt-1 block w-60 rounded-lg border border-line bg-card p-3 text-left text-xs font-normal text-ink shadow-lg"
    >
      <span className="mb-1 block font-semibold text-ink">Expected points</span>
      {c && (
        <span className="grid grid-cols-[1fr_auto] gap-x-2 gap-y-0.5 tabular-nums">
          {COMPONENT_LABELS.filter(([k]) => k === "appearance" || c[k] !== 0).map(([k, label]) => (
            <span key={k} className="contents">
              <span className="text-ink-soft">{label}</span>
              <span>{c[k] > 0 ? "+" : ""}{c[k].toFixed(2)}</span>
            </span>
          ))}
          <span className="mt-0.5 border-t border-line pt-0.5 font-semibold">projected</span>
          <span className="mt-0.5 border-t border-line pt-0.5 font-semibold">
            {breakdown.points?.toFixed(1) ?? "—"}
          </span>
        </span>
      )}
      {opp.length > 0 && (
        <span className="mt-1.5 block border-t border-line pt-1.5 text-ink-soft">
          {opp.map((o, i) => (
            <span key={i} className="block">
              {o.wasHome ? "vs" : "@"} {o.team ?? "?"}
              {o.fdrRating != null && ` · FDR ${o.fdrRating}`}
              {o.lambdaFor != null && ` · goals for ${o.lambdaFor.toFixed(1)} / against ${o.lambdaAgainst?.toFixed(1)}`}
              {o.cleanSheetProb != null && ` · CS ${Math.round(o.cleanSheetProb * 100)}%`}
            </span>
          ))}
        </span>
      )}
      {breakdown.provisional && (
        <span className="mt-1.5 block border-t border-line pt-1.5 text-[11px] text-amber-700">
          Provisional — no Premier League history yet, projected from{" "}
          {rateSourceLabel(breakdown.rateSource)}.
        </span>
      )}
    </span>
  );
}

function rateSourceLabel(source?: string): string {
  if (!source || source === "history") return "a position prior";
  if (source === "price") return "the price tier";
  if (source.startsWith("understat:")) {
    return `${source.slice("understat:".length).replace(/_/g, " ")} form`;
  }
  return source;
}

export default function ProjectionCell({
  points,
  breakdown,
}: {
  points: number | null;
  breakdown: ProjectionBreakdown;
}) {
  const [open, setOpen] = useState(false);

  if (points === null) {
    return <span className="text-xs italic text-ink-soft">—</span>;
  }

  return (
    <span
      className={`relative inline-block cursor-help font-semibold underline decoration-dotted decoration-1 underline-offset-2 tabular-nums ${
        breakdown.provisional ? "text-amber-700" : "text-[var(--pitch-dark)]"
      }`}
      tabIndex={0}
      aria-label={`Projected ${points.toFixed(1)} points${
        breakdown.provisional ? " (provisional)" : ""
      } — tap for the breakdown`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onClick={() => setOpen((v) => !v)}
    >
      {points.toFixed(1)}
      {breakdown.provisional && <sup className="ml-0.5 text-[9px] font-normal">est</sup>}
      {open && <BreakdownPanel breakdown={breakdown} />}
    </span>
  );
}
