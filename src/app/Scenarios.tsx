"use client";

import { useState } from "react";
import type { PoolPlayer, Scenario, Scenarios as ScenariosData } from "@/lib/snapshots";
import { kitFor } from "@/lib/teamColors";

const HORIZONS = ["1", "3", "5"] as const;
type Horizon = (typeof HORIZONS)[number];
const ROWS = ["GKP", "DEF", "MID", "FWD"];

function fmtNet(n: number) {
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}`;
}

/** Compact shirt token for a pitch-style XI/bench display -- a lighter
 * cousin of Pitch.tsx's PlayerToken, since scenario players don't carry the
 * full per-GW breakdown/floor-ceiling data that component expects. */
function ShirtToken({ player, isCaptain }: { player: PoolPlayer | undefined; isCaptain: boolean }) {
  if (!player) return null;
  const kit = kitFor(player.team);
  return (
    <div className="flex w-16 flex-col items-center gap-0.5 sm:w-[4.5rem]" title={player.webName}>
      <div className="relative">
        <div
          className="grid h-10 w-10 place-items-center rounded-full ring-1 ring-black/30"
          style={{ background: kit.primary }}
        >
          <span className="font-mono text-[10px] font-bold" style={{ color: kit.ink }}>
            {player.perGameweek[0]?.toFixed(1) ?? "—"}
          </span>
        </div>
        {isCaptain && (
          <span className="absolute -right-1 -top-1 grid h-4 w-4 place-items-center rounded-full bg-[var(--accent)] text-[9px] font-black text-black">
            C
          </span>
        )}
      </div>
      <span className="max-w-[4rem] truncate text-[11px] font-semibold text-ink">
        {player.webName}
      </span>
    </div>
  );
}

function ChipXi({ scenario, poolById }: { scenario: Scenario; poolById: Map<number, PoolPlayer> }) {
  const xi = scenario.xiByGw[0] ?? [];
  const captainId = scenario.captainByGw[0] ?? null;
  const bench = scenario.squad.filter((id) => !xi.includes(id));
  const rows = ROWS.map((pos) =>
    xi.map((id) => poolById.get(id)).filter((p): p is PoolPlayer => !!p && p.position === pos)
  ).filter((r) => r.length);

  return (
    <div className="space-y-3">
      <div
        className="relative overflow-x-auto rounded-xl px-1 py-4"
        style={{ background: "linear-gradient(160deg,#0f5130,#0c3f26 45%,#0a3421)" }}
      >
        <div className="min-w-[280px] space-y-3">
          {rows.map((row, i) => (
            <div key={i} className="flex flex-wrap justify-center gap-x-1.5 gap-y-2">
              {row.map((p) => (
                <ShirtToken key={p.id} player={p} isCaptain={p.id === captainId} />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div>
        <p className="eyebrow mb-1.5">Bench</p>
        <div className="flex flex-wrap gap-x-1.5 gap-y-2 overflow-x-auto">
          {bench.map((id) => (
            <ShirtToken key={id} player={poolById.get(id)} isCaptain={false} />
          ))}
        </div>
      </div>
    </div>
  );
}

function TransferRow({
  label,
  players,
}: {
  label: string;
  players: Scenario["transfersIn"];
}) {
  if (players.length === 0) return null;
  return (
    <div className="flex items-start gap-2 text-xs">
      <span className="w-8 shrink-0 font-mono text-[10px] uppercase tracking-wide text-ink-faint">
        {label}
      </span>
      <div className="flex min-w-0 flex-wrap gap-x-2 gap-y-1">
        {players.map((p) => (
          <span key={p.id} className="whitespace-nowrap text-ink-soft">
            <span className="font-medium text-ink">{p.webName ?? "?"}</span>
            {p.price != null && <span className="ml-1 font-mono tabular-nums">£{p.price.toFixed(1)}</span>}
          </span>
        ))}
      </div>
    </div>
  );
}

function TransferScenarioCard({
  scenario,
  rollNetPoints,
  rank,
}: {
  scenario: Scenario;
  rollNetPoints: number | null;
  rank: number;
}) {
  const nTransfers = scenario.transfersOut.length;
  const label =
    nTransfers === 0 ? "Roll your transfer" : `${nTransfers} transfer${nTransfers > 1 ? "s" : ""}`;
  const vsRoll = rollNetPoints != null ? scenario.netPoints - rollNetPoints : null;

  return (
    <div className="panel rise flex flex-col gap-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="chip chip-accent">
          {rank === 0 ? "Top pick" : `#${rank + 1}`}
        </span>
        <span className="stat text-lg leading-none">{scenario.netPoints.toFixed(1)}</span>
      </div>
      <p className="text-sm font-semibold text-ink">{label}</p>
      {vsRoll != null && (
        <p className={`text-xs ${vsRoll >= 0 ? "text-[var(--accent)]" : "text-[var(--danger)]"}`}>
          {fmtNet(vsRoll)} vs rolling
        </p>
      )}
      {scenario.hitCost > 0 && (
        <p className="text-xs text-[var(--danger)]">−{scenario.hitCost} hit taken</p>
      )}
      <div className="space-y-1 border-t border-line pt-2">
        <TransferRow label="In" players={scenario.transfersIn} />
        <TransferRow label="Out" players={scenario.transfersOut} />
      </div>
    </div>
  );
}

