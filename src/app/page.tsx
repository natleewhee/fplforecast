import {
  latestSnapshotDate,
  loadBootstrapSnapshot,
  loadLatestForecast,
  type ForecastPlayer,
} from "@/lib/snapshots";

export const dynamic = "force-static";

function PlayerRow({ player, tag }: { player: ForecastPlayer; tag?: string }) {
  return (
    <tr className="border-b border-neutral-100">
      <td className="py-1">
        {player.webName}
        {tag && <span className="ml-1 text-xs text-neutral-400">({tag})</span>}
      </td>
      <td className="py-1">{player.position}</td>
      <td className="py-1">{player.team}</td>
      <td className="py-1 text-right">{player.projected.toFixed(1)}</td>
    </tr>
  );
}

export default function Home() {
  const bootstrap = loadBootstrapSnapshot();
  const fixturesDate = latestSnapshotDate("fixtures");
  const entryDate = latestSnapshotDate("entry-1168513");
  const forecast = loadLatestForecast();

  if (!bootstrap) {
    return (
      <main className="mx-auto max-w-md p-4 text-center">
        <h1 className="text-xl font-semibold">FPL Forecaster</h1>
        <p className="mt-4 text-sm text-neutral-500">
          No snapshot data yet. Run the &quot;Snapshot FPL data&quot; GitHub Action
          (or wait for tonight&apos;s scheduled run), then redeploy.
        </p>
      </main>
    );
  }

  if (forecast) {
    return (
      <main className="mx-auto max-w-md p-4 pb-12">
        <h1 className="text-xl font-semibold">FPL Forecaster</h1>
        <p className="mt-1 text-xs text-neutral-500">
          GW{forecast.basedOnGameweek + 1} pick, from your GW{forecast.basedOnGameweek} squad ·
          last-{forecast.rollingWindow}-GW rolling average x availability
        </p>
        <p className="mt-3 text-sm">
          Captain: <span className="font-medium">{forecast.captain}</span> · Vice:{" "}
          <span className="font-medium">{forecast.viceCaptain}</span>
        </p>

        <h2 className="mt-4 text-sm font-semibold text-neutral-600">Starting XI</h2>
        <table className="mt-1 w-full text-sm">
          <thead>
            <tr className="border-b text-left text-neutral-500">
              <th className="py-1">Player</th>
              <th className="py-1">Pos</th>
              <th className="py-1">Team</th>
              <th className="py-1 text-right">Proj</th>
            </tr>
          </thead>
          <tbody>
            {forecast.startingXI.map((p) => (
              <PlayerRow
                key={p.id}
                player={p}
                tag={p.id === forecast.captainId ? "C" : p.id === forecast.viceCaptainId ? "VC" : undefined}
              />
            ))}
          </tbody>
        </table>

        <h2 className="mt-4 text-sm font-semibold text-neutral-600">Bench</h2>
        <table className="mt-1 w-full text-sm">
          <tbody>
            {forecast.bench.map((p) => (
              <PlayerRow key={p.id} player={p} />
            ))}
          </tbody>
        </table>

        <p className="mt-6 text-xs text-neutral-400">
          Snapshot {bootstrap.date}
          {fixturesDate && ` · fixtures ${fixturesDate}`}
          {entryDate && ` · squad ${entryDate}`}
        </p>
      </main>
    );
  }

  const top = [...bootstrap.players]
    .filter((p) => p.status === "a")
    .sort((a, b) => b.epNext - a.epNext)
    .slice(0, 30);

  return (
    <main className="mx-auto max-w-md p-4 pb-12">
      <h1 className="text-xl font-semibold">FPL Forecaster</h1>
      <p className="mt-1 text-xs text-neutral-500">
        Snapshot {bootstrap.date}
        {fixturesDate && ` · fixtures ${fixturesDate}`}
        {entryDate && ` · squad ${entryDate}`}
      </p>
      <p className="mt-3 text-sm text-neutral-500">
        No forecast yet — needs a finished gameweek to know your squad. Showing
        FPL&apos;s own <code>ep_next</code>, sorted, in the meantime.
      </p>

      <table className="mt-4 w-full text-sm">
        <thead>
          <tr className="border-b text-left text-neutral-500">
            <th className="py-1">Player</th>
            <th className="py-1">Pos</th>
            <th className="py-1">Team</th>
            <th className="py-1 text-right">£m</th>
            <th className="py-1 text-right">ep_next</th>
          </tr>
        </thead>
        <tbody>
          {top.map((p) => (
            <tr key={p.id} className="border-b border-neutral-100">
              <td className="py-1">{p.webName}</td>
              <td className="py-1">{p.position}</td>
              <td className="py-1">{p.team}</td>
              <td className="py-1 text-right">{p.priceMillions.toFixed(1)}</td>
              <td className="py-1 text-right">{p.epNext.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
