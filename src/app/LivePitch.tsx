"use client";

import { useCallback, useRef, useState } from "react";
import type { TrackerRow } from "@/lib/liveBlend";
import { fdrColor } from "@/lib/teamColors";
import { parseOpponent, sgKickoff } from "@/lib/liveLabels";
import { FieldMarkings } from "./Pitch";
import LivePlayerSheet, { statusText } from "./LivePlayerSheet";

/* The Live tab's floodlit night pitch: the eleven who count right now (an
 * auto-subbed-in bench player replaces whoever didn't play), each as a token
 * that says at a glance whether they're playing, done, or yet to start. Status
 * is never colour alone: every token also carries a text label under it. */

const ROWS = ["GKP", "DEF", "MID", "FWD"];
const HAUL = 10;

type Tone = "live" | "done" | "off" | "pending" | "dnp";

function tone(row: TrackerRow): Tone {
  switch (row.status) {
    case "playing":
      return "live";
    case "finished":
      return "done";
    case "offPitch":
      return "off";
    case "didNotPlay":
      return "dnp";
    case "notStarted":
      return "pending";
  }
}

/** What sits under the name: minutes, FT, or the kickoff time. */
function shortStatus(row: TrackerRow): string {
  switch (row.status) {
    case "playing":
      return `${row.minutes}'`;
    case "finished":
      return "FT";
    case "offPitch":
      return `${row.minutes}' off`;
    case "didNotPlay":
      return "DNP";
    case "notStarted":
      return sgKickoff(row.kickoffTime);
  }
}

function Token({
  row,
  bench = false,
  onSelect,
}: {
  row: TrackerRow;
  bench?: boolean;
  onSelect: (id: number, trigger: HTMLButtonElement) => void;
}) {
  const t = tone(row);
  const size = bench ? 40 : 52;
  const pts = row.pointsSoFar;
  const haul = t !== "pending" && pts >= HAUL;
  const ringColor = haul
    ? "var(--accent-2)"
    : t === "off"
      ? "color-mix(in srgb, var(--accent) 40%, transparent)"
      : t === "pending" || t === "dnp"
        ? "rgba(255,255,255,0.28)"
        : "var(--accent)";
  const glowing = t === "live" || (haul && t === "done");
  const opp = parseOpponent(row.opponent);
  const label = `${row.webName}, ${row.position}, ${t === "pending" ? "no points yet" : `${pts.toFixed(0)} points`}, ${statusText(row)}${
    row.isArmband ? ", captain" : row.isViceCaptain ? ", vice captain" : ""
  }`;

  return (
    <button
      type="button"
      onClick={(e) => onSelect(row.id, e.currentTarget)}
      aria-label={label}
      className={`flex w-[4.4rem] flex-col items-center gap-0.5 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${
        bench ? "sm:w-[4.2rem]" : "sm:w-20"
      } ${t === "dnp" ? "opacity-60" : ""}`}
    >
      <div className="relative">
        <div
          className={`grid place-items-center rounded-full ${glowing ? "live-glow" : ""}`}
          style={{
            width: size,
            height: size,
            border: `3px ${t === "pending" ? "dashed" : "solid"} ${ringColor}`,
            background: t === "pending" ? "rgba(6,9,15,0.42)" : "rgba(6,9,15,0.78)",
            ["--glow" as string]: haul ? "var(--accent-2)" : "var(--accent)",
            ["--glow-soft" as string]: haul ? "rgba(56,189,248,0.3)" : "var(--accent-glow)",
          }}
        >
          <span
            className={`font-mono font-bold tabular-nums ${
              t === "pending" ? "text-ink-faint" : pts < 0 ? "text-[var(--danger)]" : "text-ink"
            }`}
            style={{ fontSize: bench ? 14 : 18 }}
          >
            {t === "pending" ? "–" : pts.toFixed(0)}
          </span>
        </div>
        {(row.isArmband || row.isViceCaptain) && (
          <span
            className={`armband absolute -right-1 -top-1 h-4 w-4 text-[9px] ${
              row.isArmband ? "armband-captain" : "armband-vice"
            }`}
          >
            {row.isArmband ? "C" : "V"}
          </span>
        )}
        {(row.subbedIn || row.subbedOut) && (
          <span
            className={`absolute -left-1 -top-1 grid h-4 w-4 place-items-center rounded-full border border-[var(--bg-0)] text-[8px] font-bold ${
              row.subbedIn ? "bg-[var(--accent)] text-black" : "bg-[var(--danger)] text-black"
            }`}
            title={row.subbedIn ? "auto-subbed in" : "auto-subbed out"}
            aria-hidden
          >
            {row.subbedIn ? "▲" : "▼"}
          </span>
        )}
      </div>
      <span className="max-w-[4.2rem] truncate text-[11px] font-semibold text-ink [text-shadow:0_1px_3px_rgba(0,0,0,0.85)]">
        {row.webName}
      </span>
      <span
        className={`font-mono text-[10px] leading-tight [text-shadow:0_1px_3px_rgba(0,0,0,0.85)] ${
          t === "live" ? "font-bold text-[var(--accent)]" : t === "done" ? "text-ink-soft" : "text-ink-faint"
        }`}
      >
        {shortStatus(row)}
      </span>
      {t === "pending" && opp && (
        <span className="flex items-center gap-0.5 text-[9px] text-ink-soft [text-shadow:0_1px_3px_rgba(0,0,0,0.85)]">
          {row.fdrRating != null && (
            <span className="h-1 w-1 rounded-full" style={{ background: fdrColor(row.fdrRating) }} />
          )}
          {opp.home ? "v" : "@"}
          {opp.team}
        </span>
      )}
    </button>
  );
}

