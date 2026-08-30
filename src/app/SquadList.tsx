"use client";

import { useState } from "react";
import type { Forecast, ForecastPlayer, Upgrade } from "@/lib/snapshots";
import ProjectionCell from "./ProjectionCell";

const POSITION_COLOR: Record<string, string> = {
  GKP: "bg-[var(--gkp)]",
  DEF: "bg-[var(--def)]",
  MID: "bg-[var(--mid)]",
  FWD: "bg-[var(--fwd)]",
};
const ORDER = ["GKP", "DEF", "MID", "FWD"];

function PositionPill({ position }: { position: string }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-white ${
        POSITION_COLOR[position] ?? "bg-ink-soft"
      }`}
    >
      {position}
    </span>
  );
}

function MinutesRiskTag() {
  return (
    <span
      className="ml-1.5 rounded bg-amber-50 px-1 py-0.5 text-[10px] font-semibold text-amber-800"
      title="Minutes risk: the model puts this player below a safe start probability"
    >
      mins risk
    </span>
  );
}

function Opponents({ player }: { player: ForecastPlayer }) {
  if (player.opponents.length === 0) {
    return <span className="text-[11px] text-ink-soft">blank GW</span>;
  }
  return (
    <span className="text-[11px] text-ink-soft">
      {player.opponents
        .map((o) => `${o.wasHome ? "vs" : "@"} ${o.team ?? "?"} (${o.fdrRating ?? "—"})`)
        .join(" · ")}
    </span>
  );
}

function SuggestionLine({ label, upgrade }: { label: string; upgrade: Upgrade | null }) {
  if (!upgrade) {
    return (
      <div className="flex items-baseline gap-2 text-xs">
        <span className="w-16 shrink-0 text-ink-soft">{label}</span>
        <span className="text-ink-soft">keep — no better option in band</span>
      </div>
    );
  }
  const a = upgrade.alternative;
  return (
    <div className="flex items-baseline gap-2 text-xs">
      <span className="w-16 shrink-0 text-ink-soft">{label}</span>
      <span className="font-medium text-ink">{a.webName}</span>
      <span className="text-ink-soft">{a.team}</span>
      <span className="ml-auto font-semibold text-[var(--pitch-dark)] tabular-nums">
        +{upgrade.gapPoints.toFixed(1)}
      </span>
      <span className="text-[10px] text-ink-soft">/5GW</span>
      <ProjectionCell points={a.projectedPoints} breakdown={a.breakdown} />
    </div>
  );
}

function SquadRow({ player }: { player: ForecastPlayer }) {
  const [open, setOpen] = useState(false);
  const { modelUpgrade: mu, baselineUpgrade: bu } = player;
  const best = Math.max(mu?.gapPoints ?? 0, bu?.gapPoints ?? 0);
  const meaningful = Boolean(mu?.meaningful || bu?.meaningful);
  const agree = Boolean(mu && bu && mu.alternative.id === bu.alternative.id);
  const hasUpgrade = Boolean(mu || bu);

  return (
    <div className="border-b border-line py-1.5 last:border-0">
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center">
            <span className="truncate font-medium text-ink">{player.webName}</span>
            {player.isCaptain && (
              <span
                className="ml-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-[var(--pitch-dark)] text-[9px] font-bold text-white"
                title="Captain (model, this gameweek)"
              >
                C
              </span>
            )}
            {player.minutesRisk && <MinutesRiskTag />}
          </div>
          <Opponents player={player} />
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {hasUpgrade && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${
                meaningful
                  ? "bg-[var(--pitch-light)]/20 text-[var(--pitch-dark)]"
                  : "bg-line text-ink-soft"
              }`}
              title={meaningful ? "Upgrade worth a look" : "Marginal upgrade"}
            >
              ▲ +{best.toFixed(1)} {open ? "▾" : "▸"}
            </button>
          )}
          <ProjectionCell points={player.projectedPoints} breakdown={player.breakdown} />
        </div>
      </div>

      {open && hasUpgrade && (
        <div className="mt-1.5 space-y-1 rounded-lg bg-background p-2">
          <SuggestionLine label="Model" upgrade={mu} />
          <SuggestionLine label="Baseline" upgrade={bu} />
          {agree && (
            <div className="text-[11px] font-semibold text-[var(--pitch-dark)]">
              ✓ model and baseline agree
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function SquadList({ forecast }: { forecast: Forecast }) {
  const { players, windowPoints } = forecast.squad;
  const uc = forecast.upgradeCount;
  const byPosition = ORDER.map((pos) => ({
    pos,
    players: players.filter((p) => p.position === pos),
  })).filter((g) => g.players.length > 0);

  return (
    <div className="rounded-xl border border-line bg-card p-4 shadow-sm">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--pitch-dark)]">
          Your squad
        </h2>
        <span className="text-xs text-ink-soft">
          5-GW proj{" "}
          <span className="font-semibold text-ink tabular-nums">{windowPoints.toFixed(0)}</span>
        </span>
      </div>
      <p className="mt-0.5 text-[11px] text-ink-soft">
        {uc.meaningful > 0
          ? `${uc.meaningful} upgrade${uc.meaningful === 1 ? "" : "s"} worth a look`
          : "no strong upgrade this week"}
        {" · "}
        {uc.model} model / {uc.baseline} baseline flag{uc.baseline === 1 ? "" : "s"}
        {uc.agree > 0 && ` · ${uc.agree} agreed`}
      </p>

      <div className="mt-3 space-y-3">
        {byPosition.map(({ pos, players: group }) => (
          <div key={pos}>
            <div className="mb-1 flex items-center gap-2">
              <PositionPill position={pos} />
              <span className="text-[10px] uppercase tracking-wide text-ink-soft">
                {group.length}
              </span>
            </div>
            <div>
              {group.map((p) => (
                <SquadRow key={p.id} player={p} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
