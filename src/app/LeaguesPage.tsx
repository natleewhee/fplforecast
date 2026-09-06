"use client";

import { useCallback, useEffect, useState } from "react";
import type { LeaguePayload, LeaguesResponse } from "./api/league/route";

const POLL_MS = 60_000;

function LeagueSection({ league, gameweek }: { league: LeaguePayload; gameweek: number }) {
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <h2 className="eyebrow">{league.leagueName}</h2>
        <span className="text-[11px] text-ink-faint">GW{gameweek}</span>
      </div>
      {/* Fixed height with its own scroll, not the page's -- a 20-manager
         league shouldn't push everything below it half a screen down.
         table-fixed + explicit column widths (no horizontal scroll) so all
         5 columns fit a 375px phone. */}
      <div className="panel !p-0 max-h-80 overflow-y-auto">
        <table className="w-full table-fixed text-xs sm:text-sm">
          <colgroup>
            <col className="w-[15%]" />
            <col className="w-[40%]" />
            <col className="w-[15%]" />
            <col className="w-[13%]" />
            <col className="w-[17%]" />
          </colgroup>
          <thead className="sticky top-0 bg-[var(--bg-0)]">
            <tr className="border-b border-line text-left eyebrow">
              <th className="px-1.5 py-2 font-bold sm:px-3">Rk</th>
              <th className="px-1.5 py-2 font-bold sm:px-3">Manager</th>
              <th className="px-1.5 py-2 text-right font-bold sm:px-3">Tot</th>
              <th className="px-1.5 py-2 text-right font-bold sm:px-3">GW</th>
              <th className="px-1.5 py-2 text-right font-bold sm:px-3">xP</th>
            </tr>
          </thead>
          <tbody>
            {league.entries.map((e) => {
              const moved = e.lastRank - e.rank;
              return (
                <tr key={e.entryId} className="border-b border-line last:border-0 hover:bg-white/[0.03]">
                  <td className="truncate px-1.5 py-2 sm:px-3">
                    <span className="font-mono tabular-nums">{e.rank}</span>
                    {moved !== 0 && (
                      <span
                        className={`ml-0.5 font-mono text-[9px] ${moved > 0 ? "text-[var(--accent)]" : "text-[var(--danger)]"}`}
                      >
                        {moved > 0 ? "▲" : "▼"}
                        {Math.abs(moved)}
                      </span>
                    )}
                  </td>
                  <td className="min-w-0 px-1.5 py-2 sm:px-3">
                    <div className="truncate font-medium text-ink">{e.entryName}</div>
                    <div className="truncate text-[10px] text-ink-faint">{e.playerName}</div>
                  </td>
                  <td className="truncate px-1.5 py-2 text-right font-mono tabular-nums text-ink-soft sm:px-3">
                    {e.totalPoints}
                  </td>
                  <td className="truncate px-1.5 py-2 text-right font-mono tabular-nums text-ink-soft sm:px-3">
                    {e.eventPoints}
                  </td>
                  <td className="truncate px-1.5 py-2 text-right font-mono font-semibold tabular-nums text-[var(--accent)] sm:px-3">
                    {e.projectedXp != null ? e.projectedXp.toFixed(1) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Every private mini-league the manager is in, each as its own standings
 * table with rank/points from FPL plus this app's live-xP projection.
 * System-wide leagues (Overall, country leagues) are excluded server-side --
 * they have too many entries for a per-entry-picks table to be meaningful. */
export default function LeaguesPage() {
  const [data, setData] = useState<LeaguesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const tick = useCallback(async () => {
    try {
      const res = await fetch("/api/league", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setData(json as LeaguesResponse);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(tick, 0);
    const id = setInterval(tick, POLL_MS);
    return () => {
      clearTimeout(t);
      clearInterval(id);
    };
  }, [tick]);

  if (loading) {
    return <div className="panel p-3 text-xs text-ink-faint">Loading your leagues…</div>;
  }
  if (error) {
    return (
      <div className="panel p-3 text-xs text-[var(--danger)]">Leagues unavailable: {error}</div>
    );
  }
  if (!data || data.leagues.length === 0) {
    return <div className="panel p-3 text-xs text-ink-faint">No private leagues found.</div>;
  }

  return (
    <div className="space-y-4">
      {data.leagues.map((league) => (
        <LeagueSection key={league.leagueId} league={league} gameweek={data.gameweek} />
      ))}
      <p className="px-1 text-[11px] text-ink-faint">
        Live xP is this app&rsquo;s own projection (actual points so far + decayed expected points
        for the rest of the gameweek), not FPL&rsquo;s -- it can read slightly off for an entry
        playing a chip this gameweek.
      </p>
    </div>
  );
}
