"use client";

import type { ReactNode } from "react";
import type { ForecastPlayer, OpponentLeg, ProjectionComponents } from "@/lib/snapshots";
import { availabilityFlag } from "@/lib/availability";
import { OppChip } from "./Pitch";
import BottomSheet from "./BottomSheet";

const COMPONENT_LABEL: Record<keyof ProjectionComponents, string> = {
  appearance: "Appearance",
  goals: "Goals",
  assists: "Assists",
  cleanSheet: "Clean sheet",
  goalsConceded: "Goals conceded",
  saves: "Saves",
  defensiveContribution: "Defensive contribution",
  bonus: "Bonus",
  cards: "Cards",
};

const COMPONENT_COLOR: Record<keyof ProjectionComponents, string> = {
  appearance: "var(--ink-soft)",
  goals: "var(--accent)",
  assists: "var(--mid)",
  cleanSheet: "var(--def)",
  goalsConceded: "var(--danger)",
  saves: "var(--gkp)",
  defensiveContribution: "var(--fwd)",
  bonus: "var(--warn)",
  cards: "var(--danger)",
};

function sourceLabel(rateSource: string | undefined): string | null {
  if (!rateSource) return null;
  if (rateSource === "history") return "PL history";
  if (rateSource === "price") return "price prior (no PL history yet)";
  if (rateSource.startsWith("understat:")) return `Understat: ${rateSource.slice(10).replace(/_/g, " ")}`;
  return rateSource;
}

/** Why the model rates a player: the target gameweek's per-component xP
 * split (already in the forecast JSON as breakdown.components, never shown
 * before), plus the minutes/availability/source context behind it. */
export default function PlayerBreakdownSheet({
  player,
  xp,
  opponents,
  gameweek,
  isTargetGw,
  onClose,
  footer,
}: {
  player: ForecastPlayer;
  xp: number | null;
  opponents: OpponentLeg[];
  gameweek: number;
  isTargetGw: boolean;
  onClose: () => void;
  footer?: ReactNode; // an action under the details, e.g. "Replace this player"
}) {
  const b = player.breakdown;
  const components = isTargetGw && b.components ? b.components : null;
  const rows = components
    ? (Object.keys(COMPONENT_LABEL) as (keyof ProjectionComponents)[])
        .map((k) => ({ key: k, value: components[k] ?? 0 }))
        .filter((r) => Math.abs(r.value) >= 0.05)
    : [];
  const positiveTotal = rows.reduce((s, r) => s + Math.max(0, r.value), 0);
  const multiplier = b.availabilityMultiplier;
  const doubt = availabilityFlag(player.availability);
  const source = sourceLabel(b.rateSource);

  return (
    <BottomSheet label={`${player.webName} xP breakdown`} onClose={onClose}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow">
            {player.position} · {player.team} · GW{gameweek}
          </p>
          <h3 className="truncate text-lg font-semibold text-ink">{player.webName}</h3>
          <div className="mt-1">
            <OppChip opponents={opponents} />
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="stat stat-glow text-3xl leading-none">{xp != null ? xp.toFixed(1) : "—"}</div>
          <div className="eyebrow mt-1">xP</div>
          {isTargetGw && player.floorCeiling && (
            <div className="font-mono text-[10px] text-ink-faint">
              {player.floorCeiling.floor.toFixed(1)}–{player.floorCeiling.ceiling.toFixed(1)}
            </div>
          )}
        </div>
      </div>

      {components ? (
        <div className="mt-4 space-y-2">
          {positiveTotal > 0 && (
            <div className="flex h-2 overflow-hidden rounded-full bg-white/[0.06]" aria-hidden>
              {rows
                .filter((r) => r.value > 0)
                .map((r) => (
                  <span
                    key={r.key}
                    style={{ width: `${(r.value / positiveTotal) * 100}%`, background: COMPONENT_COLOR[r.key] }}
                  />
                ))}
            </div>
          )}
          <ul className="divide-y divide-[var(--line)] text-sm">
            {rows.map((r) => (
              <li key={r.key} className="flex items-center justify-between py-1.5">
                <span className="flex items-center gap-2 text-ink-soft">
                  <span className="h-2 w-2 rounded-full" style={{ background: COMPONENT_COLOR[r.key] }} />
                  {COMPONENT_LABEL[r.key]}
                </span>
                <span className={`font-mono tabular-nums ${r.value < 0 ? "text-[var(--danger)]" : "text-ink"}`}>
                  {r.value > 0 ? "+" : ""}
                  {r.value.toFixed(1)}
                </span>
              </li>
            ))}
            {multiplier != null && multiplier < 0.995 && (
              <li className="flex items-center justify-between py-1.5">
                <span className="text-ink-soft">Availability scaling</span>
                <span className="font-mono tabular-nums text-[var(--warn)]">×{multiplier.toFixed(2)}</span>
              </li>
            )}
          </ul>
        </div>
      ) : (
        <p className="mt-4 text-xs text-ink-faint">
          {isTargetGw
            ? "No component breakdown available for this player yet."
            : "The breakdown by component is only available for the next gameweek. Switch back to it on the rail to see the split."}
        </p>
      )}

      <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-line pt-3 text-[11px]">
        {b.expectedMinutes != null && (
          <>
            <dt className="text-ink-faint">Expected minutes</dt>
            <dd className="text-right font-mono text-ink">{Math.round(b.expectedMinutes)}&prime;</dd>
          </>
        )}
        {doubt && (
          <>
            <dt className="text-ink-faint">Availability</dt>
            <dd className="text-right" style={{ color: doubt.color }}>
              {doubt.label}
            </dd>
          </>
        )}
        {source && (
          <>
            <dt className="text-ink-faint">Based on</dt>
            <dd className="text-right text-ink">{source}</dd>
          </>
        )}
        {(b.provisional || player.provisional) && (
          <>
            <dt className="text-ink-faint">Confidence</dt>
            <dd className="text-right text-[var(--warn)]">provisional</dd>
          </>
        )}
      </dl>
      {footer && <div className="mt-4">{footer}</div>}
    </BottomSheet>
  );
}
