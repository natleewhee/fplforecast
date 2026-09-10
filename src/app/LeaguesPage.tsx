"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { Dropdown } from "./Dropdown";
import type { LeagueEntryRow, LeaguesResponse } from "./api/league/route";

const POLL_MS = 60_000;
const STORAGE_KEY = "fplforecast:selectedLeagueId";

function LiveCell({ entry }: { entry: LeagueEntryRow }) {
  if (entry.playersPlayed == null || entry.playersLive == null || entry.playersToPlay == null) {
    return null;
  }
  return (
    <span className="whitespace-nowrap">
      <span className="text-ink-soft">{entry.playersPlayed}</span> played ·{" "}
      <span className="text-[var(--accent)]">{entry.playersLive}</span> live ·{" "}
      <span className="text-ink-faint">{entry.playersToPlay}</span> to play
    </span>
  );
}

function RankHeader({ league }: { league: NonNullable<LeaguesResponse["league"]> }) {
  const total = `${league.totalEntries}${league.totalEntriesIsFloor ? "+" : ""}`;
  const scrollToMe = () => {
    document.getElementById(`league-entry-${league.myEntryId}`)?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  };
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded bg-white/[0.03] px-2.5 py-2">
      <span className="text-xs text-ink-soft">
        Your rank: <span className="font-mono font-bold text-[var(--accent)]">#{league.myRank ?? "?"}</span>{" "}
        of {total}
      </span>
      {league.appendedEntryId != null && (
        <button
          type="button"
          onClick={scrollToMe}
          className="rounded bg-white/[0.06] px-2 py-1 text-[11px] font-medium text-ink-soft hover:bg-white/[0.1]"
        >
          Jump to my position ↓
        </button>
      )}
    </div>
  );
}

function LeagueTable({ league, gameweek }: { league: LeaguesResponse["league"]; gameweek: number }) {
  if (!league) {
    return <div className="panel p-3 text-xs text-ink-faint">No private leagues found.</div>;
  }
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <h2 className="eyebrow">{league.leagueName}</h2>
        <span className="text-[11px] text-ink-faint">GW{gameweek}</span>
      </div>
      <RankHeader league={league} />
      {/* Fixed height with its own scroll, not the page's -- a 20-manager
         league shouldn't push everything below it half a screen down.
         table-fixed + explicit column widths (no horizontal scroll) so the
         5 columns always fit a phone width -- captain/chip/live-play all
         fold into the Manager cell as extra lines rather than becoming
         their own columns, which is what pushed this past the viewport
         width before. */}
      <div className="panel !p-0 max-h-96 overflow-y-auto">
        <table className="w-full table-fixed text-xs sm:text-sm">
          <colgroup>
            <col className="w-[13%]" />
            <col className="w-[46%]" />
            <col className="w-[13%]" />
            <col className="w-[13%]" />
            <col className="w-[15%]" />
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
            {league.entries.map((e, i) => {
              const moved = e.lastRank - e.rank;
              const isMe = e.entryId === league.myEntryId;
              // Driven by the server's explicit `appendedEntryId`, not a gap
              // between consecutive ranks -- FPL gives tied entries the same
              // `rank`, so a rank-number gap isn't a reliable "was this
              // appended after the top 10" signal.
              const showDivider = i > 0 && e.entryId === league.appendedEntryId;
              return (
                <Fragment key={e.entryId}>
                  {showDivider && (
                    <tr key={`divider-${e.entryId}`} aria-hidden="true">
                      <td colSpan={5} className="px-1.5 py-1 text-center text-[10px] text-ink-faint sm:px-3">
                        ⋯
                      </td>
                    </tr>
                  )}
                  <tr
                    id={`league-entry-${e.entryId}`}
                    className={`border-b border-line last:border-0 hover:bg-white/[0.03] ${
                      isMe ? "bg-[var(--accent)]/[0.08]" : ""
                    }`}
                  >
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
                      <div className="flex items-center gap-1.5 truncate font-medium text-ink">
                        {e.entryName}
                        {isMe && (
                          <span className="rounded bg-[var(--accent)] px-1 py-0.5 text-[9px] font-bold text-[var(--bg-0)]">
                            YOU
                          </span>
                        )}
                        {e.chip && (
                          <span className="rounded bg-[var(--accent)]/15 px-1 py-0.5 text-[9px] font-bold text-[var(--accent)]">
                            {e.chip}
                          </span>
                        )}
                      </div>
                      <div className="truncate text-[10px] text-ink-faint">{e.playerName}</div>
                      {(e.captainName || e.playersLive != null) && (
                        <div className="truncate text-[10px] text-ink-faint">
                          {e.captainName && <>C: {e.captainName}</>}
                          {e.captainName && e.playersLive != null && " · "}
                          <LiveCell entry={e} />
                        </div>
                      )}
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
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** One private mini-league at a time -- picked from a dropdown of every
 * league the manager is in (system-wide leagues like Overall or a country
 * league are excluded server-side, since they have too many entries for a
 * per-entry-picks table to be meaningful). Selection is remembered across
 * visits via localStorage. */
/** Matches TrackerSkeleton's (LiveTracker.tsx) treatment -- same shimmer
 * bars, same panel/rise shell -- so every "fetching from the FPL API"
 * moment in the app reads as one consistent loading language rather than
 * two different ones. */
function LeaguesSkeleton() {
  return (
    <div className="panel rise space-y-3 p-4">
      <div className="h-3 w-28 animate-pulse rounded bg-white/10" />
      <div className="space-y-1.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-7 animate-pulse rounded bg-white/[0.05]" />
        ))}
      </div>
    </div>
  );
}

export default function LeaguesPage() {
  const [data, setData] = useState<LeaguesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? Number(stored) : null;
    } catch {
      return null; // localStorage unavailable (private mode, etc) -- fall back to server default
    }
  });

  const tick = useCallback(async () => {
    try {
      const qs = selectedId != null ? `?leagueId=${selectedId}` : "";
      const res = await fetch(`/api/league${qs}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setData(json as LeaguesResponse);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    const t = setTimeout(tick, 0);
    const id = setInterval(tick, POLL_MS);
    return () => {
      clearTimeout(t);
      clearInterval(id);
    };
  }, [tick]);

  const handleSelect = (leagueId: number) => {
    setSelectedId(leagueId);
    setLoading(true);
    try {
      localStorage.setItem(STORAGE_KEY, String(leagueId));
    } catch {
      // ignore -- selection just won't persist across visits
    }
  };

  if (loading) {
    return <LeaguesSkeleton />;
  }
  if (error) {
    return (
      <div className="panel p-3 text-xs text-[var(--danger)]">Leagues unavailable: {error}</div>
    );
  }
  if (!data) {
    return <div className="panel p-3 text-xs text-ink-faint">No private leagues found.</div>;
  }

  const currentId = data.league?.leagueId ?? selectedId;

  return (
    <div className="space-y-4">
      {data.leagues.length > 1 && (
        <Dropdown
          value={currentId ?? ""}
          onChange={handleSelect}
          options={data.leagues.map((l) => ({ value: l.leagueId, label: l.leagueName }))}
        />
      )}
      <LeagueTable league={data.league} gameweek={data.gameweek} />
      {data.league && (
        <p className="px-1 text-[11px] text-ink-faint">
          Live xP is this app&rsquo;s own projection (actual points so far + decayed expected points
          for the rest of the gameweek), not FPL&rsquo;s -- it can read slightly off for an entry
          playing a chip this gameweek. Captain shown is who they picked, not who ends up with the
          armband if their captain doesn&rsquo;t play.
        </p>
      )}
    </div>
  );
}
