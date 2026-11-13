"use client";

import { useState } from "react";
import Carousel from "./Carousel";
import type {
  ChipWindow,
  FreeHitWeek,
  ForecastPlayer,
  PlanWeek,
  PoolPlayer,
  Scenario,
  ScenarioPlayerRef,
  ScenarioWeek,
  Scenarios as ScenariosData,
  UpcomingGameweek,
} from "@/lib/snapshots";
import { availabilityFlag } from "@/lib/availability";
import { OppChip, riskBadges } from "./Pitch";
import { bestWithinWindow, chipState, type ChipState } from "@/lib/chips";
import { PitchScene } from "./PitchScene";
import { FormBars, Halo, meanFdr } from "./Shirt";
import { PlayerFace } from "./PlayerFace";
import Pitch3D, { type Pitch3DPlayer } from "./pitch3d/Pitch3D";
import { markPitch3dUnavailable, useShownPitchView } from "@/lib/pitchView";
import { ArmbandBadge } from "./tokenParts";

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
  const doubt = availabilityFlag(player.availability);
  const xp = player.perGameweek[weekIndex];
  const opponents = player.opponents[weekIndex] ?? [];
  const w = 44;
  return (
    <div
      data-flip={player.id}
      className="flex min-w-0 max-w-16 flex-1 basis-0 flex-col items-center gap-0.5 sm:max-w-[4.5rem]"
      title={[player.webName, doubt?.label].filter(Boolean).join(" \u2014 ")}
    >
      <div className="relative" style={{ width: w, height: Math.round((w * 52) / 56) }}>
        <Halo fdr={meanFdr(opponents)} width={w} />
        <PlayerFace
          team={player.team}
          position={player.position}
          code={player.code}
          width={w}
          label={xp != null ? xp.toFixed(1) : "\u2014"}
          progress={xp != null ? xp / 11 : 0}
          badges={riskBadges(player.availability, undefined)}
        />
        {isCaptain && <ArmbandBadge role="captain" />}
      </div>
      <span className="mt-1 max-w-full truncate text-xs font-semibold text-ink [text-shadow:0_1px_3px_rgba(0,0,0,0.85)]">
        {player.webName}
      </span>
      <FormBars points={player.recentPoints} />
      <OppChip opponents={opponents} />
    </div>
  );
}

/** Zip transfersOut/transfersIn into 1:1 swaps -- squad composition (2 GKP/5
 * DEF/5 MID/3 FWD) stays fixed across any transfer, so grouping by position
 * always yields equal-length in/out lists per position. Sorted by price
 * (desc) within a position so the priciest swap leads. */
function pairTransfers(transfers: {
  transfersIn: ScenarioPlayerRef[];
  transfersOut: ScenarioPlayerRef[];
}): { out: ScenarioPlayerRef; in_: ScenarioPlayerRef }[] {
  const byPosition = (refs: ScenarioPlayerRef[]) => {
    const groups = new Map<string, ScenarioPlayerRef[]>();
    for (const r of refs) {
      const key = r.position ?? "?";
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
    for (const list of groups.values()) list.sort((a, b) => (b.price ?? 0) - (a.price ?? 0));
    return groups;
  };
  const outByPos = byPosition(transfers.transfersOut);
  const inByPos = byPosition(transfers.transfersIn);
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
        <span className="font-mono text-xs tabular-nums text-ink-faint">
          £{player.price.toFixed(1)}
        </span>
      )}
    </span>
  );
}

