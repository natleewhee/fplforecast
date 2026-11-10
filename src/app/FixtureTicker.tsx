"use client";

import { useRef, useState } from "react";
import type { Forecast } from "@/lib/snapshots";
import { buildTicker, type TickerCell, type TickerRow } from "@/lib/fixtureTicker";
import { lineupFor, resolveSwaps, type PendingSwap } from "@/lib/squadView";
import { fdrColor } from "@/lib/teamColors";
import PlayerBreakdownSheet from "./PlayerBreakdownSheet";
import { POSITION_DOT } from "./tokenParts";

const COLS = "grid-cols-[4.5rem_repeat(5,minmax(0,1fr))]";

function legText(l: { team: string | null; wasHome: boolean }) {
  return `${l.team ?? "?"} ${l.wasHome ? "H" : "A"}`;
}
function legLabel(l: { team: string | null; wasHome: boolean; fdrRating: number | null }) {
  return `${l.team ?? "unknown"} ${l.wasHome ? "home" : "away"}${l.fdrRating != null ? `, difficulty ${l.fdrRating} of 5` : ""}`;
}

/** The difficulty colour is a bar beside the text, never the only signal: the opponent is always written. */
function Cell({ cell, gw }: { cell: TickerCell; gw: number }) {
  if (cell.kind === "blank") {
    return (
      <span className="block text-center text-[10px] text-ink-faint" aria-label={`GW${gw}: no fixture`} data-cell="blank">
        &ndash;
      </span>
    );
  }
  const legs = cell.kind === "single" ? [cell.leg] : cell.legs;
  return (
    <span
      className="flex min-w-0 flex-col gap-px"
      data-cell={cell.kind}
      aria-label={`GW${gw}: ${legs.map(legLabel).join(" and ")}`}
    >
      {legs.map((l, i) => (
        <span
          key={i}
          className={`truncate border-l-[3px] pl-1 font-mono leading-tight text-ink-soft ${legs.length > 1 ? "text-[8px]" : "text-[9.5px]"}`}
          style={{ borderLeftColor: fdrColor(l.fdrRating) }}
        >
          {legText(l)}
        </span>
      ))}
    </span>
  );
}

function RowLabel({ row }: { row: TickerRow }) {
  return (
    <span className="flex min-w-0 items-center gap-1">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: POSITION_DOT[row.position] }} aria-hidden />
      <span className="truncate text-[11px] text-ink">{row.webName}</span>
    </span>
  );
}

/** Your fifteen against the next five gameweeks. Collapsed by default: the Squad tab is already long and the
 * pitch is the first thing wanted; the summary line still says if any blank or double gameweek is coming. */
export default function FixtureTicker({
  forecast,
  liveSquad,
  pending,
  pool,
}: {
  forecast: Forecast;
  liveSquad?: { id: number; position: string }[] | null;
  pending?: PendingSwap[];
  pool?: Forecast["pool"];
}) {
  const [openId, setOpenId] = useState<number | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const resolved = resolveSwaps(forecast, liveSquad, pending, pool);
  const { swaps } = resolved;
  const { gameweeks, rows } = buildTicker(forecast, swaps, 5, lineupFor(forecast, resolved));
  if (rows.length === 0) return null;
  const doubles = rows.reduce((n, r) => n + r.cells.filter((c) => c.kind === "double").length, 0);
  const blanks = rows.reduce((n, r) => n + r.cells.filter((c) => c.kind === "blank").length, 0);
  const note = [doubles && `${doubles} double`, blanks && `${blanks} blank`].filter(Boolean).join(", ");
  const opened = rows.find((r) => r.id === openId && !r.swappedIn);
  const sheetPlayer = opened ? forecast.squad.players.find((p) => p.id === opened.id) : undefined;
  const target = forecast.upcoming[0];

  return (
    <details className="panel group p-3" data-testid="fixture-ticker">
      <summary className="-my-3 flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block text-[10px] text-ink-faint transition-transform group-open:rotate-90 motion-reduce:transition-none">&#9656;</span>
          <span className="eyebrow">Fixtures &middot; next {gameweeks.length} GW</span>
        </span>
        <span className="text-[10px] text-ink-faint">{note || "no blanks or doubles"}</span>
      </summary>
      <div className="mt-2" role="table" aria-label="Your squad's next fixtures">
        <div className={`grid ${COLS} gap-x-1 pb-1`} role="row">
          <span role="columnheader"><span className="sr-only">Player</span></span>
          {gameweeks.map((g) => (
            <span key={g} role="columnheader" className="text-center font-mono text-[9px] font-bold tracking-wide text-ink-faint">
              GW{g}
            </span>
          ))}
        </div>
        {rows.map((r, i) => (
          <div key={r.id}>
            {(i === 0 || rows[i - 1].group !== r.group) && (
              <div className="eyebrow mb-0.5 mt-1.5 text-[9px]">{r.group === "starter" ? "Starters" : "Subs"}</div>
            )}
            <div
              className={`grid ${COLS} items-center gap-x-1 border-t border-line py-0.5`}
              role="row"
              data-row={r.group}
            >
              {r.swappedIn ? (
                <span role="rowheader"><RowLabel row={r} /></span>
              ) : (
                <span role="rowheader" className="min-w-0">
                  <button
                    type="button"
                    className="flex min-h-11 w-full min-w-0 items-center text-left"
                    onClick={(e) => {
                      triggerRef.current = e.currentTarget;
                      setOpenId(r.id);
                    }}
                    aria-label={`${r.webName}, show breakdown`}
                  >
                    <RowLabel row={r} />
                  </button>
                </span>
              )}
              {r.cells.map((c, j) => (
                <span key={j} role="cell" className="min-w-0"><Cell cell={c} gw={gameweeks[j]} /></span>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[10px] leading-snug text-ink-faint">
        H home, A away. The bar beside each opponent is FPL&rsquo;s difficulty, green easy to red hard.
        {swaps.size > 0 && " Transferred players are shown in the place of the player they replace."}
      </p>
      {opened && sheetPlayer && target && (
        <PlayerBreakdownSheet
          player={sheetPlayer}
          xp={target.players.find((p) => p.id === opened.id)?.projectedPoints ?? null}
          opponents={target.players.find((p) => p.id === opened.id)?.opponents ?? []}
          gameweek={target.gameweek}
          isTargetGw
          onClose={() => {
            setOpenId(null);
            triggerRef.current?.focus();
          }}
        />
      )}
    </details>
  );
}
