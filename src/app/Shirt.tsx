import type { ReactNode } from "react";
import { kitFor } from "@/lib/teamColors";

/* One shirt for every pitch: the club's colours (keepers in their own kit), a
 * dark chest label for the number, and an outline that can fill (minutes
 * played, or expected points), glow, or dash. Callers decide what the number
 * and outline *mean*; this only draws them. */

export const SHIRT_PATH =
  "M18 4 L8 9 L1 21 L10 27 L14 22 L14 48 Q28 52 42 48 L42 22 L46 27 L55 21 L48 9 L38 4 Q28 11 18 4 Z";

const GK_KIT = { primary: "#f4b740", ink: "#1a1204" };

export function shirtKit(team: string | null | undefined, position: string) {
  return position === "GKP" ? GK_KIT : kitFor(team);
}

export type LabelTone = "ink" | "faint" | "danger" | "accent" | "warn";
const TONE: Record<LabelTone, string> = {
  ink: "#eef2f8",
  faint: "#7482a0",
  danger: "#fb7185",
  accent: "#35e0a1",
  warn: "#fbbf24",
};

export function Shirt({
  team,
  position,
  width,
  label,
  tone = "ink",
  stroke = "rgba(255,255,255,0.55)",
  dashed = false,
  progress = null,
  progressColor = "var(--accent)",
  glow = null,
  dim = 1,
}: {
  team: string | null | undefined;
  position: string;
  width: number;
  label: string;
  tone?: LabelTone;
  stroke?: string;
  dashed?: boolean;
  progress?: number | null; // 0..1, drawn as the outline filling up
  progressColor?: string;
  glow?: string | null; // a CSS colour: pulses while set
  dim?: number;
}) {
  const kit = shirtKit(team, position);
  const height = Math.round((width * 52) / 56);
  const frac = progress == null ? null : Math.max(0, Math.min(1, progress));
  const size = label.length <= 2 ? 12 : label.length === 3 ? 11 : 10;
  return (
    <svg
      viewBox="0 0 56 52"
      width={width}
      height={height}
      className={`relative overflow-visible ${glow ? "live-glow-shirt" : ""}`}
      style={{
        opacity: dim,
        ["--glow" as string]: glow ?? undefined,
        filter: glow ? undefined : "drop-shadow(0 2px 4px rgba(0,0,0,0.55))",
      }}
      aria-hidden
    >
      <path d={SHIRT_PATH} fill={kit.primary} />
      <path d="M20 4.6 Q28 13 36 4.6" fill="none" stroke={kit.ink} strokeOpacity="0.45" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M14 22 V48 M42 22 V48" stroke="rgba(0,0,0,0.22)" strokeWidth="1" />
      <path
        d={SHIRT_PATH}
        fill="none"
        stroke={stroke}
        strokeWidth="1.8"
        strokeLinejoin="round"
        strokeDasharray={dashed ? "3 2.5" : undefined}
      />
      {frac != null && frac > 0 && (
        <path
          d={SHIRT_PATH}
          pathLength={100}
          fill="none"
          stroke={progressColor}
          strokeWidth="3"
          strokeLinejoin="round"
          strokeLinecap="round"
          strokeDasharray={`${frac * 100} 100`}
        />
      )}
      <rect x="15" y="21" width="26" height="14" rx="4" fill="rgba(6,9,15,0.84)" />
      <text
        x="28"
        y="31.6"
        textAnchor="middle"
        fontFamily="ui-monospace, monospace"
        fontWeight="800"
        fontSize={size}
        fill={TONE[tone]}
      >
        {label}
      </text>
    </svg>
  );
}

/** A small pill of icons straddling the bottom edge of a shirt. */
export function ShirtBadges({
  items,
  className = "",
}: {
  items: { key: string; node: ReactNode; title: string }[];
  className?: string;
}) {
  if (!items.length) return null;
  return (
    <span
      className={`absolute -bottom-1.5 left-1/2 flex -translate-x-1/2 items-center gap-px whitespace-nowrap rounded-full border border-white/15 bg-[rgba(6,9,15,0.9)] px-1 py-px text-[9px] leading-none text-ink ${className}`}
    >
      {items.map((it) => (
        <span key={it.key} title={it.title} className="flex items-center">
          {it.node}
        </span>
      ))}
    </span>
  );
}

/** Floor-to-ceiling band with a tick at the projection, on a 0..max scale. */
export function RangeBar({
  floor,
  ceiling,
  xp,
  max = 14,
}: {
  floor: number;
  ceiling: number;
  xp: number | null;
  max?: number;
}) {
  const pos = (v: number) => `${Math.max(0, Math.min(1, v / max)) * 100}%`;
  return (
    <span aria-hidden className="relative mt-0.5 block h-[4px] w-11 rounded-full bg-white/15">
      <span
        className="absolute inset-y-0 rounded-full bg-[var(--accent-2)] opacity-70"
        style={{ left: pos(floor), width: `${Math.max(0.04, (Math.min(ceiling, max) - Math.min(floor, max)) / max) * 100}%` }}
      />
      {xp != null && <span className="absolute -top-px h-[6px] w-px bg-white" style={{ left: pos(xp) }} />}
    </span>
  );
}
