"use client";

import { useCallback, useRef, useState } from "react";
import type { TrackerRow } from "@/lib/liveBlend";
import { fdrColor, kitFor } from "@/lib/teamColors";
import { eventCounts, parseOpponent, sgKickoff } from "@/lib/liveLabels";
import { FieldMarkings } from "./Pitch";
import LivePlayerSheet, { statusText } from "./LivePlayerSheet";
import { useLiveFx, type Float } from "./useLiveFx";

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

const SHIRT_PATH =
  "M18 4 L8 9 L1 21 L10 27 L14 22 L14 48 Q28 52 42 48 L42 22 L46 27 L55 21 L48 9 L38 4 Q28 11 18 4 Z";

/** Keepers play in their own colour so the line reads at a glance. */
const GK_KIT = { primary: "#f4b740", ink: "#1a1204" };

function EventBadges({ row, popped }: { row: TrackerRow; popped: boolean }) {
  const c = eventCounts(row.breakdown);
  const chips: { key: string; node: React.ReactNode; title: string }[] = [];
  if (c.goals) chips.push({ key: "g", title: `${c.goals} goal${c.goals > 1 ? "s" : ""}`, node: <>&#9917;{c.goals > 1 ? c.goals : ""}</> });
  if (c.assists) chips.push({ key: "a", title: `${c.assists} assist${c.assists > 1 ? "s" : ""}`, node: <span className="font-black text-[var(--accent-2)]">A{c.assists > 1 ? c.assists : ""}</span> });
  if (c.penSaved) chips.push({ key: "ps", title: "penalty saved", node: <span className="font-black text-[var(--accent)]">PS</span> });
  if (c.yellow) chips.push({ key: "y", title: "yellow card", node: <span className="inline-block h-2.5 w-2 rounded-[1px] bg-[#facc15]" /> });
  if (c.red) chips.push({ key: "r", title: "red card", node: <span className="inline-block h-2.5 w-2 rounded-[1px] bg-[#ef4444]" /> });
  if (c.penMissed) chips.push({ key: "pm", title: "penalty missed", node: <span className="font-black text-[var(--danger)]">PM</span> });
  if (c.ownGoals) chips.push({ key: "og", title: "own goal", node: <span className="font-black text-[var(--danger)]">OG</span> });
  if (!chips.length) return null;
  const shown = chips.slice(0, 4);
  return (
    <span
      aria-hidden
      className={`absolute -bottom-1.5 left-1/2 flex -translate-x-1/2 items-center gap-px rounded-full border border-white/15 bg-[rgba(6,9,15,0.9)] px-1 py-px text-[9px] leading-none text-ink ${popped ? "fx-pop" : ""}`}
    >
      {shown.map((ch) => (
        <span key={ch.key} title={ch.title} className="flex items-center">
          {ch.node}
        </span>
      ))}
    </span>
  );
}

/** Points scored against the model's pre-match xP: the fill is points, the tick
 * is the xP. Past the tick = beating expectations. */
function XpBar({ pts, xp, final }: { pts: number; xp: number; final: boolean }) {
  const scale = Math.max(xp, pts, 2) * 1.1;
  const fill = Math.max(0, Math.min(1, pts / scale));
  const tick = Math.min(1, xp / scale);
  const ahead = pts >= xp;
  return (
    <span aria-hidden className="relative mt-0.5 block h-[3px] w-11 rounded-full bg-white/15">
      <span
        className="absolute inset-y-0 left-0 rounded-full"
        style={{
          width: `${fill * 100}%`,
          background: ahead ? "var(--accent-2)" : final ? "var(--danger)" : "var(--accent)",
        }}
      />
      <span className="absolute -top-px h-[5px] w-px bg-white" style={{ left: `${tick * 100}%` }} />
    </span>
  );
}

function Token({
  row,
  bench = false,
  heat,
  share,
  popped,
  floats,
  onSelect,
}: {
  row: TrackerRow;
  bench?: boolean;
  heat: boolean;
  share: number;
  popped: boolean;
  floats: Float[];
  onSelect: (id: number, trigger: HTMLButtonElement) => void;
}) {
  const t = tone(row);
  const w = bench ? 42 : 56;
  const h = Math.round((w * 52) / 56);
  const pts = row.pointsSoFar;
  const haul = t !== "pending" && pts >= HAUL;
  const kit = row.position === "GKP" ? GK_KIT : kitFor(row.team);
  const accent = haul ? "var(--accent-2)" : "var(--accent)";
  const outline = t === "pending" || t === "dnp" ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.55)";
  const frac = Math.max(0, Math.min(1, row.minutes / 90));
  const glowing = t === "live" || (haul && t === "done");
  const opp = parseOpponent(row.opponent);
  const label = `${row.webName}, ${row.position}, ${t === "pending" ? "no points yet" : `${pts.toFixed(0)} points`}, ${statusText(row)}${
    row.isArmband ? ", captain" : row.isViceCaptain ? ", vice captain" : ""
  }${t === "pending" ? "" : `, expected ${row.expectedXp.toFixed(1)}`}`;
  const myFloats = floats.filter((f) => f.id === row.id);
  const dim = t === "dnp" ? 0.5 : t === "off" ? 0.62 : t === "pending" ? 0.72 : 1;

  return (
    <button
      type="button"
      onClick={(e) => onSelect(row.id, e.currentTarget)}
      aria-label={label}
      className={`flex w-[4.4rem] flex-col items-center gap-0.5 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${
        bench ? "sm:w-[4.2rem]" : "sm:w-20"
      }`}
    >
      <div className="relative" style={{ width: w, height: h }}>
        {heat && (
          <span
            aria-hidden
            className="absolute left-1/2 top-1/2 rounded-full"
            style={{
              width: w * 1.9,
              height: w * 1.9,
              transform: "translate(-50%,-50%)",
              background: `radial-gradient(circle, ${share >= 0.2 ? "rgba(56,189,248,0.8)" : "rgba(53,224,161,0.7)"} 0%, transparent 68%)`,
              opacity: Math.max(0.25, Math.min(1, share / 0.2)),
            }}
          />
        )}
        {myFloats.map((f) => (
          <span
            key={f.key}
            aria-hidden
            className="fx-float font-mono text-sm"
            style={{ color: f.delta > 0 ? "var(--accent)" : "var(--danger)" }}
          >
            {f.delta > 0 ? "+" : "\u2212"}
            {Math.abs(f.delta).toFixed(0)}
          </span>
        ))}
        <svg
          viewBox="0 0 56 52"
          width={w}
          height={h}
          className={`relative overflow-visible ${glowing ? "live-glow-shirt" : ""}`}
          style={{
            opacity: dim,
            ["--glow" as string]: haul ? "var(--accent-2)" : "var(--accent)",
            filter: glowing ? undefined : "drop-shadow(0 2px 4px rgba(0,0,0,0.55))",
          }}
          aria-hidden
        >
          <path d={SHIRT_PATH} fill={kit.primary} />
          <path d="M20 4.6 Q28 13 36 4.6" fill="none" stroke={kit.ink} strokeOpacity="0.45" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M14 22 V48 M42 22 V48" stroke="rgba(0,0,0,0.22)" strokeWidth="1" />
          {/* minutes played, drawn as the shirt's outline filling up */}
          <path
            d={SHIRT_PATH}
            fill="none"
            stroke={outline}
            strokeWidth="1.8"
            strokeLinejoin="round"
            strokeDasharray={t === "pending" ? "3 2.5" : undefined}
          />
          {t !== "pending" && t !== "dnp" && (
            <path
              d={SHIRT_PATH}
              pathLength={100}
              fill="none"
              stroke={accent}
              strokeWidth="3"
              strokeLinejoin="round"
              strokeLinecap="round"
              strokeDasharray={`${frac * 100} 100`}
            />
          )}
          <rect x="17" y="21" width="22" height="14" rx="4" fill="rgba(6,9,15,0.84)" />
          <text
            x="28"
            y="31.6"
            textAnchor="middle"
            fontFamily="ui-monospace, monospace"
            fontWeight="800"
            fontSize={t === "pending" ? 11 : 12}
            fill={t === "pending" ? "#7482a0" : pts < 0 ? "#fb7185" : "#eef2f8"}
          >
            {t === "pending" ? "\u2013" : pts.toFixed(0)}
          </text>
        </svg>
        <EventBadges row={row} popped={popped} />
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
            {row.subbedIn ? "\u25B2" : "\u25BC"}
          </span>
        )}
      </div>
      <span
        className={`mt-1 max-w-[4.2rem] truncate text-[11px] font-semibold text-ink [text-shadow:0_1px_3px_rgba(0,0,0,0.85)] ${
          t === "dnp" ? "opacity-60" : ""
        }`}
      >
        {row.webName}
      </span>
      <span
        className={`font-mono text-[10px] leading-tight [text-shadow:0_1px_3px_rgba(0,0,0,0.85)] ${
          heat
            ? "font-bold text-[var(--accent-2)]"
            : t === "live"
              ? "font-bold text-[var(--accent)]"
              : t === "done"
                ? "text-ink-soft"
                : "text-ink-faint"
        }`}
      >
        {heat ? `${Math.round(share * 100)}%` : shortStatus(row)}
      </span>
      {t !== "pending" && t !== "dnp" && <XpBar pts={pts} xp={row.expectedXp} final={t === "done" || t === "off"} />}
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
  const [heat, setHeat] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const fx = useLiveFx(rows);
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

  // Where the gameweek total is coming from (captain doubling included).
  const totalContribution = onPitch.reduce((sum, r) => sum + Math.max(0, r.contribution), 0);
  const shareOf = (r: TrackerRow) => (totalContribution > 0 ? Math.max(0, r.contribution) / totalContribution : 0);

  // Lights up while any of your eleven is playing, dims once they are all done.
  const mood = onPitch.some((r) => r.status === "playing")
    ? "mood-live"
    : onPitch.every((r) => r.status === "finished" || r.status === "offPitch" || r.status === "didNotPlay")
      ? "mood-ft"
      : "mood-pre";
  const moodText =
    mood === "mood-live" ? "Floodlights on: your players are in play" : mood === "mood-ft" ? "Full time for your eleven" : "Waiting for kickoff";

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[11px] text-ink-soft" role="status">
          {moodText}
        </span>
        <button
          type="button"
          aria-pressed={heat}
          onClick={() => setHeat((h) => !h)}
          className={`inline-flex h-8 items-center rounded-full border px-3 text-[11px] font-semibold transition-colors ${
            heat
              ? "border-[var(--accent-2)] bg-[color-mix(in_srgb,var(--accent-2)_16%,transparent)] text-[var(--accent-2)]"
              : "border-line text-ink-soft hover:border-border-strong"
          }`}
        >
          Heat map
        </button>
      </div>
      <div className={`floodlit-pitch relative overflow-hidden rounded-2xl px-1 pb-6 pt-12 ${mood}`}>
        <FieldMarkings line="rgba(255,255,255,0.22)" />
        <div className="stand" aria-hidden />
        <div className="beam beam-l" aria-hidden />
        <div className="beam beam-r" aria-hidden />
        {fx.goalFlare > 0 && <div key={fx.goalFlare} className="goal-flare" aria-hidden />}
        <div className="relative z-10 space-y-5">
          {lines.map((line, i) => (
            <div key={i} className="flex flex-wrap justify-center gap-x-2 gap-y-4">
              {line.map((r) => (
                <Token
                  key={r.id}
                  row={r}
                  heat={heat}
                  share={shareOf(r)}
                  popped={fx.popped.has(r.id)}
                  floats={fx.floats}
                  onSelect={openSheet}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      <p className="mt-2 text-[10.5px] leading-snug text-ink-faint">
        The shirt outline fills with minutes played and glows while playing · dashed = yet to start ·{" "}
        {toPlay} of 11 still to play · the bar under a name is points against the model&rsquo;s expected
        (white tick) · tap a player for the breakdown · times in SGT
      </p>

      {benched.length > 0 && (
        <div className="mt-3">
          <p className="eyebrow mb-1.5">Bench</p>
          <div className="flex flex-wrap gap-x-2 gap-y-3">
            {benched.map((r) => (
              <Token
                key={r.id}
                row={r}
                bench
                heat={false}
                share={0}
                popped={fx.popped.has(r.id)}
                floats={fx.floats}
                onSelect={openSheet}
              />
            ))}
          </div>
        </div>
      )}

      {selected && <LivePlayerSheet row={selected} gameweek={gameweek} onClose={closeSheet} />}
    </div>
  );
}
