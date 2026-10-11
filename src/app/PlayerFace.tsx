"use client";

import { useState, type ReactNode } from "react";
import { photoUrls } from "@/lib/playerPhoto";
import { setFaceMode, useFaceMode } from "@/lib/faceMode";
import { Shirt, ShirtBadges, shirtKit, type LabelTone } from "./Shirt";

/* The face of a pitch token: the player's photo in a ring, or their shirt.
 * The ring/outline, number, glow and dimming mean the same in both, so the
 * choice is purely visual. Falls back to the shirt when there is no photo
 * code or no photo URL loads. */

const TONE: Record<LabelTone, string> = {
  ink: "#eef2f8",
  faint: "#7482a0",
  danger: "#fb7185",
  accent: "#35e0a1",
  warn: "#fbbf24",
};

type Badge = { key: string; node: ReactNode; title: string };

export function PlayerFace({
  team,
  position,
  code,
  width,
  label,
  tone = "ink",
  stroke = "rgba(255,255,255,0.55)",
  dashed = false,
  progress = null,
  progressColor = "var(--accent)",
  glow = null,
  dim = 1,
  badges = [],
  badgeClass = "",
}: {
  team: string | null | undefined;
  position: string;
  code?: number | null;
  width: number;
  label: string;
  tone?: LabelTone;
  stroke?: string;
  dashed?: boolean;
  progress?: number | null;
  progressColor?: string;
  glow?: string | null;
  dim?: number;
  badges?: Badge[];
  badgeClass?: string;
}) {
  const mode = useFaceMode();
  const urls = photoUrls(code);
  const [tried, setTried] = useState(0);
  const photo = mode === "photo" && tried < urls.length;

  if (!photo) {
    return (
      <>
        <Shirt
          team={team}
          position={position}
          width={width}
          label={label}
          tone={tone}
          stroke={stroke}
          dashed={dashed}
          progress={progress}
          progressColor={progressColor}
          glow={glow}
          dim={dim}
        />
        <ShirtBadges items={badges} className={badgeClass} />
      </>
    );
  }

  const d = Math.round((width * 52) / 56);
  const kit = shirtKit(team, position);
  const frac = progress == null ? null : Math.max(0, Math.min(1, progress));
  return (
    <div
      className={`absolute left-1/2 top-0 -translate-x-1/2 ${glow ? "live-glow-shirt" : ""}`}
      style={{
        width: d,
        height: d,
        opacity: dim,
        ["--glow" as string]: glow ?? undefined,
        filter: glow ? undefined : "drop-shadow(0 2px 4px rgba(0,0,0,0.55))",
      }}
    >
      <div
        className="absolute inset-[8%] overflow-hidden rounded-full"
        style={{ background: `radial-gradient(circle at 50% 35%, ${kit.primary}, color-mix(in srgb, ${kit.primary} 55%, #06090f))` }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={urls[tried]}
          src={urls[tried]}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          draggable={false}
          onError={() => setTried((n) => n + 1)}
          className="h-full w-full object-cover object-top"
        />
      </div>
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden>
        <circle cx="50" cy="50" r="46" fill="none" stroke={stroke} strokeWidth="4" strokeDasharray={dashed ? "5 4" : undefined} />
        {frac != null && frac > 0 && (
          <circle
            cx="50"
            cy="50"
            r="46"
            pathLength={100}
            fill="none"
            stroke={progressColor}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={`${frac * 100} 100`}
          />
        )}
      </svg>
      {/* the number, with any event/risk icons tucked in front of it */}
      <span
        className={`absolute -bottom-1.5 -right-1 flex items-center gap-1 whitespace-nowrap rounded-full border border-white/15 bg-[rgba(6,9,15,0.9)] px-1.5 py-px leading-tight ${badgeClass}`}
      >
        {badges.length > 0 && (
          <span className="flex items-center gap-px text-[9px] leading-none text-ink">
            {badges.map((b) => (
              <span key={b.key} title={b.title} className="flex items-center">
                {b.node}
              </span>
            ))}
          </span>
        )}
        <span className="font-mono text-[11px] font-extrabold" style={{ color: TONE[tone] }}>
          {label}
        </span>
      </span>
    </div>
  );
}

/** Photos / Shirts switch, shared by every pitch. */
export function FaceToggle() {
  const mode = useFaceMode();
  const opt = (value: "photo" | "shirt", text: string) => (
    <button
      type="button"
      aria-pressed={mode === value}
      onClick={() => setFaceMode(value)}
      className={`h-8 px-3 text-[11px] font-semibold transition-colors ${
        mode === value ? "bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] text-[var(--accent)]" : "text-ink-soft hover:text-ink"
      }`}
    >
      {text}
    </button>
  );
  return (
    <div role="group" aria-label="Player faces" className="inline-flex overflow-hidden rounded-full border border-line">
      {opt("photo", "Photos")}
      {opt("shirt", "Shirts")}
    </div>
  );
}
