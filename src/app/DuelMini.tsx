"use client";

import { useEffect, useState } from "react";
import { goToTab, loadSquad, readRival } from "@/lib/duelClient";
import { oddsLine, sideFrom, simulateDuel } from "@/lib/winOdds";

/** A one-line view of your last duel on the Live tab: the score between you
 * and your mate, and your odds. Tap to open the full duel on the Leagues tab.
 * Refreshes whenever the live tab does. */
export default function DuelMini({ refreshKey }: { refreshKey: string | null }) {
  const [rival] = useState(() => readRival());
  const [line, setLine] = useState<{ mine: number; theirs: number; odds: string } | null>(null);

  useEffect(() => {
    if (!rival) return;
    let cancelled = false;
    (async () => {
      try {
        const [me, them] = await Promise.all([loadSquad(rival.myEntryId), loadSquad(rival.entryId)]);
        if (cancelled) return;
        const a = sideFrom(me);
        const b = sideFrom(them);
        const odds = simulateDuel(a, b, 3000, me.totalPoints * 1000 + them.totalPoints);
        setLine({ mine: a.banked, theirs: b.banked, odds: oddsLine(odds, rival.name) });
      } catch {
        // a shortcut is a nicety: stay quiet if it can't load
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rival, refreshKey]);

  if (!rival || !line) return null;
  return (
    <button
      type="button"
      onClick={() => goToTab("leagues")}
      data-testid="duel-mini"
      className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-line px-3 py-2 text-left text-xs hover:border-border-strong"
    >
      <span className="min-w-0">
        <span className="eyebrow">Duel · {rival.name}</span>
        <span className="mt-0.5 block truncate text-ink-soft">{line.odds}</span>
      </span>
      <span className="stat shrink-0 text-xl text-ink">
        <span className="text-[var(--accent)]">{line.mine}</span>
        <span className="px-1 text-ink-faint">–</span>
        {line.theirs}
      </span>
    </button>
  );
}
