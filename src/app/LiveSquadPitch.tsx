"use client";

import { FieldMarkings, ShirtGlyph } from "./Pitch";
import { kitFor } from "@/lib/teamColors";
import type { LeagueSquadResponse, LeagueSquadRow } from "./api/league/squad/route";

const ROWS = ["GKP", "DEF", "MID", "FWD"] as const;
const POSITION_DOT: Record<string, string> = {
  GKP: "var(--gkp)",
  DEF: "var(--def)",
  MID: "var(--mid)",
  FWD: "var(--fwd)",
};

// Status -> ring color + label, mirroring the played/live/toPlay split
// shown in the league table row itself, so the two stay legible together.
const STATUS_STYLE: Record<LeagueSquadRow["status"], { color: string; label: string }> = {
  notStarted: { color: "rgba(255,255,255,0.16)", label: "to play" },
  playing: { color: "var(--accent)", label: "live" },
  offPitch: { color: "var(--warn)", label: "off (injury/red card)" },
  finished: { color: "var(--ink-faint)", label: "played" },
  didNotPlay: { color: "var(--danger)", label: "did not play" },
};

function PlayerToken({ row, bench = false }: { row: LeagueSquadRow; bench?: boolean }) {
  const kit = kitFor(row.team);
  const size = bench ? 40 : 52;
  const style = STATUS_STYLE[row.status];
  const showRemaining = row.status === "notStarted" || row.status === "playing";
  const title = [
    row.webName,
    style.label,
    row.minutes > 0 ? `${row.minutes}'` : null,
    row.subbedIn ? "subbed in" : row.subbedOut ? "subbed out" : null,
    row.noBakedXp ? "no xP baked for this player yet" : null,
  ]
    .filter(Boolean)
    .join(" — ");

  return (
    <div
      className={`flex w-[4.4rem] flex-col items-center gap-0.5 ${bench ? "sm:w-[4.2rem]" : "sm:w-20"}`}
      title={title}
    >
      <div className="relative">
        <div
          className="grid place-items-center rounded-full"
          style={{
            width: size,
            height: size,
            boxShadow: `0 0 0 2px ${style.color}, 0 2px 10px -2px rgba(0,0,0,0.6)`,
          }}
        >
          <div
            className="relative grid h-full w-full place-items-center overflow-hidden rounded-full"
            style={{ background: kit.primary }}
          >
            <ShirtGlyph fill={kit.ink} />
            <span
              className="relative font-mono font-bold tabular-nums"
              style={{ color: kit.ink, fontSize: bench ? 11 : 13 }}
            >
              {row.pointsSoFar}
            </span>
          </div>
        </div>
        {row.isArmband && (
          <span className="armband armband-captain absolute -right-1 -top-1 h-4 w-4 text-[9px]">
            C
          </span>
        )}
        {!row.isArmband && row.isCaptain && (
          <span className="armband absolute -right-1 -top-1 h-4 w-4 text-[9px] opacity-50">C</span>
        )}
        {row.status === "playing" && (
          <span
            className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 animate-pulse rounded-full border border-[var(--bg-0)]"
            style={{ background: "var(--accent)" }}
            title="live"
          />
        )}
      </div>
      <span className="flex items-center gap-1">
        <span
          className="h-1 w-1 rounded-full"
          style={{ background: POSITION_DOT[row.position] ?? "var(--ink-soft)" }}
        />
        <span
          className={`max-w-[4.2rem] truncate text-[11px] font-semibold ${
            row.subbedOut ? "text-ink-faint line-through" : "text-ink"
          }`}
        >
          {row.webName}
        </span>
        {row.subbedIn && <span className="chip chip-accent !py-0 text-[9px]">▲</span>}
      </span>
      {showRemaining && !row.noBakedXp && (
        <span className="font-mono text-[10px] tabular-nums text-[var(--accent)]">
          +{row.remainingXp.toFixed(1)}
        </span>
      )}
      <span className="text-[9px] text-ink-faint">{row.opponent ?? "— blank —"}</span>
    </div>
  );
}

/** The read-only counterpart to Pitch.tsx for someone else's team: same
 * pitch/kit formation, but every player's own number is what actually
 * happened this gameweek (FPL's own live points, captain-doubled) plus
 * this app's decayed xP projection for the rest of the gameweek -- not
 * this app's *forecast model* pointed at their squad (that's for the
 * squad's own holder to plan transfers/captaincy with), just "where is
 * their current team, and where's it heading". */
export default function LiveSquadPitch({ data }: { data: LeagueSquadResponse }) {
  const starters = data.rows.filter((r) => !r.isBench);
  const bench = data.rows.filter((r) => r.isBench);
  const rows = ROWS.map((pos) => starters.filter((r) => r.position === pos)).filter((r) => r.length);

  return (
    <div className="panel rise overflow-hidden p-3 sm:p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-mono text-[13px] font-bold tracking-[0.12em] text-ink">
            LIVE · GW{data.gameweek}
          </h2>
          <p className="eyebrow mt-0.5">their actual team, not a forecast</p>
        </div>
        <div className="flex shrink-0 items-end gap-3 text-right">
          <div>
            <div className="stat stat-glow text-2xl leading-none sm:text-3xl">{data.totalPoints}</div>
            <div className="eyebrow mt-1">pts so far</div>
          </div>
          <div>
            <div className="stat text-xl leading-none text-[var(--accent)] sm:text-2xl">
              {data.totalXp.toFixed(1)}
            </div>
            <div className="eyebrow mt-1">proj total</div>
          </div>
        </div>
      </div>
      {data.chip && <span className="chip chip-accent mb-2 inline-block">{data.chip}</span>}

      <div
        className="relative rounded-2xl px-1 py-6"
        style={{ background: "linear-gradient(160deg,#0f5130,#0c3f26 45%,#0a3421)" }}
      >
        <FieldMarkings />
        <div className="relative z-10 space-y-5">
          {rows.map((row, i) => (
            <div key={i} className="flex flex-wrap justify-center gap-x-2 gap-y-3">
              {row.map((r) => (
                <PlayerToken key={r.id} row={r} />
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3">
        <p className="eyebrow mb-1.5">Bench</p>
        <div className="flex flex-wrap gap-x-2 gap-y-2">
          {bench.map((r) => (
            <PlayerToken key={r.id} row={r} bench />
          ))}
        </div>
      </div>
    </div>
  );
}
