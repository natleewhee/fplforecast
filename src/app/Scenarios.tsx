"use client";

import { useState } from "react";
import type { PoolPlayer, Scenario, ScenarioPlayerRef, Scenarios as ScenariosData } from "@/lib/snapshots";
import { availabilityFlag } from "@/lib/availability";
import { OppChip } from "./Pitch";
import { kitFor } from "@/lib/teamColors";

const HORIZONS = ["1", "3", "5"] as const;
type Horizon = (typeof HORIZONS)[number];
const ROWS = ["GKP", "DEF", "MID", "FWD"];

function fmtNet(n: number) {
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}`;
}

/** Compact shirt token for a pitch-style XI/bench display -- a lighter
 * cousin of Pitch.tsx's PlayerToken, since scenario players don't carry the
 * full per-GW breakdown/floor-ceiling data that component expects.
 * `weekIndex` picks which entry of the player's perGameweek/opponents arrays
 * (both aligned to the scenario's horizon, offset 0 = its first gameweek) to
 * show -- lets a multi-week scenario (Wildcard) show any week's number and
 * fixture, not just the first. */
function ShirtToken({
  player,
  isCaptain,
  weekIndex,
}: {
  player: PoolPlayer | undefined;
  isCaptain: boolean;
  weekIndex: number;
}) {
  if (!player) return null;
  const kit = kitFor(player.team);
  const doubt = availabilityFlag(player.availability);
  const xp = player.perGameweek[weekIndex];
  const opponents = player.opponents[weekIndex] ?? [];
  return (
    <div
      className="flex w-16 flex-col items-center gap-0.5 sm:w-[4.5rem]"
      title={[player.webName, doubt?.label].filter(Boolean).join(" — ")}
    >
      <div className="relative">
        <div
          className="grid h-10 w-10 place-items-center rounded-full ring-1 ring-black/30"
          style={{ background: kit.primary }}
        >
          <span className="font-mono text-[10px] font-bold" style={{ color: kit.ink }}>
            {xp != null ? xp.toFixed(1) : "—"}
          </span>
        </div>
        {isCaptain && (
          <span className="absolute -right-1 -top-1 grid h-4 w-4 place-items-center rounded-full bg-[var(--accent)] text-[9px] font-black text-black">
            C
          </span>
        )}
        {doubt && (
          <span
            className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border border-[var(--bg-0)]"
            style={{ background: doubt.color }}
            title={doubt.label}
          />
        )}
      </div>
      <span className="max-w-[4rem] truncate text-[11px] font-semibold text-ink">
        {player.webName}
      </span>
      <OppChip opponents={opponents} />
    </div>
  );
}

/** Zip transfersOut/transfersIn into 1:1 swaps -- squad composition (2 GKP/5
 * DEF/5 MID/3 FWD) stays fixed across any transfer, so grouping by position
 * always yields equal-length in/out lists per position. Sorted by price
 * (desc) within a position so the priciest swap leads. */
function pairTransfers(scenario: Scenario): { out: ScenarioPlayerRef; in_: ScenarioPlayerRef }[] {
  const byPosition = (refs: ScenarioPlayerRef[]) => {
    const groups = new Map<string, ScenarioPlayerRef[]>();
    for (const r of refs) {
      const key = r.position ?? "?";
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
    for (const list of groups.values()) list.sort((a, b) => (b.price ?? 0) - (a.price ?? 0));
    return groups;
  };
  const outByPos = byPosition(scenario.transfersOut);
  const inByPos = byPosition(scenario.transfersIn);
  const pairs: { out: ScenarioPlayerRef; in_: ScenarioPlayerRef }[] = [];
  for (const [pos, outs] of outByPos) {
    const ins = inByPos.get(pos) ?? [];
    outs.forEach((out, i) => {
      if (ins[i]) pairs.push({ out, in_: ins[i] });
    });
  }
  return pairs;
}

function SwapPlayer({ player, direction }: { player: ScenarioPlayerRef; direction: "out" | "in" }) {
  const doubt = availabilityFlag(player.availability);
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      {doubt && (
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: doubt.color }}
          title={doubt.label}
        />
      )}
      <span className={direction === "out" ? "text-ink-soft line-through" : "font-medium text-ink"}>
        {player.webName ?? "?"}
      </span>
      {player.price != null && (
        <span className="font-mono text-[10px] tabular-nums text-ink-faint">
          £{player.price.toFixed(1)}
        </span>
      )}
    </span>
  );
}

function TransferPairs({ scenario }: { scenario: Scenario }) {
  const pairs = pairTransfers(scenario);
  if (pairs.length === 0) return <p className="text-xs text-ink-faint">No changes to your squad</p>;
  return (
    <div className="space-y-1.5">
      {pairs.map(({ out, in_ }) => (
        <div key={`${out.id}-${in_.id}`} className="flex flex-wrap items-center gap-1.5 text-xs">
          <SwapPlayer player={out} direction="out" />
          <span className="text-ink-faint">→</span>
          <SwapPlayer player={in_} direction="in" />
        </div>
      ))}
    </div>
  );
}

function ChipXi({
  scenario,
  poolById,
  weekIndex,
}: {
  scenario: Scenario;
  poolById: Map<number, PoolPlayer>;
  weekIndex: number;
}) {
  const xi = scenario.xiByGw[weekIndex] ?? [];
  const captainId = scenario.captainByGw[weekIndex] ?? null;
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
                <ShirtToken key={p.id} player={p} isCaptain={p.id === captainId} weekIndex={weekIndex} />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div>
        <p className="eyebrow mb-1.5">Bench</p>
        <div className="flex flex-wrap gap-x-1.5 gap-y-2 overflow-x-auto">
          {bench.map((id) => (
            <ShirtToken key={id} player={poolById.get(id)} isCaptain={false} weekIndex={weekIndex} />
          ))}
        </div>
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
      {nTransfers > 0 && (
        <div className="border-t border-line pt-2">
          <TransferPairs scenario={scenario} />
        </div>
      )}
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
  const [weekIndex, setWeekIndex] = useState(0);
  const gain = baselineNetPoints != null ? scenario.netPoints - baselineNetPoints : null;
  const weeks = scenario.weeks;
  const activeWeek = weeks[Math.min(weekIndex, weeks.length - 1)];

  return (
    <div className="panel rise space-y-3 p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-mono text-[12px] font-bold tracking-wide text-ink">{title}</h3>
        <div className="text-right">
          <div className="stat text-lg leading-none">{scenario.netPoints.toFixed(1)}</div>
          <div className="text-[11px] text-ink-faint">
            total over {scenario.horizonGws} GW{scenario.horizonGws > 1 ? "s" : ""}
          </div>
          {gain != null && (
            <div className={`text-[11px] ${gain >= 0 ? "text-[var(--accent)]" : "text-[var(--danger)]"}`}>
              {fmtNet(gain)} vs current squad
            </div>
          )}
        </div>
      </div>

      {weeks.length > 1 && (
        <div className="flex items-center justify-between gap-2">
          <div className="segment">
            {weeks.map((w, i) => (
              <button key={w.targetGw} data-active={i === weekIndex} onClick={() => setWeekIndex(i)}>
                GW{w.targetGw}
              </button>
            ))}
          </div>
          {activeWeek && (
            <span className="font-mono text-xs text-ink-faint">{activeWeek.totalXp.toFixed(1)} this GW</span>
          )}
        </div>
      )}

      <ChipXi scenario={scenario} poolById={poolById} weekIndex={weekIndex} />
    </div>
  );
}

export default function Scenarios({ scenarios, pool }: { scenarios: ScenariosData; pool: PoolPlayer[] }) {
  const [horizon, setHorizon] = useState<Horizon>("1");
  const poolById = new Map(pool.map((p) => [p.id, p]));

  const scenariosForHorizon = scenarios.byHorizon[horizon] ?? [];
  const roll = scenariosForHorizon.find((s) => s.transfersOut.length === 0) ?? null;
  const baselineFor1Gw = (scenarios.byHorizon["1"] ?? []).find((s) => s.transfersOut.length === 0);
  const wildcardForHorizon = scenarios.wildcard?.[horizon] ?? null;
  const rollForHorizon = roll ? roll.netPoints : null;

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

      {(scenarios.freeHit || wildcardForHorizon) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {scenarios.freeHit && (
            <ChipCard
              title="FREE HIT"
              scenario={scenarios.freeHit}
              baselineNetPoints={baselineFor1Gw ? baselineFor1Gw.netPoints : null}
              poolById={poolById}
            />
          )}
          {wildcardForHorizon && (
            <ChipCard
              key={horizon}
              title={`WILDCARD — ${horizon} GW`}
              scenario={wildcardForHorizon}
              baselineNetPoints={rollForHorizon}
              poolById={poolById}
            />
          )}
        </div>
      )}
    </section>
  );
}
