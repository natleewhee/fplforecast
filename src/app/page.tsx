import type { ReactNode } from "react";
import {
  latestSnapshotDate,
  loadBootstrapSnapshot,
  loadLatestForecast,
  loadChipStatus,
  loadOverrides,
  type GameweekReview,
  type RunningRecord,
} from "@/lib/snapshots";
import Pitch from "./Pitch";
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

function RunningRecordHeader({ record }: { record: RunningRecord | null }) {
  if (!record || record.gameweeksScored === 0) {
    return (
      <Card>
        <p className="text-xs text-ink-soft">
          No out-of-sample record yet — it fills in as gameweeks are scored.
        </p>
      </Card>
    );
  }
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="text-[11px] uppercase tracking-wide text-ink-soft">
          Out-of-sample · {record.gameweeksScored} GW
        </span>
        <span className="tabular-nums">
          model <span className="font-semibold text-ink">{record.modelTotal}</span>
        </span>
        <span className="tabular-nums">
          baseline <span className="font-semibold text-ink">{record.baselineTotal}</span>
        </span>
        <span className="tabular-nums">
          Δ/GW <span className="font-semibold text-ink">{record.pooledDeltaPerGw.toFixed(2)}</span>
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
            record.meaningful
              ? "bg-[var(--pitch-light)]/15 text-[var(--pitch-dark)]"
              : "bg-line text-ink-soft"
          }`}
        >
          {record.meaningful ? "meaningful edge" : "no clear edge"}
        </span>
      </div>
    </Card>
  );
}

function GameweekReviewCard({ review }: { review: GameweekReview | null }) {
  if (!review || review.xiPoints == null) return null;
  const mvb = review.modelVsBaseline;
  const scored = mvb && "model" in mvb;
  const cap = review.captain;
  return (
    <Card>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-[11px] uppercase tracking-wide text-ink-soft">
          GW{review.gameweek} result
        </span>
        {!review.dataChecked && (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
            provisional
          </span>
        )}
        <span className="text-lg font-extrabold text-ink tabular-nums">{review.xiPoints}</span>
        <span className="text-xs text-ink-soft tabular-nums">
          bench {review.benchPoints ?? "—"}
          {review.transfersCost > 0 && ` · −${review.transfersCost} hit`}
          {review.overallRank != null && ` · OR ${review.overallRank.toLocaleString()}`}
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        {cap && (
          <span className="tabular-nums">
            C {cap.webName}{" "}
            <span className="text-ink-soft">
              {cap.actual ?? "—"}×{cap.multiplier}
              {cap.actual != null && ` = ${cap.actual * cap.multiplier}`}
            </span>
          </span>
        )}
        {scored ? (
          <span className="tabular-nums">
            model XI <span className="font-semibold text-ink">{mvb.model}</span> · baseline XI{" "}
            <span className="font-semibold text-ink">{mvb.baseline}</span>{" "}
            <span
              className={
                mvb.delta >= 0 ? "text-[var(--pitch-dark)]" : "text-[var(--fwd)]"
              }
            >
              ({mvb.delta >= 0 ? "+" : ""}
              {mvb.delta})
            </span>
          </span>
        ) : (
          <span className="text-ink-soft">
            {mvb && "status" in mvb && mvb.status === "no_prediction"
              ? "no model prediction was logged for this gameweek"
              : "model vs baseline pending final stats"}
          </span>
        )}
      </div>
    </Card>
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

  if (forecast && forecast.squad && forecast.squad.startingXi) {
    return (
      <main className="mx-auto min-h-screen max-w-md bg-background pb-12 md:max-w-4xl">
        <Header
          subtitle={`GW${forecast.targetGameweek} · your GW${forecast.basedOnGameweek} squad`}
        />

        <div className="space-y-4 p-4">
          <GameweekReviewCard review={forecast.lastGameweek} />
          <RunningRecordHeader record={forecast.runningRecord} />

          <Card>
            <div className="flex items-baseline justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-ink-soft">
                  Captain · model · GW{forecast.targetGameweek}
                </p>
                <p className="text-base font-bold text-ink">
                  {forecast.captain?.webName ?? "—"}
                  {forecast.captain?.points != null && (
                    <span className="ml-1.5 text-xs font-medium text-ink-soft tabular-nums">
                      {forecast.captain.points.toFixed(1)} pts
                    </span>
                  )}
                </p>
                {forecast.viceCaptain && (
                  <p className="mt-0.5 text-xs text-ink-soft">
                    VC {forecast.viceCaptain.webName}
                    {forecast.viceCaptain.points != null && (
                      <span className="tabular-nums"> ({forecast.viceCaptain.points.toFixed(1)})</span>
                    )}
                    {forecast.captainEdge && (
                      <span
                        className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          forecast.captainEdge.label === "clear edge"
                            ? "bg-[var(--pitch-light)]/15 text-[var(--pitch-dark)]"
                            : "bg-line text-ink-soft"
                        }`}
                      >
                        {forecast.captainEdge.label} · +{forecast.captainEdge.points.toFixed(1)}
                      </span>
                    )}
                  </p>
                )}
              </div>
              {forecast.overridesApplied > 0 && (
                <p className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-800">
                  {forecast.overridesApplied} manual transfer(s) applied
                </p>
              )}
            </div>

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

          <Pitch forecast={forecast} />

          {overrides &&
            overrides.basedOnGw === forecast.basedOnGameweek &&
            overrides.transfers.length > 0 && (
              <p className="text-xs text-ink-soft">
                Pending: {overrides.transfers.map((t) => `out ${t.out} → in ${t.in}`).join(", ")}
              </p>
            )}

          <Card>
            <TransferForm
              squad={forecast.squad.players}
              allPlayers={bootstrap.players}
              basedOnGw={forecast.basedOnGameweek}
              bank={forecast.squad.bank}
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
