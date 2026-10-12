"use client";

import { useCallback, useRef, useState } from "react";
import type { TrackerRow } from "@/lib/liveBlend";
import { fdrColor } from "@/lib/teamColors";
import { eventCounts, parseOpponent, sgKickoff } from "@/lib/liveLabels";
import { PitchScene, type PitchMood } from "./PitchScene";
import { Halo } from "./Shirt";
import { FaceToggle, PlayerFace } from "./PlayerFace";
import { LiveFeed, NextUp } from "./LiveUpdates";
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

function eventBadgeItems(row: TrackerRow) {
  const c = eventCounts(row.breakdown);
  const chips: { key: string; node: React.ReactNode; title: string }[] = [];
  if (c.goals) chips.push({ key: "g", title: `${c.goals} goal${c.goals > 1 ? "s" : ""}`, node: <>&#9917;{c.goals > 1 ? c.goals : ""}</> });
  if (c.assists) chips.push({ key: "a", title: `${c.assists} assist${c.assists > 1 ? "s" : ""}`, node: <>{"\u{1F45F}".repeat(Math.min(c.assists, 4))}</> });
  if (c.cleanSheet) chips.push({ key: "cs", title: "clean sheet", node: <>{"\u{1F6E1}\uFE0F"}</> });
  if (c.defcon) chips.push({ key: "dc", title: "defensive contribution", node: <>{"\u{1F9F1}"}</> });
  if (c.penSaved) chips.push({ key: "ps", title: "penalty saved", node: <span className="font-black text-[var(--accent)]">PS</span> });
  if (c.yellow) chips.push({ key: "y", title: "yellow card", node: <span className="inline-block h-2.5 w-2 rounded-[1px] bg-[#facc15]" /> });
  if (c.red) chips.push({ key: "r", title: "red card", node: <span className="inline-block h-2.5 w-2 rounded-[1px] bg-[#ef4444]" /> });
  if (c.penMissed) chips.push({ key: "pm", title: "penalty missed", node: <span className="font-black text-[var(--danger)]">PM</span> });
  if (c.ownGoals) chips.push({ key: "og", title: "own goal", node: <span className="font-black text-[var(--danger)]">OG</span> });
  if (row.bonusPending) chips.push({ key: "bonus", title: "bonus points not added yet", node: <span className="text-[var(--warn)]">{"\u2605"}</span> });
  return chips.slice(0, 5);
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
  const pts = row.pointsSoFar;
  const haul = t !== "pending" && pts >= HAUL;
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
      data-flip={row.id}
      className={`flex min-w-0 max-w-[4.4rem] flex-1 basis-0 flex-col items-center gap-0.5 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${
        bench ? "sm:max-w-[4.2rem]" : "sm:max-w-20"
      }`}
    >
      <div className="relative" style={{ width: w, height: Math.round((w * 52) / 56) }}>
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
        {t === "pending" && !heat && <Halo fdr={row.fdrRating} width={w} />}
        <PlayerFace
          team={row.team}
          position={row.position}
          code={row.code}
          width={w}
          label={t === "pending" ? "\u2013" : pts.toFixed(0)}
          tone={t === "pending" ? "faint" : pts < 0 ? "danger" : "ink"}
          stroke={outline}
          dashed={t === "pending"}
          progress={t === "pending" || t === "dnp" ? null : frac}
          progressColor={accent}
          glow={glowing ? accent : null}
          dim={dim}
          badges={eventBadgeItems(row)}
          badgeClass={popped ? "fx-pop" : ""}
        />
        {(row.isArmband || row.isViceCaptain) && (
          <span
            key={row.isArmband ? "c" : "v"}
            className={`armband fx-pop absolute -right-1 -top-1 h-4 w-4 text-[9px] ${
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
        className={`mt-1 max-w-full truncate text-[11px] font-semibold text-ink [text-shadow:0_1px_3px_rgba(0,0,0,0.85)] ${
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
  const mood: PitchMood = onPitch.some((r) => r.status === "playing")
    ? "live"
    : onPitch.every((r) => r.status === "finished" || r.status === "offPitch" || r.status === "didNotPlay")
      ? "ft"
      : "pre";
  const moodText =
    mood === "live" ? "Floodlights on: your players are in play" : mood === "ft" ? "Full time for your eleven" : "Waiting for kickoff";

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] text-ink-soft" role="status">
          {moodText}
        </span>
        <div className="flex shrink-0 items-center gap-2">
          <FaceToggle />
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
      </div>
      <NextUp rows={onPitch} />
      <LiveFeed feed={fx.feed} showEmpty={mood !== "pre"} />
      <PitchScene mood={mood} flare={fx.goalFlare}>
        <div className="space-y-5">
          {lines.map((line, i) => (
            <div key={i} className="flex justify-center gap-x-1 gap-y-4">
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
      </PitchScene>

      <p className="mt-2 text-[10.5px] leading-snug text-ink-faint">
        The shirt outline fills with minutes played and glows while playing · dashed = yet to start ·{" "}
        {toPlay} of 11 still to play · ★ bonus not added yet · the bar under a name is points against the model&rsquo;s expected
        (white tick) · tap a player for the breakdown · times in SGT
      </p>

      {benched.length > 0 && (
        <div className="mt-3">
          <p className="eyebrow mb-1.5">Bench</p>
          <div className="flex gap-x-1 gap-y-3">
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
