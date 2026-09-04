import type { SeasonHistory } from "@/lib/snapshots";

function compactRank(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return `${n}`;
}

// Combo chart geometry: one column per gameweek, points as bars, overall
// rank as an overlaid line sharing the same horizontal scroll so the two
// series stay aligned regardless of how many gameweeks have been played.
const COL_W = 32; // bar width, px
const COL_GAP = 6; // px between columns
const COL_STEP = COL_W + COL_GAP;
const CHART_H = 112; // px, matches the old h-28 bar area
const LINE_TOP = 10; // px inset so the rank line doesn't clip the top edge
const LINE_BOTTOM = 100; // px inset so the rank line doesn't clip the GW labels

export default function History({ history }: { history: SeasonHistory }) {
  const gws = history.gameweeks.filter((g) => g.gameweek != null && g.points != null);
  const seasonTotal = gws.length ? gws[gws.length - 1].totalPoints : null;
  const maxPts = Math.max(1, ...gws.map((g) => g.points ?? 0));

  const ranks = gws.map((g) => g.overallRank).filter((r): r is number => r != null);
  const firstRank = ranks[0];
  const lastRank = ranks[ranks.length - 1];
  const rankImproved = firstRank != null && lastRank != null && lastRank < firstRank;

  // Rank line: only meaningful with a few points; lower rank -> higher (smaller y).
  const rMin = ranks.length ? Math.min(...ranks) : 0;
  const rMax = ranks.length ? Math.max(...ranks) : 1;
  const chartWidth = Math.max(1, gws.length) * COL_STEP - COL_GAP;
  const xCenter = (i: number) => i * COL_STEP + COL_W / 2;
  const rankY = (r: number) =>
    rMax === rMin
      ? (LINE_TOP + LINE_BOTTOM) / 2
      : LINE_TOP + ((r - rMin) / (rMax - rMin)) * (LINE_BOTTOM - LINE_TOP);

  const rankPoints = gws
    .map((g, i) => (g.overallRank != null ? { x: xCenter(i), y: rankY(g.overallRank), g } : null))
    .filter((p): p is { x: number; y: number; g: (typeof gws)[number] } => p != null);
  const linePath = rankPoints.length >= 2 ? rankPoints.map((p) => `${p.x},${p.y}`).join(" ") : null;

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
            {/* points per gameweek (bars) with overall rank overlaid as a line —
               both series share one horizontally-scrolling coordinate space so
               a gameweek's bar and its rank point never drift out of alignment. */}
            <div className="overflow-x-auto">
              <div className="relative" style={{ width: chartWidth, height: CHART_H }}>
                <div className="flex h-full gap-1.5">
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

                {linePath && (
                  <svg
                    viewBox={`0 0 ${chartWidth} ${CHART_H}`}
                    preserveAspectRatio="none"
                    className="pointer-events-none absolute inset-0 h-full w-full"
                  >
                    <polyline
                      points={linePath}
                      fill="none"
                      stroke="var(--accent-2)"
                      strokeWidth="1.5"
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      vectorEffect="non-scaling-stroke"
                    />
                    {rankPoints.map((p) => (
                      <circle key={p.g.gameweek} cx={p.x} cy={p.y} r="2.2" fill="var(--accent-2)">
                        <title>
                          GW{p.g.gameweek}: rank {compactRank(p.g.overallRank)}
                        </title>
                      </circle>
                    ))}
                  </svg>
                )}
              </div>
            </div>

            <div className="mt-2 flex items-center justify-between border-t border-line pt-2 text-[10px]">
              <span className="flex items-center gap-3 text-ink-faint">
                <span>
                  <span className="inline-block h-2 w-2 rounded-sm bg-[var(--accent)] align-middle" />{" "}
                  GW points
                </span>
                <span>
                  <span className="inline-block h-0.5 w-3 rounded-full bg-[var(--accent-2)] align-middle" />{" "}
                  overall rank
                </span>
              </span>
              <span className="flex items-center gap-1.5 text-ink-soft">
                <span className="stat text-ink">{compactRank(lastRank ?? null)}</span>
                {firstRank != null && lastRank != null && firstRank !== lastRank && (
                  <span className={rankImproved ? "text-[var(--accent)]" : "text-[var(--danger)]"}>
                    {rankImproved ? "▲" : "▼"} from {compactRank(firstRank)}
                  </span>
                )}
              </span>
            </div>
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
