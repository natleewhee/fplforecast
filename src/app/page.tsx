import type { ReactNode } from "react";
import {
  latestSnapshotDate,
  loadBootstrapSnapshot,
  loadLatestForecast,
  loadChipStatus,
  loadOverrides,
  type ForecastPlayer,
} from "@/lib/snapshots";
import TransferForm from "./TransferForm";

export const dynamic = "force-static";

const POSITION_COLOR: Record<string, string> = {
  GKP: "bg-[var(--gkp)]",
  DEF: "bg-[var(--def)]",
  MID: "bg-[var(--mid)]",
  FWD: "bg-[var(--fwd)]",
};

function PositionBadge({ position }: { position: string }) {
  return (
    <span
      className={`inline-block w-9 shrink-0 rounded py-0.5 text-center text-[10px] font-bold tracking-wide text-white ${
        POSITION_COLOR[position] ?? "bg-ink-soft"
      }`}
    >
      {position}
    </span>
  );
}

function ArmbandTag({ label }: { label: "C" | "VC" }) {
  return (
    <span
      className={`ml-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-white ${
        label === "C" ? "bg-[var(--pitch-dark)]" : "bg-ink-soft"
      }`}
      title={label === "C" ? "Captain" : "Vice-captain"}
    >
      {label}
    </span>
  );
}

function PlayerRow({ player, tag }: { player: ForecastPlayer; tag?: "C" | "VC" }) {
  return (
    <tr className="border-b border-line last:border-0">
      <td className="py-2 pr-2">
        <div className="flex items-center gap-2">
          <PositionBadge position={player.position} />
          <span className="font-medium text-ink">{player.webName}</span>
          {tag && <ArmbandTag label={tag} />}
        </div>
      </td>
      <td className="py-2 pr-2 text-ink-soft">{player.team}</td>
      <td className="py-2 pr-2 text-right text-ink-soft tabular-nums">
        {player.expectedMinutes === null || player.expectedMinutes === undefined
          ? "—"
          : Math.round(player.expectedMinutes)}
      </td>
      <td className="py-2 pr-2 text-right text-ink-soft tabular-nums">
        {player.fdrMultiplier === undefined
          ? "—"
          : player.fdrMultiplier === 0
            ? "blank"
            : `${player.fdrMultiplier.toFixed(2)}x`}
      </td>
      <td className="py-2 text-right font-semibold text-[var(--pitch-dark)] tabular-nums">
        {player.projected.toFixed(1)}
      </td>
    </tr>
  );
}

function TableHead() {
  return (
    <thead>
      <tr className="border-b-2 border-[var(--pitch)] text-left text-[11px] uppercase tracking-wide text-ink-soft">
        <th className="py-1.5 font-semibold">Player</th>
        <th className="py-1.5 font-semibold">Team</th>
        <th className="py-1.5 text-right font-semibold">Mins</th>
        <th className="py-1.5 text-right font-semibold">FDR</th>
        <th className="py-1.5 text-right font-semibold">Proj</th>
      </tr>
    </thead>
  );
}

