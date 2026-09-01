"use client";

import { useState } from "react";
import type { AlternativeCard, Forecast, ForecastPlayer } from "@/lib/snapshots";
import ProjectionCell from "./ProjectionCell";

type ViewMode = "model" | "baseline" | "yours";

const MODE_LABEL: Record<ViewMode, string> = {
  model: "Model XI",
  baseline: "Baseline XI",
  yours: "Your XI",
};

const POSITION_COLOR: Record<string, string> = {
  GKP: "bg-[var(--gkp)]",
  DEF: "bg-[var(--def)]",
  MID: "bg-[var(--mid)]",
  FWD: "bg-[var(--fwd)]",
};
const ROWS = ["GKP", "DEF", "MID", "FWD"];

const fmtDelta = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}`;

function Opp({ player }: { player: AlternativeCard }) {
  if (player.opponents.length === 0)
    return <span className="text-ink-faint">— blank —</span>;
  return (
    <span className="text-ink-soft">
      {player.opponents
        .map((o) => `${o.wasHome ? "v" : "@"}${o.team ?? "?"} ${o.fdrRating ?? "-"}`)
        .join("  ")}
    </span>
  );
}

function PitchPlayer({
  player,
  bench = false,
  isCaptain = false,
  isViceCaptain = false,
}: {
  player: ForecastPlayer;
  bench?: boolean;
  isCaptain?: boolean;
  isViceCaptain?: boolean;
}) {
  return (
    <div
      className={`token flex flex-col items-center px-1 pb-1 pt-1 text-center ${
        isCaptain ? "token-captain" : ""
      } ${bench ? "w-[3.9rem] sm:w-16" : "w-[4.5rem] sm:w-[4.75rem]"}`}
      title={player.rationale}
    >
      <div className="flex w-full items-center justify-center gap-1">
        <span
          className={`h-1.5 w-1.5 rounded-full ${POSITION_COLOR[player.position] ?? "bg-ink-soft"}`}
        />
        {isCaptain && (
          <span className="rounded bg-[var(--accent)] px-1 text-[8px] font-black leading-tight text-black">
            C
          </span>
        )}
        {isViceCaptain && (
          <span className="rounded bg-[var(--border-strong)] px-1 text-[8px] font-black leading-tight text-ink">
            V
          </span>
        )}
        {player.minutesRisk && (
          <span
            className="h-1.5 w-1.5 rounded-full bg-[var(--warn)]"
            title="minutes risk"
          />
        )}
      </div>
      <span
        className="mt-0.5 w-full truncate text-[11px] font-semibold text-ink"
        title={player.webName}
      >
        {player.webName}
      </span>
      <span className="font-mono text-[8.5px] leading-tight tracking-tight">
        <Opp player={player} />
      </span>
      <div className="mt-0.5 text-[13px] font-bold leading-none">
        <ProjectionCell points={player.projectedPoints} breakdown={player.breakdown} />
      </div>
    </div>
  );
}

function AlternativeChip({ alt }: { alt: AlternativeCard }) {
  const over = alt.affordable === false;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] ${
        over
          ? "border-[color-mix(in_srgb,var(--danger)_40%,transparent)] bg-[color-mix(in_srgb,var(--danger)_10%,transparent)]"
          : "border-line bg-white/[0.04]"
      }`}
    >
      <span className="font-semibold text-ink">{alt.webName}</span>
      <span className="text-ink-faint">{alt.team}</span>
      {alt.price != null && (
        <span className="font-mono tabular-nums text-ink-soft">£{alt.price.toFixed(1)}</span>
      )}
      {typeof alt.gapPoints === "number" && (
        <span className="font-mono font-bold tabular-nums text-[var(--accent)]">
          +{alt.gapPoints.toFixed(1)}
        </span>
      )}
      {over && (
        <span className="rounded bg-[color-mix(in_srgb,var(--danger)_22%,transparent)] px-1 text-[9px] font-bold uppercase tracking-wide text-[var(--danger)]">
          over
        </span>
      )}
      <ProjectionCell points={alt.projectedPoints} breakdown={alt.breakdown} />
    </span>
  );
}

