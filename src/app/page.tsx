import {
  latestSnapshotDate,
  loadBootstrapSnapshot,
  loadLatestForecast,
  loadChipStatus,
  loadOverrides,
} from "@/lib/snapshots";
import AppShell from "./AppShell";
import { Card, Header, PositionBadge, Shell } from "./PageChrome";

export const dynamic = "force-static";

export default function Home() {
  const bootstrap = loadBootstrapSnapshot();
  const fixturesDate = latestSnapshotDate("fixtures");
  const entryDate = latestSnapshotDate("entry-1168513");
  const forecast = loadLatestForecast();
  const chips = loadChipStatus();
  const overrides = loadOverrides();

  if (!bootstrap) {
    return (
      <>
        <Header subtitle="no data" />
        <Shell>
          <div className="pt-4">
            <Card>
              <p className="text-sm text-ink-soft">
                No snapshot data yet. Run the &quot;Snapshot FPL data&quot; GitHub Action (or wait
                for tonight&apos;s scheduled run), then redeploy.
              </p>
            </Card>
          </div>
        </Shell>
      </>
    );
  }

  const footer = (
    <p className="pt-2 text-center font-mono text-[11px] text-ink-faint">
      <span className="text-[var(--accent)] opacity-60">{"// "}</span>
      snapshot {bootstrap.date}
      {fixturesDate && ` · fixtures ${fixturesDate}`}
      {entryDate && ` · squad ${entryDate}`}
    </p>
  );

  if (forecast && forecast.squad && forecast.squad.startingXi) {
    // The static shell renders this app's own team instantly for everyone
    // (edge-cached, `force-static` above) -- AppShell is a client component
    // that, after mount, checks for a different team ID a visitor picked on
    // a previous visit and swaps in an on-demand forecast for it. That keeps
    // this page's own hosting characteristics (and everyone's default
    // experience) unchanged; only a guest lookup pays the extra round trip.
    return (
      <AppShell
        initialForecast={forecast}
        bootstrap={bootstrap}
        initialChips={chips}
        initialOverrides={overrides}
        footer={footer}
      />
    );
  }

  const top = [...bootstrap.players]
    .filter((p) => p.status === "a")
    .sort((a, b) => b.epNext - a.epNext)
    .slice(0, 30);

  return (
    <>
      <Header subtitle="no forecast yet" />
      <Shell>
        <div className="space-y-4 pt-4">
          <Card>
            <p className="text-sm text-ink-soft">
              Needs a finished gameweek to know your squad. Showing FPL&apos;s own{" "}
              <code className="rounded bg-white/10 px-1 py-0.5 font-mono text-xs text-ink">
                ep_next
              </code>
              , sorted, in the meantime.
            </p>
          </Card>

          <Card className="!p-0 overflow-hidden">
            {/* table-fixed + colgroup, same as the Leagues table -- an
               unconstrained table can grow past the viewport on a long
               player name with no way to scroll to see it. */}
            <table className="w-full table-fixed text-sm">
              <colgroup>
                <col className="w-[46%]" />
                <col className="w-[24%]" />
                <col className="w-[15%]" />
                <col className="w-[15%]" />
              </colgroup>
              <thead>
                <tr className="border-b border-line text-left eyebrow">
                  <th className="px-4 py-2.5 font-bold">Player</th>
                  <th className="px-4 py-2.5 font-bold">Team</th>
                  <th className="px-4 py-2.5 text-right font-bold">£m</th>
                  <th className="px-4 py-2.5 text-right font-bold">ep_next</th>
                </tr>
              </thead>
              <tbody>
                {top.map((p) => (
                  <tr key={p.id} className="border-b border-line last:border-0 hover:bg-white/[0.03]">
                    <td className="px-4 py-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <PositionBadge position={p.position} />
                        <span className="truncate font-medium text-ink">{p.webName}</span>
                      </div>
                    </td>
                    <td className="truncate px-4 py-2 text-ink-soft">{p.team}</td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums text-ink-soft">
                      {p.priceMillions.toFixed(1)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono font-semibold tabular-nums text-[var(--accent)]">
                      {p.epNext.toFixed(1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {footer}
        </div>
      </Shell>
    </>
  );
}
