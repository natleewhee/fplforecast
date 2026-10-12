"use client";

import type { TrackerRow } from "@/lib/liveBlend";
import { fdrColor } from "@/lib/teamColors";
import { parseOpponent, sgKickoff, statLabel, visibleBreakdown } from "@/lib/liveLabels";
import BottomSheet from "./BottomSheet";

export function statusText(row: TrackerRow): string {
  switch (row.status) {
    case "finished":
      return `Full time · ${row.minutes}'${row.bonusPending ? " · bonus not added yet" : ""}`;
    case "playing":
      return `Playing · ${row.minutes}'`;
    case "offPitch":
      return `Off the pitch · ${row.minutes}'`;
    case "didNotPlay":
      return "Did not play";
    case "notStarted":
      return `Kicks off ${sgKickoff(row.kickoffTime)} SGT`;
  }
}

/** A player's live points, line by line, from FPL's own scoring breakdown --
 * the detail the pitch token has no room for. */
export default function LivePlayerSheet({
  row,
  gameweek,
  onClose,
}: {
  row: TrackerRow;
  gameweek: number;
  onClose: () => void;
}) {
  const opp = parseOpponent(row.opponent);
  const lines = visibleBreakdown(row.breakdown);
  const stillToCome = row.status === "notStarted" || row.status === "playing";

  return (
    <BottomSheet label={`${row.webName} live points`} onClose={onClose}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow">
            {row.position} · GW{gameweek}
          </p>
          <h3 className="truncate text-lg font-semibold text-ink">{row.webName}</h3>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-soft">
            {opp ? (
              <>
                {row.fdrRating != null && (
                  <span className="h-2 w-2 rounded-full" style={{ background: fdrColor(row.fdrRating) }} />
                )}
                {opp.home ? "v" : "@"} {opp.team} ·{" "}
              </>
            ) : null}
            {statusText(row)}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <div className="stat stat-glow text-3xl leading-none">{row.pointsSoFar.toFixed(0)}</div>
          <div className="eyebrow mt-1">pts so far</div>
        </div>
      </div>

      {lines.length > 0 ? (
        <ul className="mt-4 divide-y divide-[var(--line)] text-sm">
          {lines.map((b) => (
            <li key={b.identifier} className="flex items-center justify-between py-1.5">
              <span className="text-ink-soft">{statLabel(b.identifier)}</span>
              {b.identifier === "minutes" ? (
                <span className="font-mono tabular-nums text-ink">
                  {b.value}&prime;
                  {b.points !== 0 && (
                    <span className="text-[var(--accent)]">
                      {" "}
                      +{b.points}
                    </span>
                  )}
                </span>
              ) : (
                <span
                  className={`font-mono tabular-nums ${b.points < 0 ? "text-[var(--danger)]" : "text-[var(--accent)]"}`}
                >
                  {b.identifier !== "bonus" && b.value > 0 && (
                    <span className="mr-2 text-ink-soft">&times;{b.value}</span>
                  )}
                  {b.points > 0 ? "+" : ""}
                  {b.points}
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-xs text-ink-faint">
          {row.status === "notStarted"
            ? "No points yet — the match hasn't kicked off."
            : "No scoring events yet."}
        </p>
      )}

      <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-line pt-3 text-[11px]">
        {row.isArmband && (
          <>
            <dt className="text-ink-faint">Captain</dt>
            <dd className="text-right text-ink">points doubled (×2)</dd>
          </>
        )}
        {row.subbedIn && (
          <>
            <dt className="text-ink-faint">Substitution</dt>
            <dd className="text-right text-[var(--accent)]">auto-subbed in</dd>
          </>
        )}
        {row.subbedOut && (
          <>
            <dt className="text-ink-faint">Substitution</dt>
            <dd className="text-right text-[var(--danger)]">auto-subbed out (did not play)</dd>
          </>
        )}
        {stillToCome && (
          <>
            <dt className="text-ink-faint">Still to come</dt>
            <dd className="text-right font-mono text-[var(--accent)]">+{row.remainingXp.toFixed(1)} xP</dd>
          </>
        )}
        {row.noBakedXp && (
          <>
            <dt className="text-ink-faint">Projection</dt>
            <dd className="text-right text-ink-faint">no xP in the latest snapshot</dd>
          </>
        )}
      </dl>
    </BottomSheet>
  );
}