export default function LivePitch({ rows, gameweek }: { rows: TrackerRow[]; gameweek: number }) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const openSheet = useCallback((id: number, trigger: HTMLButtonElement) => {
    triggerRef.current = trigger;
    setSelectedId(id);
  }, []);
  const closeSheet = useCallback(() => {
    setSelectedId(null);
    triggerRef.current?.focus();
  }, []);

  // The eleven who count now: starters who weren't auto-subbed out, plus any
  // bench player who came on for one. Everyone else sits on the bench strip.
  const onPitch = rows.filter((r) => (!r.isBench && !r.subbedOut) || r.subbedIn);
  const benched = rows.filter((r) => !onPitch.includes(r));
  const lines = ROWS.map((pos) => onPitch.filter((r) => r.position === pos)).filter((l) => l.length);
  const toPlay = onPitch.filter((r) => r.status === "notStarted" || r.status === "playing").length;
  const selected = selectedId != null ? rows.find((r) => r.id === selectedId) : undefined;

  return (
    <div>
      <div className="floodlit-pitch relative overflow-hidden rounded-2xl px-1 py-6">
        <FieldMarkings line="rgba(255,255,255,0.22)" />
        <div className="relative z-10 space-y-5">
          {lines.map((line, i) => (
            <div key={i} className="flex flex-wrap justify-center gap-x-2 gap-y-3">
              {line.map((r) => (
                <Token key={r.id} row={r} onSelect={openSheet} />
              ))}
            </div>
          ))}
        </div>
      </div>

      <p className="mt-2 text-[10.5px] leading-snug text-ink-faint">
        <span className="font-semibold text-[var(--accent)]">Glowing</span> = playing now · dashed = yet to
        start · {toPlay} of 11 still to play · tap a player for the points breakdown · times in SGT
      </p>

      {benched.length > 0 && (
        <div className="mt-3">
          <p className="eyebrow mb-1.5">Bench</p>
          <div className="flex flex-wrap gap-x-2 gap-y-2">
            {benched.map((r) => (
              <Token key={r.id} row={r} bench onSelect={openSheet} />
            ))}
          </div>
        </div>
      )}

      {selected && <LivePlayerSheet row={selected} gameweek={gameweek} onClose={closeSheet} />}
    </div>
  );
}