function ChipCard({
  title,
  scenario,
  baselineNetPoints,
  poolById,
}: {
  title: string;
  scenario: Scenario;
  baselineNetPoints: number | null;
  poolById: Map<number, PoolPlayer>;
}) {
  const gain = baselineNetPoints != null ? scenario.netPoints - baselineNetPoints : null;
  return (
    <div className="panel rise space-y-3 p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-mono text-[12px] font-bold tracking-wide text-ink">{title}</h3>
        <div className="text-right">
          <div className="stat text-lg leading-none">{scenario.netPoints.toFixed(1)}</div>
          {gain != null && (
            <div className={`text-[11px] ${gain >= 0 ? "text-[var(--accent)]" : "text-[var(--danger)]"}`}>
              {fmtNet(gain)} vs current squad
            </div>
          )}
        </div>
      </div>
      <ChipXi scenario={scenario} poolById={poolById} />
    </div>
  );
}

export default function Scenarios({ scenarios, pool }: { scenarios: ScenariosData; pool: PoolPlayer[] }) {
  const [horizon, setHorizon] = useState<Horizon>("1");
  const poolById = new Map(pool.map((p) => [p.id, p]));

  const scenariosForHorizon = scenarios.byHorizon[horizon] ?? [];
  const roll = scenariosForHorizon.find((s) => s.transfersOut.length === 0) ?? null;
  const baselineFor1Gw = (scenarios.byHorizon["1"] ?? []).find((s) => s.transfersOut.length === 0);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <h2 className="eyebrow">Transfer scenarios</h2>
        <div className="segment">
          {HORIZONS.map((h) => (
            <button key={h} data-active={horizon === h} onClick={() => setHorizon(h)}>
              {h} GW
            </button>
          ))}
        </div>
      </div>

      <p className="px-1 text-xs text-ink-faint">
        <span className="font-semibold text-ink-soft">{scenarios.freeTransfers.value} FT</span> —{" "}
        {scenarios.freeTransfers.derivation}. Every projection assumes optimal captaincy and XI
        selection each gameweek, so it reads slightly high versus reality.
      </p>

      {scenariosForHorizon.length === 0 ? (
        <p className="px-1 text-sm text-ink-soft">No feasible scenario found for this horizon.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          {scenariosForHorizon.map((s, i) => (
            <TransferScenarioCard
              key={i}
              scenario={s}
              rollNetPoints={roll ? roll.netPoints : null}
              rank={i}
            />
          ))}
        </div>
      )}

      {(scenarios.freeHit || scenarios.wildcard) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {scenarios.freeHit && (
            <ChipCard
              title="FREE HIT"
              scenario={scenarios.freeHit}
              baselineNetPoints={baselineFor1Gw ? baselineFor1Gw.netPoints : null}
              poolById={poolById}
            />
          )}
          {scenarios.wildcard && (
            <ChipCard
              title="WILDCARD"
              scenario={scenarios.wildcard}
              baselineNetPoints={(scenarios.byHorizon["5"] ?? []).find(
                (s) => s.transfersOut.length === 0
              )?.netPoints ?? null}
              poolById={poolById}
            />
          )}
        </div>
      )}
    </section>
  );
}
