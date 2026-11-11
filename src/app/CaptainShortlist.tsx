"use client";

import { useState } from "react";
import type { Forecast } from "@/lib/snapshots";
import { buildCaptainShortlist } from "@/lib/captainShortlist";
import { lineupFor, resolveSwaps, type PendingSwap } from "@/lib/squadView";
import { Module } from "./PageChrome";

/** The top three captain options for the target gameweek; replaces the old one-line Captain card. */
export default function CaptainShortlist({
  forecast,
  liveSquad,
  pending,
  pool,
}: {
  forecast: Forecast;
  liveSquad?: { id: number; position: string }[] | null;
  pending?: PendingSwap[];
  pool?: Forecast["pool"];
}) {
  const [more, setMore] = useState(false);
  const resolved = resolveSwaps(forecast, liveSquad, pending, pool);
  const { swaps, appliedOut } = resolved;
  const s = buildCaptainShortlist(forecast, swaps, appliedOut, 3, lineupFor(forecast, resolved));
  if (!s) return null;
  // Two rows by default; the model's pick is always one of them. The rest, and each row's
  // range / ownership / form, sit behind "More".
  const pickIdx = s.candidates.findIndex((c) => c.isModelPick);
  const shown = new Set<number>(pickIdx >= 2 ? [pickIdx, 0] : [0, 1]);
  const rows = s.candidates.filter((_, i) => more || shown.has(i));
  const hiddenCount = s.candidates.length - shown.size;
  return (
    <Module
      label={`Captain shortlist · GW${s.gameweek}`}
      accent={
        forecast.overridesApplied > 0 ? (
          <span className="chip chip-warn">{forecast.overridesApplied} manual</span>
        ) : null
      }
    >
      <ol className="space-y-1.5" data-testid="captain-shortlist">
        {rows.map((c) => (
          <li
            key={c.id}
            data-pick={c.isModelPick ? "true" : undefined}
            className={`rounded-lg border px-2 py-1.5 ${c.isModelPick ? "border-[color-mix(in_srgb,var(--accent)_55%,transparent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]" : "border-line"}`}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate text-[13px] font-bold text-ink">
                {c.webName} <span className="text-[10px] font-normal text-ink-faint">{c.team}</span>
              </span>
              <span className="shrink-0 text-[11px] text-ink-soft">
                <span className="stat text-[var(--accent)]">{c.xp.toFixed(1)}</span> xP
              </span>
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10.5px] text-ink-soft">
              {c.isModelPick && <span className="chip chip-accent">Model pick</span>}
              {c.isDouble && <span className="chip chip-warn">Double GW</span>}
              {more && (
                <>
              <span>
                range {c.floor != null && c.ceiling != null ? `${c.floor.toFixed(1)}–${c.ceiling.toFixed(1)}` : "—"}
              </span>
              <span>{c.ownedPct != null ? `${c.ownedPct.toFixed(1)}% owned overall` : "ownership —"}</span>
              <span>form {c.form != null ? c.form.toFixed(1) : "—"}</span>
                </>
              )}
            </div>
          </li>
        ))}
      </ol>
      {s.edge && (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-soft">
          <span className={s.edge.label === "clear edge" ? "chip chip-accent" : "chip"}>
            {s.edge.label} +{s.edge.points.toFixed(1)}
          </span>
          <span>over vice {s.edge.viceName}</span>
        </div>
      )}
      {s.secondNote && <p className="text-[11px] leading-snug text-ink-soft">{s.secondNote.text}</p>}
      <button
        type="button"
        aria-expanded={more}
        data-testid="captain-more"
        onClick={() => setMore((m) => !m)}
        className="inline-flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border border-line px-3 text-[11px] font-medium text-ink-soft hover:border-border-strong"
      >
        <span>{more ? "Less" : `More${hiddenCount > 0 ? `: ${hiddenCount} more pick${hiddenCount === 1 ? "" : "s"}, ` : ": "}range, ownership, form`}</span>
        <span aria-hidden>{more ? "▴" : "▾"}</span>
      </button>
      {more && (
        <p className="text-[10px] leading-snug text-ink-faint">
          Ranked by expected points. Ownership is FPL&rsquo;s overall figure, not effective ownership.
        </p>
      )}
    </Module>
  );
}
