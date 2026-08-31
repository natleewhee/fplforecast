"use client";

import type { AlternativeCard, Forecast, ForecastPlayer } from "@/lib/snapshots";
import ProjectionCell from "./ProjectionCell";

const POSITION_COLOR: Record<string, string> = {
  GKP: "bg-[var(--gkp)]",
  DEF: "bg-[var(--def)]",
  MID: "bg-[var(--mid)]",
  FWD: "bg-[var(--fwd)]",
};
const ROWS = ["GKP", "DEF", "MID", "FWD"];

const fmtDelta = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}`;

function Opp({ player }: { player: AlternativeCard }) {
  if (player.opponents.length === 0) return <span className="opacity-70">blank</span>;
  return (
    <span className="opacity-80">
      {player.opponents.map((o) => `${o.wasHome ? "v" : "@"}${o.team ?? "?"} ${o.fdrRating ?? "-"}`).join(" ")}
    </span>
  );
}

function PitchPlayer({ player, bench = false }: { player: ForecastPlayer; bench?: boolean }) {
  return (
    <div
      className={`flex w-[4.6rem] flex-col items-center rounded-md px-1 pb-1 pt-0.5 text-center shadow-sm sm:w-20 ${
        bench ? "bg-card/90" : "bg-card"
      }`}
    >
      <div className="flex w-full items-center justify-center gap-0.5">
        <span
          className={`h-1.5 w-1.5 rounded-full ${POSITION_COLOR[player.position] ?? "bg-ink-soft"}`}
        />
        {player.isCaptain && (
          <span className="rounded bg-[var(--pitch-dark)] px-1 text-[8px] font-bold leading-tight text-white">
            C
          </span>
        )}
        {player.isViceCaptain && (
          <span className="rounded bg-ink-soft px-1 text-[8px] font-bold leading-tight text-white">
            V
          </span>
        )}
        {player.minutesRisk && (
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" title="minutes risk" />
        )}
      </div>
      <span className="w-full truncate text-[11px] font-semibold text-ink" title={player.webName}>
        {player.webName}
      </span>
      <span className="text-[9px] leading-tight text-ink-soft">
        <Opp player={player} />
      </span>
      <div className="text-[13px] font-bold leading-tight">
        <ProjectionCell points={player.projectedPoints} breakdown={player.breakdown} />
      </div>
    </div>
  );
}

function AlternativeChip({ alt }: { alt: AlternativeCard }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${
        alt.affordable === false ? "bg-[var(--fwd)]/10" : "bg-background"
      }`}
    >
      <span className="font-medium text-ink">{alt.webName}</span>
      <span className="text-ink-soft">{alt.team}</span>
      {alt.price != null && <span className="text-ink-soft tabular-nums">£{alt.price.toFixed(1)}</span>}
      {typeof alt.gapPoints === "number" && (
        <span className="font-semibold text-[var(--pitch-dark)] tabular-nums">
          +{alt.gapPoints.toFixed(1)}
        </span>
      )}
      {alt.affordable === false && (
        <span className="rounded bg-[var(--fwd)]/20 px-1 text-[10px] font-semibold text-[var(--fwd)]">
          over budget
        </span>
      )}
      <ProjectionCell points={alt.projectedPoints} breakdown={alt.breakdown} />
    </span>
  );
}

export default function Pitch({ forecast }: { forecast: Forecast }) {
  const { players, startingXi, bench, windowPoints } = forecast.squad;
  const byId = new Map(players.map((p) => [p.id, p]));
  const xi = startingXi.map((id) => byId.get(id)).filter(Boolean) as ForecastPlayer[];
  const benched = bench.map((id) => byId.get(id)).filter(Boolean) as ForecastPlayer[];

  const rows = ROWS.map((pos) => xi.filter((p) => p.position === pos)).filter((r) => r.length > 0);

  const withAlternatives = [...players]
    .filter((p) => p.alternatives.length > 0)
    .sort((a, b) => (b.alternatives[0]?.gapPoints ?? 0) - (a.alternatives[0]?.gapPoints ?? 0));

  return (
    <div className="space-y-4 md:grid md:grid-cols-[1fr_20rem] md:gap-4 md:space-y-0">
      <div className="rounded-xl border border-line bg-card p-3 shadow-sm">
        <div className="mb-2 flex items-start justify-between gap-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--pitch-dark)]">
            Recommended XI · GW{forecast.targetGameweek}
          </h2>
          <div className="text-right leading-tight">
            <div className="text-xs text-ink-soft">
              GW{forecast.targetGameweek} proj{" "}
              <span
                className="text-base font-bold text-ink tabular-nums"
                title="Starting XI projected points for the upcoming gameweek, captain doubled"
              >
                {forecast.nextGw.points.toFixed(0)}
              </span>
            </div>
            <div className="text-[10px] text-ink-soft tabular-nums">
              {fmtDelta(forecast.nextGw.deltaVsNoChange)} vs no change ·{" "}
              {fmtDelta(forecast.nextGw.deltaVsBaselineXi)} vs baseline XI
            </div>
            <div className="text-[10px] text-ink-soft tabular-nums">
              5-GW proj {windowPoints.toFixed(0)}
            </div>
          </div>
        </div>

        <div
          className="space-y-3 rounded-lg py-4"
          style={{
            background:
              "repeating-linear-gradient(0deg, var(--pitch) 0 44px, var(--pitch-light) 44px 88px)",
          }}
        >
          {rows.map((row, i) => (
            <div key={i} className="flex flex-wrap justify-center gap-1.5">
              {row.map((p) => (
                <PitchPlayer key={p.id} player={p} />
              ))}
            </div>
          ))}
        </div>

        <div className="mt-3">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-soft">Bench</p>
          <div className="flex flex-wrap gap-1.5">
            {benched.map((p) => (
              <PitchPlayer key={p.id} player={p} bench />
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-line bg-card p-3 shadow-sm">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--pitch-dark)]">
            Transfer alternatives
          </h2>
          <span className="text-xs text-ink-soft">
            Bank <span className="font-semibold text-ink tabular-nums">£{forecast.squad.bank.toFixed(1)}m</span>
          </span>
        </div>
        <p className="mt-0.5 text-[11px] text-ink-soft">
          {forecast.earlySeason
            ? `Early season — only moves gaining ≥ ${forecast.effectiveGap.toFixed(0)} pts over 5 GWs are shown; sell prices assume today's price.`
            : "Same position, within £0.3m · sell prices assume today's price · hover a number for the maths."}
        </p>
        {withAlternatives.length === 0 ? (
          <p className="mt-3 text-sm text-ink-soft">
            No move clears the bar this week — hold your transfer.
          </p>
        ) : (
          <ul className="mt-2 space-y-2.5">
            {withAlternatives.map((p) => (
              <li key={p.id} className="border-b border-line pb-2.5 last:border-0 last:pb-0">
                <div className="flex items-center gap-1.5 text-xs">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${POSITION_COLOR[p.position] ?? "bg-ink-soft"}`}
                  />
                  <span className="font-semibold text-ink">{p.webName}</span>
                  <span className="text-ink-soft">→</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
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
