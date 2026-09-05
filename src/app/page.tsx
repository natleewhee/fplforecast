import type { ReactNode } from "react";
import {
  latestSnapshotDate,
  loadBootstrapSnapshot,
  loadLatestForecast,
  loadChipStatus,
  loadOverrides,
  type GameweekReview,
  type RunningRecord,
  type ParCalibration,
} from "@/lib/snapshots";
import Pitch from "./Pitch";
import History from "./History";
import LiveTracker from "./LiveTracker";
import Scenarios from "./Scenarios";
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
      className={`inline-block w-9 shrink-0 rounded-md py-0.5 text-center text-[10px] font-bold tracking-wide text-black/85 ${
        POSITION_COLOR[position] ?? "bg-ink-soft"
      }`}
    >
      {position}
    </span>
  );
}

function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`panel rise p-4 ${className}`}>{children}</div>;
}

/** A compact HUD stat module: eyebrow label, then free-form body. */
function Module({
  label,
  accent,
  children,
}: {
  label: string;
  accent?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Panel className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="eyebrow">{label}</span>
        {accent}
      </div>
      {children}
    </Panel>
  );
}

function RunningRecordModule({ record }: { record: RunningRecord | null }) {
  if (!record || record.gameweeksScored === 0) {
    return (
      <Module label="Out-of-sample record">
        <p className="text-xs text-ink-soft">
          Fills in as gameweeks are scored — model vs baseline, out of sample.
        </p>
      </Module>
    );
  }
  return (
    <Module
      label={`Out-of-sample · ${record.gameweeksScored} GW`}
      accent={
        <span className={record.meaningful ? "chip chip-accent" : "chip"}>
          {record.meaningful ? "edge" : "no edge"}
        </span>
      }
    >
      <div className="flex items-end gap-4">
        <div>
          <div className="stat stat-glow text-2xl leading-none">
            {record.pooledDeltaPerGw > 0 ? "+" : ""}
            {record.pooledDeltaPerGw.toFixed(2)}
          </div>
          <div className="eyebrow mt-1">Δ per gameweek</div>
        </div>
        <div className="flex gap-3 text-xs text-ink-soft">
          <span className="stat">
            {record.modelTotal}
            <span className="ml-1 font-sans font-normal text-ink-faint">model</span>
          </span>
          <span className="stat">
            {record.baselineTotal}
            <span className="ml-1 font-sans font-normal text-ink-faint">base</span>
          </span>
        </div>
      </div>
    </Module>
  );
}

function ParCalibrationModule({ calibration }: { calibration: ParCalibration | null }) {
  if (!calibration || calibration.gameweeksScored === 0) {
    return (
      <Module label="Par calibration">
        <p className="text-xs text-ink-soft">
          Fills in as gameweeks are scored — how often the live tracker&apos;s par verdict
          correctly called whether your overall rank held.
        </p>
      </Module>
    );
  }
  const { hitRate, hitRateByVerdict } = calibration;
  const pct = (r: number | null) => (r == null ? "—" : `${Math.round(r * 100)}%`);
  return (
    <Module label={`Par calibration · ${calibration.gameweeksScored} GW`}>
      <div className="flex items-end gap-4">
        <div>
          <div className="stat stat-glow text-2xl leading-none">{pct(hitRate)}</div>
          <div className="eyebrow mt-1">hit rate</div>
        </div>
        <div className="flex gap-3 text-xs text-ink-soft">
          <span className="stat text-[var(--accent)]">
            {pct(hitRateByVerdict.green)}
            <span className="ml-1 font-sans font-normal text-ink-faint">green</span>
          </span>
          <span className="stat text-[var(--warn)]">
            {pct(hitRateByVerdict.amber)}
            <span className="ml-1 font-sans font-normal text-ink-faint">amber</span>
          </span>
          <span className="stat text-[var(--danger)]">
            {pct(hitRateByVerdict.red)}
            <span className="ml-1 font-sans font-normal text-ink-faint">red</span>
          </span>
        </div>
      </div>
    </Module>
  );
}

