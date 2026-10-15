"use client";

import { useEffect, useMemo, useState } from "react";
import LiveSquadPitch from "./LiveSquadPitch";
import type { LeagueSquadResponse } from "./api/league/squad/route";
import { loadSquad } from "@/lib/duelClient";
import { differentials, oddsLine, sideFrom, simulateDuel } from "@/lib/winOdds";

const POLL_MS = 60_000;

function OddsMeter({ win, draw, lose }: { win: number; draw: number; lose: number }) {
  return (
    <div
      role="img"
      aria-label={`Win ${Math.round(win * 100)}%, draw ${Math.round(draw * 100)}%, lose ${Math.round(lose * 100)}%`}
      className="flex h-3 overflow-hidden rounded-full bg-white/[0.06]"
    >
      <div className="bg-[var(--accent)] transition-[width] duration-700" style={{ width: `${win * 100}%` }} />
      <div className="bg-white/30" style={{ width: `${draw * 100}%` }} />
      <div className="bg-[var(--danger)] transition-[width] duration-700" style={{ width: `${lose * 100}%` }} />
    </div>
  );
}

/** Head-to-head against one mini-league mate: live score, projected finish,
 * simulated win odds, and the players only one of you owns. */
export default function DuelCard({
  myEntryId,
  rivalId,
  rivalName,
  teamId,
  onClose,
}: {
  myEntryId: number;
  rivalId: number;
  rivalName: string;
  teamId?: string | null;
  onClose: () => void;
}) {
  const [pair, setPair] = useState<{ me: LeagueSquadResponse; rival: LeagueSquadResponse } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const [me, rival] = await Promise.all([loadSquad(myEntryId, teamId), loadSquad(rivalId, teamId)]);
        if (!cancelled) {
          setPair({ me, rival });
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    };
    const t = setTimeout(tick, 0);
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(t);
      clearInterval(id);
    };
  }, [myEntryId, rivalId, teamId]);

  const calc = useMemo(() => {
    if (!pair) return null;
    const a = sideFrom(pair.me);
    const b = sideFrom(pair.rival);
    return {
      odds: simulateDuel(a, b, 4000, pair.me.totalPoints * 1000 + pair.rival.totalPoints),
      diffs: differentials(pair.me, pair.rival),
      myNow: a.banked,
      theirNow: b.banked,
    };
  }, [pair]);

  const diffIds = useMemo(() => {
    if (!calc) return { me: new Set<number>(), rival: new Set<number>() };
    return {
      me: new Set(calc.diffs.onlyA.map((r) => r.id)),
      rival: new Set(calc.diffs.onlyB.map((r) => r.id)),
    };
  }, [calc]);

  return (
    <section className="space-y-3" data-testid="duel">
      <div className="panel rise space-y-3 p-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="eyebrow">⚔️ Duel · you vs {rivalName}</h3>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-11 shrink-0 items-center rounded-full border border-line px-3 text-[11px] text-ink-soft hover:border-border-strong"
          >
            End duel
          </button>
        </div>
        {error && <p className="text-xs text-[var(--danger)]">Couldn&rsquo;t load the duel: {error}</p>}
        {!error && !pair && <div className="h-16 animate-pulse rounded bg-white/[0.05]" />}
        {pair && calc && (
          <>
            <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2 text-center">
              <div>
                <div className="stat stat-glow text-3xl leading-none">{calc.myNow}</div>
                <div className="eyebrow mt-1">you · proj {calc.odds.meanA.toFixed(0)}</div>
              </div>
              <div className="pb-1 text-xs text-ink-faint">
                {calc.myNow === calc.theirNow
                  ? "level"
                  : `${Math.abs(calc.myNow - calc.theirNow)} ${calc.myNow > calc.theirNow ? "ahead" : "behind"}`}
              </div>
              <div>
                <div className="stat text-3xl leading-none text-ink">{calc.theirNow}</div>
                <div className="eyebrow mt-1 truncate">
                  {rivalName} · proj {calc.odds.meanB.toFixed(0)}
                </div>
              </div>
            </div>
            <div className="space-y-1">
              <OddsMeter win={calc.odds.win} draw={calc.odds.draw} lose={calc.odds.lose} />
              <p className="text-sm font-semibold text-ink" data-testid="duel-odds">
                {oddsLine(calc.odds, rivalName)}
              </p>
              <p className="text-[10.5px] leading-snug text-ink-faint">
                Simulated 4,000 times from points banked plus each player&rsquo;s remaining xP, with an
                assumed boom-or-bust spread. A guide, not a promise.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 border-t border-line pt-2 text-[11px]">
              <div>
                <p className="eyebrow mb-1">Only you own</p>
                {calc.diffs.onlyA.length ? (
                  calc.diffs.onlyA.map((r) => (
                    <p key={r.id} className="flex justify-between">
                      <span className="truncate">{r.webName}</span>
                      <span className="font-mono text-[var(--accent)]">{r.pointsSoFar}</span>
                    </p>
                  ))
                ) : (
                  <p className="text-ink-faint">Identical XI</p>
                )}
              </div>
              <div>
                <p className="eyebrow mb-1">Only {rivalName} owns</p>
                {calc.diffs.onlyB.length ? (
                  calc.diffs.onlyB.map((r) => (
                    <p key={r.id} className="flex justify-between">
                      <span className="truncate">{r.webName}</span>
                      <span className="font-mono text-ink-soft">{r.pointsSoFar}</span>
                    </p>
                  ))
                ) : (
                  <p className="text-ink-faint">Identical XI</p>
                )}
              </div>
            </div>
          </>
        )}
      </div>
      {pair && (
        <>
          <LiveSquadPitch data={pair.me} diffIds={diffIds.me} heading="your team · DIFF = only you own" />
          <LiveSquadPitch data={pair.rival} diffIds={diffIds.rival} heading={`${rivalName} · DIFF = only they own`} />
        </>
      )}
    </section>
  );
}