function TransferPairs({
  transfersIn,
  transfersOut,
}: {
  transfersIn: ScenarioPlayerRef[];
  transfersOut: ScenarioPlayerRef[];
}) {
  const pairs = pairTransfers({ transfersIn, transfersOut });
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

/** The pitch + bench view for one gameweek of a squad -- shared by the
 * chip cards, the "show squad for these GWs" disclosure on a transfer
 * scenario, and the multi-week plan timeline. `weekIndex` is the absolute
 * offset from the forecast's own first gameweek (0 = forecastGw), which is
 * what indexes into a `PoolPlayer`'s `perGameweek`/`opponents` arrays --
 * not necessarily the same as a position within `xi`/`squad`'s own horizon. */
function XiPitch({
  squad,
  xi,
  captainId,
  poolById,
  weekIndex,
}: {
  squad: number[];
  xi: number[];
  captainId: number | null;
  poolById: Map<number, PoolPlayer>;
  weekIndex: number;
}) {
  const view = useShownPitchView();
  const bench = squad.filter((id) => !xi.includes(id));
  if (view === "3d") {
    const to3d = (p: PoolPlayer): Pitch3DPlayer => {
      const xp = p.perGameweek[weekIndex];
      const doubt = availabilityFlag(p.availability);
      return {
        id: p.id,
        webName: p.webName,
        position: p.position,
        team: p.team,
        code: p.code,
        sub: xp != null ? xp.toFixed(1) : "\u2014",
        role: p.id === captainId ? "C" : null,
        ariaLabel: `${p.webName}: ${xp != null ? xp.toFixed(1) : "no"} xP${doubt ? `, ${doubt.label}` : ""}`,
        title: [p.webName, doubt?.label].filter(Boolean).join(" \u2014 "),
        badges: riskBadges(p.availability, undefined),
      };
    };
    const byPos = (ids: number[]) => ids.map((id) => poolById.get(id)).filter((p): p is PoolPlayer => !!p);
    return <Pitch3D xi={byPos(xi).map(to3d)} bench={byPos(bench).map((p, _i, all) => ({ ...to3d(p), benchOrder: all.filter((b) => b.position !== "GKP").indexOf(p) + 1 }))} onUnavailable={markPitch3dUnavailable} compact />;
  }
  const rows = ROWS.map((pos) =>
    xi.map((id) => poolById.get(id)).filter((p): p is PoolPlayer => !!p && p.position === pos)
  ).filter((r) => r.length);

  return (
    <div className="space-y-3">
      <PitchScene compact>
        <div className="space-y-3">
          {rows.map((row, i) => (
            <div key={i} className="flex justify-center gap-x-1 gap-y-2">
              {row.map((p) => (
                <ShirtToken key={p.id} player={p} isCaptain={p.id === captainId} weekIndex={weekIndex} />
              ))}
            </div>
          ))}
        </div>
      </PitchScene>
      <div>
        <p className="eyebrow mb-1.5">Bench</p>
        <div className="flex gap-x-1 gap-y-2">
          {bench.map((id) => (
            <ShirtToken key={id} player={poolById.get(id)} isCaptain={false} weekIndex={weekIndex} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** A GW picker (when there's more than one week) plus that week's XiPitch --
 * `weeks`/`xiByGw`/`captainByGw` are index-aligned (position i = the i-th
 * gameweek of this scenario's own horizon, itself starting at the forecast's
 * own first gameweek, so the picker's index doubles as XiPitch's absolute
 * weekIndex). */
function WeeklyXi({
  weeks,
  squad,
  xiByGw,
  captainByGw,
  poolById,
}: {
  weeks: ScenarioWeek[];
  squad: number[];
  xiByGw: number[][];
  captainByGw: (number | null)[];
  poolById: Map<number, PoolPlayer>;
}) {
  const [weekIndex, setWeekIndex] = useState(0);
  const activeWeek = weeks[Math.min(weekIndex, weeks.length - 1)];

  return (
    <div className="space-y-3">
      {weeks.length > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* overflow-x-auto, not flex-wrap, on the segment itself -- a long
             horizon (Wildcard's 7 GW) fits more GW buttons than a phone is
             wide; scrolling the pill row keeps it a single line instead of
             wrapping into two, or pushing the page wider. */}
          {/* A scrolling segment clips at its padding, so the pills are 2px taller here to keep a
             44px tap area inside it, and overflow-y-hidden stops a 1px vertical scroll. */}
          <div className="segment max-w-full overflow-x-auto overflow-y-hidden [&>button]:min-h-[38px]">
            {weeks.map((w, i) => (
              <button
                key={w.targetGw}
                data-active={i === weekIndex}
                onClick={() => setWeekIndex(i)}
                className="shrink-0"
              >
                GW{w.targetGw}
              </button>
            ))}
          </div>
          {activeWeek && (
            <span className="font-mono text-xs text-ink-faint">{activeWeek.totalXp.toFixed(1)} this GW</span>
          )}
        </div>
      )}
      <XiPitch
        squad={squad}
        xi={xiByGw[weekIndex] ?? []}
        captainId={captainByGw[weekIndex] ?? null}
        poolById={poolById}
        weekIndex={weekIndex}
      />
    </div>
  );
}

function TransferScenarioCard({
  scenario,
  rollNetPoints,
  rank,
  poolById,
}: {
  scenario: Scenario;
  rollNetPoints: number | null;
  rank: number;
  poolById: Map<number, PoolPlayer>;
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
          <TransferPairs transfersIn={scenario.transfersIn} transfersOut={scenario.transfersOut} />
        </div>
      )}
      {scenario.weeks.length > 1 && (
        <details className="border-t border-line pt-2">
          <summary className="cursor-pointer text-xs font-medium text-ink-soft">
            Show my squad over these {scenario.weeks.length} GWs
          </summary>
          <div className="mt-2">
            <WeeklyXi
              weeks={scenario.weeks}
              squad={scenario.squad}
              xiByGw={scenario.xiByGw}
              captainByGw={scenario.captainByGw}
              poolById={poolById}
            />
          </div>
        </details>
      )}
    </div>
  );
}

function ChipCard({
  title,
  scenario,
  baselineNetPoints,
  poolById,
  showXi,
  onToggleXi,
}: {
  title: string;
  scenario: Scenario;
  baselineNetPoints: number | null;
  poolById: Map<number, PoolPlayer>;
  showXi: boolean;
  onToggleXi: () => void;
}) {
  const gain = baselineNetPoints != null ? scenario.netPoints - baselineNetPoints : null;
  // The numbers stay on show; the XI (a whole pitch) opens on tap (state lives in ChipToggle).

  return (
    <div className="panel rise space-y-3 p-3" data-testid="chip-card">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-mono text-[12px] font-bold tracking-wide text-ink">{title}</h3>
        <div className="text-right">
          <div className="stat text-lg leading-none">{scenario.netPoints.toFixed(1)}</div>
          <div className="text-xs text-ink-faint">
            total over {scenario.horizonGws} GW{scenario.horizonGws > 1 ? "s" : ""}
          </div>
          {gain != null && (
            <div className={`text-xs ${gain >= 0 ? "text-[var(--accent)]" : "text-[var(--danger)]"}`}>
              {fmtNet(gain)} vs current squad
            </div>
          )}
        </div>
      </div>

      <button
        type="button"
        aria-expanded={showXi}
        onClick={onToggleXi}
        className="flex min-h-11 w-full items-center justify-between rounded-lg border border-line px-2.5 text-left text-xs font-medium text-ink-soft"
      >
        <span>{showXi ? "Hide the XI" : "Show the XI"}</span>
        <span aria-hidden className="text-ink-faint">{showXi ? "▾" : "▸"}</span>
      </button>
      {showXi && (
        <WeeklyXi
          weeks={scenario.weeks}
          squad={scenario.squad}
          xiByGw={scenario.xiByGw}
          captainByGw={scenario.captainByGw}
          poolById={poolById}
        />
      )}
    </div>
  );
}

type LockState = "keep" | "remove";

/** Force-keep/force-remove a squad player, then re-solve live via
 * /api/solve.py -- the one thing that can't be precomputed at build time,
 * since a pick is one of 15 players x keep/remove and there's no bounding
 * that combinatorially. Everything else on this page is static JSON; this
 * panel is the sole live network call. */
/** Positions, clubs, names and prices only matter server-side for a player who has left the
 * league (no pool row); prices otherwise come from the pool. */
export type GuestTeam = {
  squad: { id: number; position?: string; team?: string; webName?: string; price?: number }[];
  bank: number;
  freeTransfers: number;
};

function ForceLockPanel({
  squad,
  forecastGw,
  horizon,
  guestTeam,
}: {
  squad: ForecastPlayer[];
  forecastGw: number;
  horizon: Horizon;
  guestTeam: GuestTeam | null;
}) {
  const [locks, setLocks] = useState<Map<number, LockState>>(new Map());
  const [result, setResult] = useState<Scenario | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  // Collapsed with `hidden`, not unmounted, so the pins survive a close.
  const [open, setOpen] = useState(false);

  const cycleLock = (id: number) => {
    setLocks((prev) => {
      const next = new Map(prev);
      const current = next.get(id);
      if (current === undefined) next.set(id, "keep");
      else if (current === "keep") next.set(id, "remove");
      else next.delete(id);
      return next;
    });
    setResult(null);
    setStatus("idle");
  };

  const solve = async () => {
    setStatus("loading");
    setError(null);
    try {
      const forceIn = [...locks.entries()].filter(([, v]) => v === "keep").map(([id]) => id);
      const forceOut = [...locks.entries()].filter(([, v]) => v === "remove").map(([id]) => id);
      const res = await fetch("/api/solve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          forecastGw,
          type: "transfer",
          horizon: Number(horizon),
          forceIn,
          forceOut,
          ...(guestTeam ? { team: guestTeam } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `solve failed (${res.status})`);
      setResult(data as Scenario);
      setStatus("idle");
    } catch (e) {
      setError(e instanceof Error ? e.message : "solve failed");
      setStatus("error");
    }
  };

  return (
    <div className="panel space-y-3 p-3">
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls="force-lock-body"
          onClick={() => setOpen((v) => !v)}
          className="flex min-h-11 w-full items-center justify-between gap-2 text-left"
        >
          <span className="eyebrow">Pin players ({locks.size})</span>
          <span className="text-xs text-ink-faint">
            Force keep / remove <span aria-hidden>{open ? "▾" : "▸"}</span>
          </span>
        </button>
      </h3>
      <div id="force-lock-body" hidden={!open} className="space-y-3">
      <p className="text-xs text-ink-faint">Tap a player: keep -&gt; remove -&gt; clear</p>
      <div className="flex flex-wrap gap-1.5">
        {squad.map((p) => {
          const lock = locks.get(p.id);
          return (
            <button
              key={p.id}
              onClick={() => cycleLock(p.id)}
              className="min-h-11 rounded-full border px-3 py-1 text-xs font-medium transition-colors"
              style={
                lock === "keep"
                  ? { borderColor: "var(--accent)", color: "var(--accent)", background: "color-mix(in srgb, var(--accent) 14%, transparent)" }
                  : lock === "remove"
                  ? { borderColor: "var(--danger)", color: "var(--danger)", background: "color-mix(in srgb, var(--danger) 14%, transparent)", textDecoration: "line-through" }
                  : { borderColor: "var(--border)", color: "var(--ink-soft)" }
              }
            >
              {p.webName}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-2">
        <button
          className="min-h-11 rounded-lg bg-gradient-to-b from-[var(--accent)] to-[#23c78c] px-3 py-1.5 text-xs font-bold text-black shadow-[0_0_20px_var(--accent-glow)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:bg-none disabled:bg-white/5 disabled:text-ink-faint disabled:shadow-none"
          disabled={locks.size === 0 || status === "loading"}
          onClick={solve}
        >
          {status === "loading" ? "Solving…" : `Solve with ${locks.size} pin${locks.size === 1 ? "" : "s"}`}
        </button>
        {locks.size > 0 && (
          <button className="min-h-11 px-2 text-xs text-ink-faint underline" onClick={() => { setLocks(new Map()); setResult(null); }}>
            clear
          </button>
        )}
      </div>
      </div>
      {status === "error" && <p role="alert" className="text-xs text-[var(--danger)]">{error}</p>}
      {result && (
        <div className="border-t border-line pt-2">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-sm font-semibold text-ink">Custom scenario</span>
            <span className="stat text-base leading-none">{result.netPoints.toFixed(1)}</span>
          </div>
          {result.hitCost > 0 && (
            <p className="mb-1.5 text-xs text-[var(--danger)]">−{result.hitCost} hit taken</p>
          )}
          <TransferPairs transfersIn={result.transfersIn} transfersOut={result.transfersOut} />
        </div>
      )}
    </div>
  );
}

/** One week's row in the multi-week plan timeline: a GW badge, the
 * transfer(s) made that week (or "Hold"), hit cost if any, and the FT
 * banked before/after. Tapping it opens that week's full XI. */
function PlanWeekRow({
  week,
  isOpen,
  onToggle,
  forecastGw,
  poolById,
}: {
  week: PlanWeek;
  isOpen: boolean;
  onToggle: () => void;
  forecastGw: number;
  poolById: Map<number, PoolPlayer>;
}) {
  const nTransfers = week.transfersOut.length;
  const captainId = week.xi.find((p) => p.isCaptain)?.id ?? null;

  return (
    <div className="rounded-lg border border-line">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        data-testid={`plan-row-${week.targetGw}`}
        className="flex min-h-11 w-full items-center justify-between gap-2 px-2.5 py-2 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-bold text-ink">GW{week.targetGw}</span>
          <span className="text-xs text-ink-soft">
            {nTransfers === 0 ? "Hold" : `${nTransfers} transfer${nTransfers > 1 ? "s" : ""}`}
          </span>
          {week.hitCost > 0 && (
            <span className="text-xs text-[var(--danger)]">−{week.hitCost}</span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-ink-faint">
          <span>{week.ftBefore} FT → {week.ftAfter} FT</span>
          <span className="font-mono text-xs font-semibold text-[var(--accent)]">
            {week.weekXp.toFixed(1)}
          </span>
          <span aria-hidden className="text-ink-faint">{isOpen ? "▾" : "▸"}</span>
        </div>
      </button>
      {isOpen && (
        <div className="space-y-2 border-t border-line p-2.5">
          {nTransfers > 0 && (
            <TransferPairs transfersIn={week.transfersIn} transfersOut={week.transfersOut} />
          )}
          <XiPitch
            squad={week.squad}
            xi={week.xi.map((p) => p.id)}
            captainId={captainId}
            poolById={poolById}
            weekIndex={week.targetGw - forecastGw}
          />
        </div>
      )}
    </div>
  );
}

/** A week-by-week transfer plan, letting FT get spent unevenly across the
 * window (e.g. 1 transfer this week, bank the rest, 2 next week) rather
 * than the single up-front decision the horizon toggle above models. Rows
 * collapse by default -- 5 weeks of full pitches at once would be a lot of
 * scrolling for what's meant to be a skimmable itinerary. */
function PlanTimeline({
  plan,
  forecastGw,
  poolById,
}: {
  plan: PlanWeek[];
  forecastGw: number;
  poolById: Map<number, PoolPlayer>;
}) {
  const [openGw, setOpenGw] = useState<number | null>(null);
  const feasibleWeeks = plan.filter((w) => w.feasible);
  if (feasibleWeeks.length === 0) return null;

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <h2 className="eyebrow">Multi-week plan</h2>
        <span className="text-xs text-ink-faint">spend FT unevenly across the window</span>
      </div>
      <div className="space-y-1.5">
        {feasibleWeeks.map((week) => (
          <PlanWeekRow
            key={week.targetGw}
            week={week}
            isOpen={openGw === week.targetGw}
            onToggle={() => setOpenGw((prev) => (prev === week.targetGw ? null : week.targetGw))}
            forecastGw={forecastGw}
            poolById={poolById}
          />
        ))}
      </div>
      <p className="px-1 text-xs text-ink-faint">
        Each week is solved as if it were the only decision — it takes whatever transfer(s) pay off
        that week alone, not the biggest swing over the whole window, and a bought-in player&rsquo;s
        future sell price is assumed equal to what you paid (no profit-taking modelled).
      </p>
    </section>
  );
}

// Wildcard rebuilds the whole squad with no held constraint, so unlike the
// pinned-transfer-count byHorizon scenarios (capped at 5 -- a longer pinned
// horizon would need the multi-week planner's chained-week approach instead
// of blowing up a one-shot solve's variable count), it can offer a longer,
// Wildcard-only 7-GW option. Kept as its own horizon, independent of the
// main transfer-scenario horizon toggle above.
const WILDCARD_HORIZONS = ["1", "3", "5", "7"] as const;
type WildcardHorizon = (typeof WILDCARD_HORIZONS)[number];

/** Free Hit and Wildcard used to render side by side -- each is a full pitch
 * view, so together they made this the tallest section on the page. Shown
 * one at a time behind a toggle instead; defaults to whichever chip is
 * actually available when only one is. */
function ChipToggle({
  freeHit,
  wildcardByHorizon,
  byHorizon,
  baselineFor1Gw,
  poolById,
}: {
  freeHit: Scenario | null;
  wildcardByHorizon: Record<string, Scenario> | null;
  byHorizon: Record<string, Scenario[]>;
  baselineFor1Gw: number | null;
  poolById: Map<number, PoolPlayer>;
}) {
  const [which, setWhich] = useState<"freeHit" | "wildcard">(freeHit ? "freeHit" : "wildcard");
  const [wildcardHorizon, setWildcardHorizon] = useState<WildcardHorizon>("1");
  const [showXi, setShowXi] = useState(false); // survives a horizon switch (ChipCard is re-keyed)
  const showToggle = freeHit && wildcardByHorizon;
  const active = which === "freeHit" && freeHit ? "freeHit" : wildcardByHorizon ? "wildcard" : "freeHit";
  const wildcard = wildcardByHorizon?.[wildcardHorizon] ?? null;
  // A "roll" (0-transfer) baseline only exists at 1/3/5 (byHorizon's own
  // range) -- at 7 GW there's nothing to compare against, so the gain line
  // just doesn't render (ChipCard already handles a null baseline).
  const rollAtWildcardHorizon = (byHorizon[wildcardHorizon] ?? []).find(
    (s) => s.transfersOut.length === 0,
  );
  const rollForWildcardHorizon = rollAtWildcardHorizon ? rollAtWildcardHorizon.netPoints : null;

  return (
    <div className="space-y-3">
      {showToggle && (
        <div className="segment">
          <button data-active={active === "freeHit"} onClick={() => setWhich("freeHit")}>
            Free Hit
          </button>
          <button data-active={active === "wildcard"} onClick={() => setWhich("wildcard")}>
            Wildcard
          </button>
        </div>
      )}
      {active === "freeHit" && freeHit && (
        <ChipCard title="FREE HIT" scenario={freeHit} baselineNetPoints={baselineFor1Gw} poolById={poolById} showXi={showXi} onToggleXi={() => setShowXi((v) => !v)} />
      )}
      {active === "wildcard" && wildcardByHorizon && (
        <div className="space-y-2">
          <div className="segment">
            {WILDCARD_HORIZONS.map((h) => (
              <button
                key={h}
                data-active={wildcardHorizon === h}
                disabled={!wildcardByHorizon[h]}
                onClick={() => setWildcardHorizon(h)}
              >
                {h} GW
              </button>
            ))}
          </div>
          {wildcard && (
            <ChipCard
              key={wildcardHorizon}
              title={`WILDCARD — ${wildcardHorizon} GW`}
              scenario={wildcard}
              baselineNetPoints={rollForWildcardHorizon}
              poolById={poolById}
              showXi={showXi}
              onToggleXi={() => setShowXi((v) => !v)}
            />
          )}
        </div>
      )}
    </div>
  );
}

/** Bench Boost / Triple Captain timing: unlike Wildcard/Free Hit these don't
 * change the squad at all, so there's nothing for the ILP optimiser to
 * solve -- it's purely "which gameweek in the window is best to press the
 * button", holding the squad exactly as forecast. Derived entirely from
 * `upcoming` (already computed per-GW for the pitch view), no new backend
 * data needed. */
// A fresh one-week squad beats any fixed 15 by a few points in an ordinary week, so a week only
// stands out when its gain beats the window's typical (median) week by this much -- the size of
// edge a blank or double gameweek gives, which is when the chip usually pays off.
const FREE_HIT_STANDOUT_MARGIN = 4;

function median(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** Free Hit timing: the gain over your own XI for each projected week, best week marked. */
function FreeHitTiming({ weeks, pick, expiresGw }: { weeks: FreeHitWeek[]; pick: FreeHitWeek; expiresGw: number }) {
  const typical = median(weeks.map((w) => w.gain));
  const standout = weeks.length > 1 && pick.gain - typical >= FREE_HIT_STANDOUT_MARGIN;
  const top = Math.max(...weeks.map((w) => w.gain), 1);
  return (
    <div className="border-t border-line pt-2" data-testid="free-hit-timing">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs text-ink-faint">Free Hit</p>
        <p className="text-xs text-ink-faint">use by GW{expiresGw}</p>
      </div>
      <p className="text-xs text-ink-soft">
        {standout ? (
          <>
            Best in <span className="stat text-ink">GW{pick.gameweek}</span>: +{pick.gain.toFixed(1)} pts over your XI
          </>
        ) : (
          <>
            No standout week yet: best is GW{pick.gameweek} (+{pick.gain.toFixed(1)}), close to a typical week
            (+{typical.toFixed(1)}). Usually worth saving for a blank or double gameweek.
          </>
        )}
      </p>
      <ul className="mt-1 flex items-end gap-1" aria-label="Free Hit gain by gameweek">
        {weeks.map((w) => (
          <li key={w.gameweek} className="flex flex-1 flex-col items-center gap-0.5" data-best={w.gameweek === pick.gameweek || undefined}>
            <span className="text-xs tabular-nums text-ink-soft">{w.gain.toFixed(1)}</span>
            <span
              className="w-full rounded-sm"
              style={{
                height: `${Math.max(3, (Math.max(0, w.gain) / top) * 28)}px`,
                background: w.gameweek === pick.gameweek ? "var(--accent)" : "var(--border-strong)",
              }}
            />
            <span className="text-xs text-ink-faint">{w.gameweek}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ChipTimingCard({
  upcoming,
  squad,
  chips,
  forecastGw,
  freeHitWeeks,
}: {
  upcoming: UpcomingGameweek[];
  squad: ForecastPlayer[];
  chips: ChipWindow[] | null;
  forecastGw: number;
  freeHitWeeks?: FreeHitWeek[] | null;
}) {
  if (upcoming.length === 0) return null;
  const squadById = new Map(squad.map((p) => [p.id, p]));
  const lastForecastGw = upcoming[upcoming.length - 1].gameweek;

  // Per-team chip windows from the forecast. Unknown is shown as unknown, not
  // assumed available.
  const bboost = chipState(chips, "bboost", forecastGw);
  const tc = chipState(chips, "3xc", forecastGw);
  const fh = chipState(chips, "freehit", forecastGw);
  const gone = (s: ChipState) => s.kind === "closed" && s.nextFromGw == null;
  const fhWeeks = fh.kind === "open" ? (freeHitWeeks ?? []) : [];
  if (gone(bboost) && gone(tc) && fhWeeks.length === 0) return null; // nothing left to time

  const bboostPick =
    bboost.kind === "open"
      ? bestWithinWindow(
          upcoming
            .map((gw) => ({
              gameweek: gw.gameweek,
              benchTotal: gw.bench.reduce((sum, id) => {
                const p = gw.players.find((pl) => pl.id === id);
                return sum + (p?.projectedPoints ?? 0);
              }, 0),
            }))
            .sort((a, b) => b.benchTotal - a.benchTotal),
          bboost.expiresGw,
          lastForecastGw,
        )
      : null;

  const tcPick =
    tc.kind === "open"
      ? bestWithinWindow(
          upcoming
            .map((gw) => {
              const cap = gw.captainId != null ? gw.players.find((pl) => pl.id === gw.captainId) : null;
              return { gameweek: gw.gameweek, captainId: gw.captainId, captainPoints: cap?.projectedPoints ?? 0 };
            })
            .sort((a, b) => b.captainPoints - a.captainPoints),
          tc.expiresGw,
          lastForecastGw,
        )
      : null;

  const fhPick =
    fh.kind === "open" && fhWeeks.length
      ? bestWithinWindow([...fhWeeks].sort((a, b) => b.gain - a.gain), fh.expiresGw, fhWeeks[fhWeeks.length - 1].gameweek)
      : null;

  const closedText = (s: ChipState) =>
    s.kind === "unknown"
      ? "status unknown"
      : s.kind === "closed"
        ? `${s.usedNow ? "used" : "not open"}${s.nextFromGw != null ? `, next from GW${s.nextFromGw}` : ""}`
        : "";

  // The forecast only looks a few GWs ahead; say so when a chip's window runs longer.
  const beyond = [
    { label: "Bench Boost", state: bboost, pick: bboostPick },
    { label: "Triple Captain", state: tc, pick: tcPick },
    { label: "Free Hit", state: fh, pick: fhPick },
  ].flatMap((c) =>
    c.state.kind === "open" && c.pick && !c.pick.seesAllOfWindow
      ? [`${c.label} runs to GW${c.state.expiresGw}`]
      : [],
  );

  return (
    <div className="panel space-y-3 p-3">
      <p className="eyebrow">Chip timing</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs text-ink-faint">Bench Boost</p>
          {bboostPick && bboost.kind === "open" ? (
            <>
              <p className="stat text-lg text-ink">GW{bboostPick.pick.gameweek}</p>
              <p className="text-xs text-ink-soft">+{bboostPick.pick.benchTotal.toFixed(1)} bench pts</p>
              <p className="text-xs text-ink-faint">use by GW{bboost.expiresGw}</p>
            </>
          ) : (
            <p className="mt-1 text-sm text-ink-faint opacity-60">{closedText(bboost)}</p>
          )}
        </div>
        <div>
          <p className="text-xs text-ink-faint">Triple Captain</p>
          {tcPick && tc.kind === "open" ? (
            <>
              <p className="stat text-lg text-ink">GW{tcPick.pick.gameweek}</p>
              <p className="text-xs text-ink-soft">
                {tcPick.pick.captainId != null ? squadById.get(tcPick.pick.captainId)?.webName ?? "?" : "—"}
                , +{tcPick.pick.captainPoints.toFixed(1)} extra
              </p>
              <p className="text-xs text-ink-faint">use by GW{tc.expiresGw}</p>
            </>
          ) : (
            <p className="mt-1 text-sm text-ink-faint opacity-60">{closedText(tc)}</p>
          )}
        </div>
      </div>
      {fhPick && fh.kind === "open" && (
        <FreeHitTiming weeks={fhWeeks.filter((w) => w.gameweek <= fh.expiresGw)} pick={fhPick.pick} expiresGw={fh.expiresGw} />
      )}
      <p className="text-xs text-ink-faint">
        Best gameweek in the {upcoming.length}-GW window (up to each chip&rsquo;s last gameweek) to
        hold your squad unchanged and press the button — assumes no transfers between now and then.
      </p>
      {beyond.length > 0 && (
        <p className="text-xs text-ink-soft" data-testid="chip-beyond-window">
          {beyond.join("; ")}, but the forecast only looks ahead to GW{lastForecastGw} — a better week
          may come later.
        </p>
      )}
    </div>
  );
}

const CHIP_NAME: Record<string, string> = { wildcard: "Wildcard", freehit: "Free Hit" };

/** The FT count, with the week-by-week replay behind it a tap away. */
function FreeTransferNote({ freeTransfers }: { freeTransfers: ScenariosData["freeTransfers"] }) {
  const weeks = freeTransfers.weeks ?? [];
  const tail = "Every projection assumes optimal captaincy and XI selection each gameweek, so it reads slightly high versus reality.";
  if (!weeks.length) {
    return (
      <p className="px-1 text-xs text-ink-faint">
        <span className="font-semibold text-ink-soft">{freeTransfers.value} FT</span> — {freeTransfers.derivation}. {tail}
      </p>
    );
  }
  return (
    <details className="px-1 text-xs text-ink-faint" data-testid="ft-derivation">
      <summary className="flex min-h-[44px] cursor-pointer items-center gap-1">
        <span className="font-semibold text-ink-soft">{freeTransfers.value} FT</span>
        <span>· how is this counted?</span>
      </summary>
      <p className="mb-1">
        +1 a week, up to 5. Transfers use them up; a hit can&apos;t go below 0. A Wildcard or Free Hit week keeps
        what you had.
      </p>
      <ul className="tabular-nums">
        {weeks.map((w) => (
          <li key={w.gameweek} className="flex justify-between gap-2 border-t border-line py-0.5">
            <span>GW{w.gameweek}</span>
            <span>
              {w.chip ? `${CHIP_NAME[w.chip] ?? w.chip}, bank kept` : `${w.before} held, ${w.used} made`}
            </span>
            <span className="text-ink-soft">→ {w.after}</span>
          </li>
        ))}
      </ul>
      <p className="mt-1">{tail}</p>
    </details>
  );
}

export default function Scenarios({
  scenarios,
  pool,
  squad,
  forecastGw,
  upcoming,
  chips,
  guestTeam = null,
}: {
  scenarios: ScenariosData;
  pool: PoolPlayer[];
  squad: ForecastPlayer[];
  forecastGw: number;
  upcoming: UpcomingGameweek[];
  chips: ChipWindow[] | null;
  /** A guest's own squad, sell prices, bank and FTs, sent with a pinned re-solve so it starts
   * from their 15 rather than the app owner's. Null for the owner. */
  guestTeam?: GuestTeam | null;
}) {
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

      <FreeTransferNote freeTransfers={scenarios.freeTransfers} />

      {scenariosForHorizon.length === 0 ? (
        <div className="panel rise px-3 py-4 text-center">
          <p className="text-sm text-ink-soft">No feasible scenario found for this horizon.</p>
          <p className="mt-1 text-xs text-ink-faint">
            Try a shorter horizon, or come back once transfer prices settle.
          </p>
        </div>
      ) : (
        <Carousel>
          {scenariosForHorizon.map((s, i) => (
            <TransferScenarioCard
              key={i}
              scenario={s}
              rollNetPoints={roll ? roll.netPoints : null}
              rank={i}
              poolById={poolById}
            />
          ))}
        </Carousel>
      )}

      <ForceLockPanel key={squad.map((p) => p.id).join(",")} squad={squad} forecastGw={forecastGw} horizon={horizon} guestTeam={guestTeam} />

      {scenarios.plan && (
        <PlanTimeline plan={scenarios.plan} forecastGw={forecastGw} poolById={poolById} />
      )}

      {(scenarios.freeHit || scenarios.wildcard) && (
        <ChipToggle
          freeHit={scenarios.freeHit}
          wildcardByHorizon={scenarios.wildcard}
          byHorizon={scenarios.byHorizon}
          baselineFor1Gw={baselineFor1Gw ? baselineFor1Gw.netPoints : null}
          poolById={poolById}
        />
      )}

      <ChipTimingCard upcoming={upcoming} squad={squad} chips={chips} forecastGw={forecastGw} freeHitWeeks={scenarios.freeHitWeeks} />
    </section>
  );
}
