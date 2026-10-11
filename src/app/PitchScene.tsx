import type { ReactNode } from "react";

/* The shared pitch backdrop: striped dark turf lit from above, a stand along
 * the top touchline, floodlight beams from the corners, and optional "mood"
 * (floodlights up while play is on, dimmed at full time) and goal flare.
 * Used by every pitch in the app so they read as one product. */

export function FieldMarkings({ line = "rgba(255,255,255,0.16)" }: { line?: string }) {
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 300 440"
      preserveAspectRatio="none"
      aria-hidden
    >
      <g fill="none" stroke={line} strokeWidth="1.5">
        <rect x="6" y="6" width="288" height="428" rx="4" />
        <line x1="6" y1="220" x2="294" y2="220" />
        <circle cx="150" cy="220" r="46" />
        <circle cx="150" cy="220" r="2.5" fill={line} stroke="none" />
        {/* top box */}
        <rect x="66" y="6" width="168" height="66" />
        <rect x="108" y="6" width="84" height="26" />
        <path d="M112 72 A44 44 0 0 0 188 72" />
        {/* bottom box */}
        <rect x="66" y="368" width="168" height="66" />
        <rect x="108" y="408" width="84" height="26" />
        <path d="M112 368 A44 44 0 0 1 188 368" />
      </g>
    </svg>
  );
}

export type PitchMood = "pre" | "live" | "ft";

export function PitchScene({
  mood,
  flare = 0,
  compact = false,
  className = "",
  children,
}: {
  mood?: PitchMood;
  flare?: number; // bump to replay the goal flash
  compact?: boolean; // less sky above the first line, for small pitches
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`floodlit-pitch relative overflow-hidden rounded-2xl px-1 ${
        compact ? "pb-4 pt-8" : "pb-6 pt-12"
      } ${mood ? `mood-${mood}` : ""} ${className}`}
    >
      <FieldMarkings line="rgba(255,255,255,0.22)" />
      <div className="stand" style={compact ? { height: 28 } : undefined} aria-hidden />
      <div className="beam beam-l" aria-hidden />
      <div className="beam beam-r" aria-hidden />
      {flare > 0 && <div key={flare} className="goal-flare" aria-hidden />}
      <div className="relative z-10">{children}</div>
    </div>
  );
}
