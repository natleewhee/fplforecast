import type { SeasonHistory } from "@/lib/snapshots";

function compactRank(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return `${n}`;
}

export default function History({ history }: { history: SeasonHistory }) {
  const gws = history.gameweeks.filter((g) => g.gameweek != null && g.points != null);
  const seasonTotal = gws.length ? gws[gws.length - 1].totalPoints : null;
  const maxPts = Math.max(1, ...gws.map((g) => g.points ?? 0));

  const ranks = gws.map((g) => g.overallRank).filter((r): r is number => r != null);
  const firstRank = ranks[0];
  const lastRank = ranks[ranks.length - 1];
  const rankImproved = firstRank != null && lastRank != null && lastRank < firstRank;

  // rank sparkline (only meaningful with a few points); lower rank = higher line
  const rMin = Math.min(...ranks);
  const rMax = Math.max(...ranks);
  const sparkPts =
    ranks.length >= 3
      ? gws
          .map((g, i) => {
            const r = g.overallRank;
            const y = r == null || rMax === rMin ? 10 : 2 + ((r - rMin) / (rMax - rMin)) * 16;
            return `${(i / (gws.length - 1)) * 100},${y}`;
          })
          .join(" ")
      : null;

  return (
    <div className="panel rise p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-mono text-[13px] font-bold tracking-[0.12em] text-ink">HISTORY</h2>
        {seasonTotal != null && (
          <span className="text-xs text-ink-soft">
            season <span className="stat text-ink">{seasonTotal}</span> pts
          </span>
        )}
      </div>

      {gws.length > 0 ? (
        <>
          <div className="mt-3 rounded-xl border border-line bg-white/[0.02] p-3">
            {/* points per gameweek — fixed-width bars, grow rightward as the season runs */}
            <div className="flex h-28 gap-1.5 overflow-x-auto">
              {gws.map((g) => (
                <div key={g.gameweek} className="flex h-full w-8 shrink-0 flex-col items-center">
                  <span className="font-mono text-[9px] text-ink-soft">{g.points}</span>
                  <div className="flex w-full flex-1 items-end pt-1">
                    <div
                      className="w-full rounded-t bg-gradient-to-t from-[color-mix(in_srgb,var(--accent)_55%,transparent)] to-[var(--accent)]"
                      style={{ height: `${Math.max(4, ((g.points ?? 0) / maxPts) * 100)}%` }}
                    />
                  </div>
                  <span className="mt-1 text-[9px] text-ink-faint">GW{g.gameweek}</span>
                </div>
              ))}
            </div>

            <div className="mt-2 flex items-center justify-between border-t border-line pt-2 text-[10px]">
              <span className="text-ink-faint">
                <span className="inline-block h-2 w-2 rounded-sm bg-[var(--accent)] align-middle" />{" "}
                GW points
              </span>
              <span className="flex items-center gap-1.5 text-ink-soft">
                overall rank
                <span className="stat text-ink">{compactRank(lastRank ?? null)}</span>
                {firstRank != null && lastRank != null && firstRank !== lastRank && (
                  <span className={rankImproved ? "text-[var(--accent)]" : "text-[var(--danger)]"}>
                    {rankImproved ? "▲" : "▼"} from {compactRank(firstRank)}
                  </span>
                )}
              </span>
            </div>

            {sparkPts && (
              <svg viewBox="0 0 100 20" preserveAspectRatio="none" className="mt-2 h-8 w-full">
                <polyline
                  points={sparkPts}
                  fill="none"
                  stroke="var(--accent-2)"
                  strokeWidth="1.2"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            )}
          </div>

          <ul className="mt-3 divide-y divide-line text-xs">
            {[...gws].reverse().map((g) => {
              const mvb = g.modelVsBaseline;
              const scored = mvb && "model" in mvb;
              return (
                <li key={g.gameweek} className="flex items-center gap-3 py-1.5">
                  <span className="w-9 font-mono text-ink-faint">GW{g.gameweek}</span>
                  <span className="stat w-8 text-ink">{g.points}</span>
                  {g.hit > 0 && <span className="text-[var(--danger)]">−{g.hit}</span>}
                  <span className="flex-1 truncate text-ink-faint">
                    bench {g.benchPoints ?? "—"} · OR {compactRank(g.overallRank)} · £
                    {g.teamValue.toFixed(1)}
                  </span>
                  {scored && (
                    <span className="font-mono text-[10px] text-ink-soft">
                      m{mvb.model} b{mvb.baseline}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <p className="mt-3 text-xs text-ink-soft">No gameweeks recorded yet this season.</p>
      )}

      {history.seasons.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-line pt-3">
          {history.seasons.map((s, i) => (
            <span key={s.season ?? i} className="chip">
              {s.season} · {s.totalPoints?.toLocaleString() ?? "—"} · {compactRank(s.rank)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
