"use client";

import { PitchScene, type PitchMood } from "./PitchScene";
import { Shirt } from "./Shirt";
import type { LeagueSquadResponse, LeagueSquadRow } from "./api/league/squad/route";

const ROWS = ["GKP", "DEF", "MID", "FWD"] as const;
const POSITION_DOT: Record<string, string> = {
  GKP: "var(--gkp)",
  DEF: "var(--def)",
  MID: "var(--mid)",
  FWD: "var(--fwd)",
};

const STATUS_LABEL: Record<LeagueSquadRow["status"], string> = {
  notStarted: "to play",
  playing: "live",
  offPitch: "off (injury/red card)",
  finished: "played",
  didNotPlay: "did not play",
};

function PlayerToken({ row, bench = false }: { row: LeagueSquadRow; bench?: boolean }) {
  const w = bench ? 42 : 56;
  const showRemaining = row.status === "notStarted" || row.status === "playing";
  const pending = row.status === "notStarted";
  const title = [
    row.webName,
    STATUS_LABEL[row.status],
    row.minutes > 0 ? `${row.minutes}'` : null,
    row.subbedIn ? "subbed in" : row.subbedOut ? "subbed out" : null,
    row.noBakedXp ? "no xP baked for this player yet" : null,
  ]
    .filter(Boolean)
    .join(" — ");

  return (
    <div
      data-flip={row.id}
      className="flex min-w-0 max-w-[4.4rem] flex-1 basis-0 flex-col items-center gap-0.5 sm:max-w-20"
      title={title}
    >
      <div className="relative" style={{ width: w, height: Math.round((w * 52) / 56) }}>
        <Shirt
          team={row.team}
          position={row.position}
          width={w}
          label={pending ? "\u2013" : String(row.pointsSoFar)}
          tone={pending ? "faint" : row.pointsSoFar < 0 ? "danger" : "ink"}
          dashed={pending}
          progress={pending || row.status === "didNotPlay" ? null : row.minutes / 90}
          progressColor={row.status === "offPitch" ? "var(--warn)" : "var(--accent)"}
          glow={row.status === "playing" ? "var(--accent)" : null}
          dim={row.status === "didNotPlay" ? 0.5 : row.status === "offPitch" ? 0.62 : pending ? 0.72 : 1}
        />
        {row.isArmband && (
          <span className="armband armband-captain absolute -right-1 -top-1 h-4 w-4 text-[9px]">
            C
          </span>
        )}
        {!row.isArmband && row.isCaptain && (
          <span className="armband absolute -right-1 -top-1 h-4 w-4 text-[9px] opacity-50">C</span>
        )}
      </div>
      <span className="mt-1 flex max-w-full items-center gap-1">
        <span
          className="h-1 w-1 shrink-0 rounded-full"
          style={{ background: POSITION_DOT[row.position] ?? "var(--ink-soft)" }}
        />
        <span
          className={`min-w-0 truncate text-[11px] font-semibold [text-shadow:0_1px_3px_rgba(0,0,0,0.85)] ${
            row.subbedOut ? "text-ink-faint line-through" : "text-ink"
          }`}
        >
          {row.webName}
        </span>
        {row.subbedIn && <span className="chip chip-accent !py-0 text-[9px]">▲</span>}
      </span>
      {row.status === "playing" && (
        <span className="font-mono text-[10px] font-bold text-[var(--accent)]">{row.minutes}&prime;</span>
      )}
      {showRemaining && !row.noBakedXp && (
        <span className="font-mono text-[10px] tabular-nums text-[var(--accent)]">
          +{row.remainingXp.toFixed(1)}
        </span>
      )}
      <span className="text-[9px] text-ink-faint [text-shadow:0_1px_3px_rgba(0,0,0,0.85)]">
        {row.opponent ?? "\u2014 blank \u2014"}
      </span>
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
  const mood: PitchMood = starters.some((r) => r.status === "playing")
    ? "live"
    : starters.every((r) => r.status === "finished" || r.status === "offPitch" || r.status === "didNotPlay")
      ? "ft"
      : "pre";

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

      <PitchScene mood={mood}>
        <div className="space-y-5">
          {rows.map((row, i) => (
            <div key={i} className="flex justify-center gap-x-1 gap-y-4">
              {row.map((r) => (
                <PlayerToken key={r.id} row={r} />
              ))}
            </div>
          ))}
        </div>
      </PitchScene>
      <p className="mt-2 text-[10.5px] leading-snug text-ink-faint">
        Number = points so far · the shirt outline fills with minutes played and glows while playing ·
        dashed = yet to start · green figure = expected points still to come
      </p>

      <div className="mt-3">
        <p className="eyebrow mb-1.5">Bench</p>
        <div className="flex gap-x-1 gap-y-3">
          {bench.map((r) => (
            <PlayerToken key={r.id} row={r} bench />
          ))}
        </div>
      </div>
    </div>
  );
}