function Header({ subtitle }: { subtitle: string }) {
  return (
    <div className="pitch-stripes rounded-b-2xl px-4 pb-5 pt-6 text-center shadow-sm">
      <h1 className="text-2xl font-extrabold tracking-tight text-white">
        <span className="mr-1.5">⚽</span>FPL Forecaster
      </h1>
      <p className="mt-1 text-xs font-medium text-white/80">{subtitle}</p>
    </div>
  );
}

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-line bg-card p-4 shadow-sm ${className}`}>{children}</div>
  );
}

export default function Home() {
  const bootstrap = loadBootstrapSnapshot();
  const fixturesDate = latestSnapshotDate("fixtures");
  const entryDate = latestSnapshotDate("entry-1168513");
  const forecast = loadLatestForecast();
  const chips = loadChipStatus();
  const overrides = loadOverrides();

  if (!bootstrap) {
    return (
      <main className="mx-auto min-h-screen max-w-md bg-background md:max-w-2xl">
        <Header subtitle="No data yet" />
        <div className="p-4">
          <Card>
            <p className="text-sm text-ink-soft">
              No snapshot data yet. Run the &quot;Snapshot FPL data&quot; GitHub Action (or wait
              for tonight&apos;s scheduled run), then redeploy.
            </p>
          </Card>
        </div>
      </main>
    );
  }

  if (forecast) {
    return (
      <main className="mx-auto min-h-screen max-w-md bg-background pb-12 md:max-w-2xl">
        <Header
          subtitle={`GW${forecast.basedOnGameweek + 1} pick · from your GW${forecast.basedOnGameweek} squad`}
        />

        <div className="space-y-4 p-4">
          <Card>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-ink-soft">Captain</p>
                <p className="text-base font-bold text-ink">{forecast.captain}</p>
              </div>
              <div className="h-8 w-px bg-line" />
              <div>
                <p className="text-[11px] uppercase tracking-wide text-ink-soft">Vice</p>
                <p className="text-base font-bold text-ink">{forecast.viceCaptain}</p>
              </div>
            </div>

            {forecast.overridesApplied > 0 && (
              <p className="mt-3 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-800">
                {forecast.overridesApplied} manual transfer(s) applied on top of the auto-pulled squad
              </p>
            )}

            {chips && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {chips.map((c) => (
                  <span
                    key={c.name}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                      c.remaining > 0
                        ? "bg-[var(--pitch-light)]/15 text-[var(--pitch-dark)]"
                        : "bg-line text-ink-soft line-through"
                    }`}
                  >
                    {c.name} {c.remaining > 0 ? `(${c.remaining})` : "used"}
                  </span>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--pitch-dark)]">
              Starting XI
            </h2>
            <table className="mt-1 w-full text-sm">
              <TableHead />
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
          </Card>

          <Card>
            <h2 className="text-sm font-bold uppercase tracking-wide text-ink-soft">Bench</h2>
            <table className="mt-1 w-full text-sm">
              <tbody>
                {forecast.bench.map((p) => (
                  <PlayerRow key={p.id} player={p} />
                ))}
              </tbody>
            </table>
          </Card>

          {overrides && overrides.basedOnGw === forecast.basedOnGameweek && overrides.transfers.length > 0 && (
            <p className="text-xs text-ink-soft">
              Pending: {overrides.transfers.map((t) => `out ${t.out} → in ${t.in}`).join(", ")}
            </p>
          )}

          <Card>
            <TransferForm
              squad={[...forecast.startingXI, ...forecast.bench]}
              allPlayers={bootstrap.players}
              basedOnGw={forecast.basedOnGameweek}
            />
          </Card>

          <p className="text-center text-xs text-ink-soft">
            Snapshot {bootstrap.date}
            {fixturesDate && ` · fixtures ${fixturesDate}`}
            {entryDate && ` · squad ${entryDate}`}
          </p>
        </div>
      </main>
    );
  }

  const top = [...bootstrap.players]
    .filter((p) => p.status === "a")
    .sort((a, b) => b.epNext - a.epNext)
    .slice(0, 30);

  return (
    <main className="mx-auto min-h-screen max-w-md bg-background pb-12 md:max-w-2xl">
      <Header subtitle="No forecast yet" />
      <div className="space-y-4 p-4">
        <Card>
          <p className="text-sm text-ink-soft">
            Needs a finished gameweek to know your squad. Showing FPL&apos;s own{" "}
            <code className="rounded bg-line px-1 py-0.5 text-xs">ep_next</code>, sorted, in the
            meantime.
          </p>
        </Card>

        <Card>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-[var(--pitch)] text-left text-[11px] uppercase tracking-wide text-ink-soft">
                <th className="py-1.5 font-semibold">Player</th>
                <th className="py-1.5 font-semibold">Team</th>
                <th className="py-1.5 text-right font-semibold">£m</th>
                <th className="py-1.5 text-right font-semibold">ep_next</th>
              </tr>
            </thead>
            <tbody>
              {top.map((p) => (
                <tr key={p.id} className="border-b border-line last:border-0">
                  <td className="py-2 pr-2">
                    <div className="flex items-center gap-2">
                      <PositionBadge position={p.position} />
                      <span className="font-medium text-ink">{p.webName}</span>
                    </div>
                  </td>
                  <td className="py-2 pr-2 text-ink-soft">{p.team}</td>
                  <td className="py-2 pr-2 text-right text-ink-soft tabular-nums">
                    {p.priceMillions.toFixed(1)}
                  </td>
                  <td className="py-2 text-right font-semibold text-[var(--pitch-dark)] tabular-nums">
                    {p.epNext.toFixed(1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <p className="text-center text-xs text-ink-soft">
          Snapshot {bootstrap.date}
          {fixturesDate && ` · fixtures ${fixturesDate}`}
          {entryDate && ` · squad ${entryDate}`}
        </p>
      </div>
    </main>
  );
}
