"use client";

import { useMemo, useState } from "react";
import type { OpponentLeg, PoolData, PoolPlayer, PoolUpgradeMark } from "@/lib/snapshots";

/* The pre-deadline planning surface (KTD7): one sortable table of the whole
 * available pool with five-gameweek xP, fixture legs, metadata, and — from the
 * U3 squad-vs-pool pass — an upgrade mark on any row that beats a held player
 * in the same slot. Mobile-first: the identity column is pinned, everything
 * else is reached by horizontal scroll. */

const POSITION_COLOR: Record<string, string> = {
  GKP: "bg-[var(--gkp)]",
  DEF: "bg-[var(--def)]",
  MID: "bg-[var(--mid)]",
  FWD: "bg-[var(--fwd)]",
};

type SortKey = "total" | "price" | "selectedByPercent" | "form" | "webName";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "total", label: "5-GW total" },
  { key: "price", label: "Price" },
  { key: "selectedByPercent", label: "Selected %" },
  { key: "form", label: "Form" },
  { key: "webName", label: "Name" },
];

function fdrTint(rating: number | null): string {
  if (rating == null) return "text-ink-faint";
  if (rating <= 2) return "text-[var(--accent)]";
  if (rating === 3) return "text-ink-soft";
  return "text-[var(--danger)]";
}

/** One gameweek's fixture legs → "CHE (H)", "· BHA (A)" for a double, "—" blank. */
function OpponentLegs({ legs }: { legs: OpponentLeg[] | undefined }) {
  if (!legs || legs.length === 0) {
    return <span className="text-[10px] text-ink-faint">—</span>;
  }
  return (
    <span className="flex flex-col gap-0.5 text-[10px] leading-tight">
      {legs.map((leg, i) => (
        <span key={i} className={fdrTint(leg.fdrRating)}>
          {leg.team ?? "???"} {leg.wasHome ? "(H)" : "(A)"}
        </span>
      ))}
    </span>
  );
}

/** The mark we surface for a pool row: prefer one the manager can afford,
 * then the largest five-gameweek gain. Falls back to the best over-budget
 * mark when every upgrade this player enables costs more than the bank. */
function bestMark(marks: PoolUpgradeMark[] | undefined): PoolUpgradeMark | null {
  if (!marks || marks.length === 0) return null;
  const affordable = marks.filter((m) => !m.overBudget);
  const pick = affordable.length > 0 ? affordable : marks;
  return pick.reduce((a, b) => (b.gap > a.gap ? b : a));
}

function UpgradeMark({
  marks,
  bank,
}: {
  marks: PoolUpgradeMark[] | undefined;
  bank: number;
}) {
  const best = bestMark(marks);
  if (!best) return null;
  const overBy = Math.round((best.priceDelta - bank) * 10) / 10;
  const priceLabel =
    best.priceDelta === 0
      ? "same price"
      : `${best.priceDelta > 0 ? "+" : ""}£${best.priceDelta.toFixed(1)}m`;
  return (
    <span className="flex flex-wrap items-center gap-1">
      <span className="chip chip-accent !py-0 text-[10px]">
        ▲ upgrade +{best.gap.toFixed(1)}
        {marks && marks.length > 1 ? ` ·${marks.length}` : ""}
      </span>
      <span className="text-[10px] text-ink-faint">{priceLabel}</span>
      {best.overBudget && (
        <span className="chip chip-danger !py-0 text-[10px]">
          over budget by £{Math.abs(overBy).toFixed(1)}m
        </span>
      )}
    </span>
  );
}

export default function PlanningTable({ data }: { data: PoolData | null }) {
  if (!data || data.pool.length === 0) {
    return (
      <div className="panel rise p-6 text-center">
        <p className="text-sm text-ink-soft">No pool data yet.</p>
        <p className="mt-1 text-xs text-ink-faint">
          The planning table fills in once a forecast snapshot carries a{" "}
          <code className="rounded bg-white/10 px-1 py-0.5 font-mono">pool</code> block.
        </p>
      </div>
    );
  }
  return <PlanningTableInner data={data} />;
}

/** Rendered while the pool block is still loading — no code path in the current
 * static build, kept for a future client-fetched pool. */
export function PlanningTableSkeleton() {
  return (
    <div className="panel rise space-y-2 p-4">
      <div className="h-4 w-40 animate-pulse rounded bg-white/10" />
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="h-8 animate-pulse rounded bg-white/[0.06]" />
      ))}
    </div>
  );
}