function GameweekReviewModule({ review }: { review: GameweekReview | null }) {
  if (!review || review.xiPoints == null) return null;
  const mvb = review.modelVsBaseline;
  const scored = mvb && "model" in mvb;
  const cap = review.captain;
  return (
    <Module
      label={`GW${review.gameweek} result`}
      accent={
        !review.dataChecked ? <span className="chip chip-warn">provisional</span> : null
      }
    >
      <div className="flex items-end gap-4">
        <div>
          <div className="stat text-3xl leading-none text-ink">{review.xiPoints}</div>
          <div className="eyebrow mt-1">points</div>
        </div>
        <div className="space-y-0.5 text-xs text-ink-soft">
          <div className="stat">
            {review.benchPoints ?? "—"}
            <span className="ml-1 font-sans font-normal text-ink-faint">bench</span>
          </div>
          {review.transfersCost > 0 && (
            <div className="text-[var(--danger)]">−{review.transfersCost} hit</div>
          )}
          {review.overallRank != null && (
            <div className="font-mono tabular-nums text-ink-faint">
              OR {review.overallRank.toLocaleString()}
            </div>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-2 text-[11px]">
        {cap && (
          <span className="tabular-nums text-ink-soft">
            <span className="text-ink-faint">C</span>{" "}
            <span className="font-medium text-ink">{cap.webName}</span>{" "}
            {cap.actual ?? "—"}×{cap.multiplier}
            {cap.actual != null && (
              <span className="text-ink"> = {cap.actual * cap.multiplier}</span>
            )}
          </span>
        )}
        {scored ? (
          <span className="tabular-nums text-ink-soft">
            model <span className="font-semibold text-ink">{mvb.model}</span> · base{" "}
            <span className="font-semibold text-ink">{mvb.baseline}</span>{" "}
            <span className={mvb.delta >= 0 ? "text-[var(--accent)]" : "text-[var(--danger)]"}>
              ({mvb.delta >= 0 ? "+" : ""}
              {mvb.delta})
            </span>
          </span>
        ) : (
          <span className="text-ink-faint">
            {mvb && "status" in mvb && mvb.status === "no_prediction"
              ? "no prediction logged"
              : "model vs baseline pending"}
          </span>
        )}
      </div>
    </Module>
  );
}

function CaptainModule({
  forecast,
}: {
  forecast: NonNullable<ReturnType<typeof loadLatestForecast>>;
}) {
  const edge = forecast.captainEdge;
  return (
    <Module
      label={`Captain · GW${forecast.targetGameweek}`}
      accent={
        forecast.overridesApplied > 0 ? (
          <span className="chip chip-warn">{forecast.overridesApplied} manual</span>
        ) : null
      }
    >
      <div className="flex items-end gap-3">
        <div>
          <div className="text-xl font-bold leading-none text-ink">
            {forecast.captain?.webName ?? "—"}
          </div>
          {forecast.captain?.points != null && (
            <div className="eyebrow mt-1">
              <span className="stat text-[var(--accent)]">
                {forecast.captain.points.toFixed(1)}
              </span>{" "}
              proj
            </div>
          )}
        </div>
      </div>
      {forecast.viceCaptain && (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-soft">
          <span>
            <span className="text-ink-faint">VC</span> {forecast.viceCaptain.webName}
            {forecast.viceCaptain.points != null && (
              <span className="tabular-nums"> ({forecast.viceCaptain.points.toFixed(1)})</span>
            )}
          </span>
          {edge && (
            <span className={edge.label === "clear edge" ? "chip chip-accent" : "chip"}>
              {edge.label} +{edge.points.toFixed(1)}
            </span>
          )}
        </div>
      )}
    </Module>
  );
}

function Header({ subtitle }: { subtitle: string }) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-[color-mix(in_srgb,var(--bg-0)_78%,transparent)] backdrop-blur-xl">
      <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="grid h-7 w-7 place-items-center rounded-lg border border-[color-mix(in_srgb,var(--accent)_45%,transparent)] bg-[color-mix(in_srgb,var(--accent)_12%,transparent)]">
            <span className="h-2 w-2 rounded-full bg-[var(--accent)] pulse" />
          </span>
          <div className="leading-tight">
            <div className="font-mono text-[13px] font-bold tracking-[0.14em] text-ink">
              FPL·FORECASTER
            </div>
            <div className="text-[10px] tracking-wide text-ink-faint">{subtitle}</div>
          </div>
        </div>
        <span className="hidden h-px flex-1 bg-gradient-to-r from-transparent via-[var(--border-strong)] to-transparent sm:block" />
      </div>
    </header>
  );
}

/** kept so any leftover callers still compile; identical to Panel */
function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <Panel className={className}>{children}</Panel>;
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl px-4 pb-16">{children}</main>
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
    return (
      <>
        <Header subtitle={`GW${forecast.targetGameweek} · from your GW${forecast.basedOnGameweek} squad`} />
        <Shell>
          <div className="space-y-4 pt-4">
            {/* KTD7: the tracker self-hides until the first kickoff, then leads.
               Otherwise the projected lineup leads, ahead of the planning table. */}
            <LiveTracker />

            <Pitch forecast={forecast} />

            {forecast.scenarios && (
              <Scenarios scenarios={forecast.scenarios} pool={forecast.pool ?? []} />
            )}

            {chips && (
              <div className="flex flex-wrap gap-1.5">
                {chips.map((c) => (
                  <span
                    key={c.name}
                    className={
                      c.remaining > 0 ? "chip chip-accent" : "chip opacity-50 line-through"
                    }
                  >
                    {c.name} {c.remaining > 0 ? `(${c.remaining})` : "used"}
                  </span>
                ))}
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <GameweekReviewModule review={forecast.lastGameweek} />
              <RunningRecordModule record={forecast.runningRecord} />
              <CaptainModule forecast={forecast} />
            </div>

            {forecast.history && <History history={forecast.history} />}

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <ParCalibrationModule calibration={forecast.parCalibration} />
            </div>

            {overrides &&
              overrides.basedOnGw === forecast.basedOnGameweek &&
              overrides.transfers.length > 0 && (
                <p className="font-mono text-[11px] text-ink-faint">
                  pending: {overrides.transfers.map((t) => `out ${t.out} → in ${t.in}`).join(", ")}
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

            {footer}
          </div>
        </Shell>
      </>
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
            <table className="w-full text-sm">
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
                      <div className="flex items-center gap-2">
                        <PositionBadge position={p.position} />
                        <span className="font-medium text-ink">{p.webName}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2 text-ink-soft">{p.team}</td>
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