export default function Pitch({ forecast }: { forecast: Forecast }) {
  const { squad } = forecast;
  const { players, windowPoints } = squad;
  const [mode, setMode] = useState<ViewMode>("model");
  const byId = new Map(players.map((p) => [p.id, p]));

  const LINEUPS: Record<ViewMode, { xi: number[]; bench: number[]; captainId: number | null }> = {
    model: { xi: squad.startingXi, bench: squad.bench, captainId: forecast.captain?.id ?? null },
    baseline: { xi: squad.baselineXi, bench: squad.baselineBench, captainId: squad.baselineCaptainId },
    yours: { xi: squad.yourXi, bench: squad.yourBench, captainId: squad.yourCaptainId },
  };
  const active = LINEUPS[mode];
  const viceId = mode === "model" ? forecast.viceCaptain?.id ?? null : null;

  const xi = active.xi.map((id) => byId.get(id)).filter(Boolean) as ForecastPlayer[];
  const benched = active.bench.map((id) => byId.get(id)).filter(Boolean) as ForecastPlayer[];
  const rows = ROWS.map((pos) => xi.filter((p) => p.position === pos)).filter((r) => r.length > 0);

  // All three lineups are scored on the model's projections, so the headline
  // moves with the toggle and the deltas stay comparable.
  const headline =
    mode === "model"
      ? forecast.nextGw.points
      : mode === "baseline"
        ? forecast.nextGw.points - forecast.nextGw.deltaVsBaselineXi
        : forecast.nextGw.points - forecast.nextGw.deltaVsNoChange;
  const vsModel = headline - forecast.nextGw.points;

  const withAlternatives = [...players]
    .filter((p) => p.alternatives.length > 0)
    .sort((a, b) => (b.alternatives[0]?.gapPoints ?? 0) - (a.alternatives[0]?.gapPoints ?? 0));

  return (
    <div className="space-y-4 md:grid md:grid-cols-[1fr_20rem] md:gap-4 md:space-y-0">
      <div className="panel rise p-4">
        {/* header: mode + HUD numbers */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-mono text-[13px] font-bold tracking-[0.12em] text-ink">
              {MODE_LABEL[mode].toUpperCase()}
            </h2>
            <p className="eyebrow mt-0.5">Gameweek {forecast.targetGameweek}</p>
          </div>
          <div className="shrink-0 text-right">
            <div
              className="stat stat-glow text-2xl leading-none sm:text-3xl"
              title="Starting XI projected points for the upcoming gameweek, captain doubled"
            >
              {headline.toFixed(0)}
            </div>
            <div className="eyebrow mt-1">proj pts</div>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {mode === "model" ? (
            <>
              <span className="chip">{fmtDelta(forecast.nextGw.deltaVsNoChange)} vs no change</span>
              <span className="chip">
                {fmtDelta(forecast.nextGw.deltaVsBaselineXi)} vs baseline
              </span>
            </>
          ) : (
            <span className={vsModel >= 0 ? "chip chip-accent" : "chip chip-danger"}>
              {fmtDelta(vsModel)} vs model XI
            </span>
          )}
          <span className="chip">5-GW {windowPoints.toFixed(0)}</span>
        </div>

        {/* segmented control */}
        <div className="mt-3 flex items-center justify-between gap-2">
          <div className="segment">
            {(Object.keys(MODE_LABEL) as ViewMode[]).map((m) => (
              <button key={m} data-active={mode === m} onClick={() => setMode(m)}>
                {MODE_LABEL[m]}
              </button>
            ))}
          </div>
        </div>
        <p className="mt-2 font-mono text-[10px] leading-relaxed text-ink-faint [overflow-wrap:anywhere]">
          model &amp; baseline agree on {forecast.lineupAgreement}/11 starters · all lineups scored on
          model points
        </p>

        {/* broadcast pitch */}
        <div className="turf mt-3 space-y-3 px-2 py-5">
          {rows.map((row, i) => (
            <div key={i} className="relative z-[1] flex flex-wrap justify-center gap-2">
              {row.map((p) => (
                <PitchPlayer
                  key={p.id}
                  player={p}
                  isCaptain={p.id === active.captainId}
                  isViceCaptain={p.id === viceId}
                />
              ))}
            </div>
          ))}
        </div>

        {/* bench */}
        <div className="mt-3">
          <p className="eyebrow mb-1.5">Bench</p>
          <div className="flex flex-wrap gap-2">
            {benched.map((p) => (
              <PitchPlayer key={p.id} player={p} bench isCaptain={p.id === active.captainId} />
            ))}
          </div>
        </div>

        {mode === "model" && benched.some((p) => p.rationale) && (
          <ul className="mt-3 space-y-1 border-t border-line pt-3 font-mono text-[10.5px] leading-relaxed text-ink-faint [overflow-wrap:anywhere]">
            {benched
              .filter((p) => p.rationale)
              .map((p) => (
                <li key={p.id}>
                  <span className="text-ink-soft">{p.webName}</span> benched — {p.rationale}
                </li>
              ))}
          </ul>
        )}
      </div>

      {/* transfer alternatives */}
      <div className="panel rise p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="font-mono text-[13px] font-bold tracking-[0.12em] text-ink">
              TRANSFERS
            </h2>
            <p className="eyebrow mt-0.5">same slot · in band</p>
          </div>
          <div className="text-right">
            <div className="stat text-lg leading-none text-ink">
              £{forecast.squad.bank.toFixed(1)}
            </div>
            <div className="eyebrow mt-0.5">bank</div>
          </div>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-ink-soft">
          {forecast.earlySeason
            ? `Early season — only moves gaining ≥ ${forecast.effectiveGap.toFixed(
                0,
              )} pts / 5 GWs shown. Sell prices assume today's price.`
            : "Within £0.3m, same position. Sell prices assume today's price · hover a number for the maths."}
        </p>
        {withAlternatives.length === 0 ? (
          <p className="mt-4 rounded-lg border border-line bg-white/[0.03] p-3 text-center text-xs text-ink-soft">
            No move clears the bar this week — hold your transfer.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {withAlternatives.map((p) => (
              <li key={p.id} className="border-b border-line pb-3 last:border-0 last:pb-0">
                <div className="flex items-center gap-1.5 text-xs">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      POSITION_COLOR[p.position] ?? "bg-ink-soft"
                    }`}
                  />
                  <span className="font-semibold text-ink">{p.webName}</span>
                  <span className="text-ink-faint">→</span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {p.alternatives.map((a) => (
                    <AlternativeChip key={a.id} alt={a} />
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