function PlanningTableInner({ data }: { data: PoolData }) {
  const { pool, upgradesByPoolPlayer, bank, startGameweek, window } = data;
  const [sortKey, setSortKey] = useState<SortKey>("total");
  const [dir, setDir] = useState<"asc" | "desc">("desc");

  const gwColumns = useMemo(
    () => Array.from({ length: window }, (_, i) => startGameweek + i),
    [startGameweek, window],
  );

  const rows = useMemo(() => {
    const copy = [...pool];
    copy.sort((a, b) => {
      let cmp: number;
      if (sortKey === "webName") {
        cmp = a.webName.toLowerCase().localeCompare(b.webName.toLowerCase());
      } else {
        cmp = ((a[sortKey] as number) ?? 0) - ((b[sortKey] as number) ?? 0);
      }
      return dir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [pool, sortKey, dir]);

  function sortBy(key: SortKey) {
    if (key === sortKey) {
      setDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setDir(key === "webName" ? "asc" : "desc");
    }
  }

  const arrow = dir === "asc" ? "↑" : "↓";

  return (
    <div className="panel rise overflow-hidden !p-0">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <span className="eyebrow">Pool · {pool.length}</span>
        <div className="ml-auto flex items-center gap-1.5">
          <label className="sr-only" htmlFor="pool-sort">
            Sort column
          </label>
          <select
            id="pool-sort"
            value={sortKey}
            onChange={(e) => sortBy(e.target.value as SortKey)}
            className="rounded-md border border-line bg-bg-2 px-2 py-1 text-xs text-ink"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setDir((d) => (d === "asc" ? "desc" : "asc"))}
            aria-label={`Sort direction: ${dir === "asc" ? "ascending" : "descending"}`}
            className="rounded-md border border-line bg-bg-2 px-2 py-1 text-xs text-ink-soft"
          >
            {arrow}
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-left eyebrow">
              <th
                className="sticky left-0 z-10 bg-bg-2 px-3 py-2.5 font-bold"
                aria-sort={sortKey === "webName" ? (dir === "asc" ? "ascending" : "descending") : "none"}
              >
                <button type="button" onClick={() => sortBy("webName")} className="font-bold">
                  Player {sortKey === "webName" ? arrow : ""}
                </button>
              </th>
              {gwColumns.map((gw) => (
                <th key={gw} className="px-2 py-2.5 text-center font-bold">
                  GW{gw}
                </th>
              ))}
              <th
                className="px-3 py-2.5 text-right font-bold"
                aria-sort={sortKey === "total" ? (dir === "asc" ? "ascending" : "descending") : "none"}
              >
                <button type="button" onClick={() => sortBy("total")} className="font-bold">
                  Total {sortKey === "total" ? arrow : ""}
                </button>
              </th>
              <th
                className="px-3 py-2.5 text-right font-bold"
                aria-sort={sortKey === "price" ? (dir === "asc" ? "ascending" : "descending") : "none"}
              >
                <button type="button" onClick={() => sortBy("price")} className="font-bold">
                  £m {sortKey === "price" ? arrow : ""}
                </button>
              </th>
              <th className="px-3 py-2.5 text-right font-bold">
                <button type="button" onClick={() => sortBy("selectedByPercent")} className="font-bold">
                  Sel% {sortKey === "selectedByPercent" ? arrow : ""}
                </button>
              </th>
              <th className="px-3 py-2.5 text-right font-bold">
                <button type="button" onClick={() => sortBy("form")} className="font-bold">
                  Form {sortKey === "form" ? arrow : ""}
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <PoolRow
                key={p.id}
                player={p}
                columns={gwColumns.length}
                marks={upgradesByPoolPlayer[p.id]}
                bank={bank}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PoolRow({
  player,
  columns,
  marks,
  bank,
}: {
  player: PoolPlayer;
  columns: number;
  marks: PoolUpgradeMark[] | undefined;
  bank: number;
}) {
  return (
    <tr className="border-b border-line last:border-0 hover:bg-white/[0.03]">
      <td className="sticky left-0 z-10 bg-bg-2 px-3 py-2 align-top">
        <div className="flex items-center gap-2">
          <span
            className={`inline-block w-8 shrink-0 rounded py-0.5 text-center text-[9px] font-bold tracking-wide text-black/85 ${
              POSITION_COLOR[player.position] ?? "bg-ink-soft"
            }`}
          >
            {player.position}
          </span>
          <span className="font-medium text-ink">{player.webName}</span>
          <span className="text-[10px] text-ink-faint">{player.team}</span>
        </div>
        <div className="mt-0.5 flex items-center gap-2 pl-10 font-mono text-[11px] tabular-nums text-ink-soft">
          <span>£{player.price.toFixed(1)}m</span>
          <span className="font-bold text-[var(--accent)]">{player.total.toFixed(1)}</span>
        </div>
        {marks && marks.length > 0 && (
          <div className="mt-1 pl-10">
            <UpgradeMark marks={marks} bank={bank} />
          </div>
        )}
      </td>
      {Array.from({ length: columns }).map((_, i) => {
        const xp = player.perGameweek[i];
        const legs = player.opponents[i];
        return (
          <td key={i} className="px-2 py-2 text-center align-top">
            <div className="font-mono text-xs font-bold tabular-nums text-ink">
              {xp == null ? <span className="text-ink-faint">—</span> : xp.toFixed(1)}
            </div>
            <div className="mt-0.5 flex justify-center">
              <OpponentLegs legs={legs} />
            </div>
          </td>
        );
      })}
      <td className="px-3 py-2 text-right align-top font-mono text-sm font-bold tabular-nums text-[var(--accent)]">
        {player.total.toFixed(1)}
      </td>
      <td className="px-3 py-2 text-right align-top font-mono text-xs tabular-nums text-ink-soft">
        {player.price.toFixed(1)}
      </td>
      <td className="px-3 py-2 text-right align-top font-mono text-xs tabular-nums text-ink-soft">
        {player.selectedByPercent.toFixed(1)}
      </td>
      <td className="px-3 py-2 text-right align-top font-mono text-xs tabular-nums text-ink-soft">
        {player.form.toFixed(1)}
      </td>
    </tr>
  );
}
