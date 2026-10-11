"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";

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

/** Glides tokens to their new places when the layout changes (a different
 * gameweek's XI, a substitution, a swapped player) instead of jumping: each
 * element marked `data-flip="<id>"` is measured after every render and, if it
 * moved, animated from its old spot (FLIP). New arrivals fade in. The first
 * render, a resize, and reduced-motion users all skip the animation. */
function useFlip(root: React.RefObject<HTMLElement | null>) {
  const prev = useRef<{ width: number; pos: Map<string, { x: number; y: number }> } | null>(null);
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const pos = new Map<string, { x: number; y: number }>();
    const before = prev.current;
    const animate =
      before != null &&
      Math.abs(before.width - box.width) < 1 &&
      typeof el.animate === "function" &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.querySelectorAll<HTMLElement>("[data-flip]").forEach((node) => {
      const id = node.dataset.flip as string;
      const r = node.getBoundingClientRect();
      const now = { x: r.left - box.left, y: r.top - box.top };
      pos.set(id, now);
      if (!animate) return;
      const was = before.pos.get(id);
      if (!was) {
        node.animate(
          [
            { opacity: 0, transform: "scale(0.7)" },
            { opacity: 1, transform: "scale(1)" },
          ],
          { duration: 380, easing: "ease-out" },
        );
        return;
      }
      const dx = was.x - now.x;
      const dy = was.y - now.y;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      node.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], {
        duration: 420,
        easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
      });
    });
    prev.current = { width: box.width, pos };
  });
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
  const ref = useRef<HTMLDivElement>(null);
  useFlip(ref);
  return (
    <div
      ref={ref}
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
