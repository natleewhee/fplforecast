"use client";

import { useCallback, useEffect, useState } from "react";
import type { LeaguePayload } from "./api/league/route";

const POLL_MS = 60_000;

export default function LeagueTable() {
  const [data, setData] = useState<LeaguePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const tick = useCallback(async () => {
    try {
      const res = await fetch("/api/league", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setData(json as LeaguePayload);
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

  if (loading) return null;
  if (error) {
    return (
      <div className="panel p-3 text-xs text-[var(--danger)]">
        League table unavailable: {error}
      </div>
    );
  }
  if (!data) return null;

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <h2 className="eyebrow">{data.leagueName}</h2>
        <span className="text-[11px] text-ink-faint">GW{data.gameweek}</span>
      </div>
      <div className="panel !p-0 overflow-x-auto">
        <table className="w-full min-w-[480px] text-sm">
          <thead>
            <tr className="border-b border-line text-left eyebrow">
              <th className="px-3 py-2 font-bold">Rank</th>
              <th className="px-3 py-2 font-bold">Manager</th>
              <th className="px-3 py-2 text-right font-bold">Total</th>
              <th className="px-3 py-2 text-right font-bold">GW pts</th>
              <th className="px-3 py-2 text-right font-bold">Live xP</th>
            </tr>
          </thead>
          <tbody>
            {data.entries.map((e) => {
              const moved = e.lastRank - e.rank;
              return (
                <tr key={e.entryId} className="border-b border-line last:border-0 hover:bg-white/[0.03]">
                  <td className="px-3 py-2">
                    <span className="font-mono tabular-nums">{e.rank}</span>
                    {moved !== 0 && (
                      <span
                        className={`ml-1 font-mono text-[10px] ${moved > 0 ? "text-[var(--accent)]" : "text-[var(--danger)]"}`}
                      >
                        {moved > 0 ? "▲" : "▼"}
                        {Math.abs(moved)}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium text-ink">{e.entryName}</div>
                    <div className="text-[11px] text-ink-faint">{e.playerName}</div>
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-ink-soft">
                    {e.totalPoints}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-ink-soft">
                    {e.eventPoints}
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums text-[var(--accent)]">
                    {e.projectedXp != null ? e.projectedXp.toFixed(1) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="px-1 text-[11px] text-ink-faint">
        Live xP is this app&rsquo;s own projection (actual points so far + decayed expected points
        for the rest of the gameweek), not FPL&rsquo;s -- it can read slightly off for an entry
        playing a chip this gameweek.
      </p>
    </section>
  );
}
