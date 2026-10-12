"use client";

import { useState } from "react";
import type { ForecastPlayer, Player, PoolPlayer } from "@/lib/snapshots";
import type { PendingTransfer } from "@/lib/transfers";
import {
  bankAfterPending,
  replaceOptions,
  squadAfterPending,
  xpOver,
  type Horizon,
  type Held,
  type Known,
} from "@/lib/replaceOptions";
import { REBUILD_TEXT, removeTransfer, saveTransfer, type Rebuild } from "@/lib/transfersClient";
import { availabilityFlag } from "@/lib/availability";
import BottomSheet from "./BottomSheet";
import { FormBars } from "./Shirt";

/** What the Squad pitch needs to offer "replace this player" (own team only). */
export type TransferTools = {
  basedOnGw: number;
  bank: number; // £m in the bank, before any saved-but-unapplied transfer
  pool: PoolPlayer[];
  allPlayers: Player[];
  pending: PendingTransfer[];
  onPendingChange: (next: PendingTransfer[]) => void;
};

const HORIZONS: { value: Horizon; label: string }[] = [
  { value: 1, label: "This GW" },
  { value: 3, label: "Next 3" },
  { value: 5, label: "Next 5" },
];

const fmt = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(1)}`;

/** Pick a replacement for one squad player: the legal, affordable options
 * ranked by expected points, then confirm and save (the same save the
 * "Make a transfer" form does). */
export default function ReplaceSheet({
  out,
  squad,
  tools,
  onClose,
}: {
  out: ForecastPlayer;
  squad: ForecastPlayer[];
  tools: TransferTools;
  onClose: () => void;
}) {
  const [horizon, setHorizon] = useState<Horizon>(1);
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<PoolPlayer | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  const [rebuild, setRebuild] = useState<Rebuild>("none");

  const known = new Map<number, Known>(
    tools.allPlayers.map((p) => [p.id, { id: p.id, team: p.team, position: p.position, priceMillions: p.priceMillions }]),
  );
  const nameOf = (id: number) => tools.allPlayers.find((p) => p.id === id)?.webName ?? `#${id}`;
  const held: Held[] = squad.map((p) => ({ id: p.id, team: p.team, position: p.position, sellPrice: p.sellPrice ?? p.price ?? 0 }));
  const after = squadAfterPending(held, tools.pending, known);
  const bank = bankAfterPending(tools.bank, held, tools.pending, known);
  const outHeld = held.find((h) => h.id === out.id);
  const alreadySwapped = tools.pending.find((t) => t.out === out.id);

  const outPool = tools.pool.find((p) => p.id === out.id);
  const outXp = outPool ? xpOver(outPool, horizon) : horizon === 1 ? (out.projectedPoints ?? 0) : 0;
  const options = outHeld
    ? replaceOptions({ out: outHeld, outXp, squad: after, pool: tools.pool, bank, horizon, query })
    : [];

  async function save() {
    if (!chosen || status === "saving") return;
    setStatus("saving");
    setMessage("");
    try {
      const r = await saveTransfer(out.id, chosen.id, tools.basedOnGw);
      tools.onPendingChange(r.transfers);
      setRebuild(r.rebuild);
      setMessage(r.duplicate ? `Already saved: ${out.webName} → ${chosen.webName}` : `Saved: ${out.webName} → ${chosen.webName}`);
      setStatus("done");
    } catch (err) {
      setMessage((err as Error).message);
      setStatus("error");
    }
  }

  async function undo(t: PendingTransfer) {
    setStatus("saving");
    setMessage("");
    try {
      const r = await removeTransfer(t.out, t.in);
      tools.onPendingChange(r.transfers);
      setRebuild(r.rebuild);
      setMessage(`Removed: ${nameOf(t.out)} → ${nameOf(t.in)}`);
      setStatus("done");
    } catch (err) {
      setMessage((err as Error).message);
      setStatus("error");
    }
  }

  const header = (
    <div>
      <p className="eyebrow">Replace · {out.position}</p>
      <h3 className="text-lg font-semibold text-ink">{out.webName}</h3>
      <p className="text-[11px] text-ink-soft">
        Sells for about £{(outHeld?.sellPrice ?? 0).toFixed(1)}m · bank £{bank.toFixed(1)}m
      </p>
    </div>
  );

  if (status === "done") {
    return (
      <BottomSheet label={`Replace ${out.webName}`} onClose={onClose}>
        {header}
        <div role="status" className="mt-4 space-y-1 text-sm">
          <p className="font-medium text-[var(--accent)]">{message}</p>
          {REBUILD_TEXT[rebuild] && <p className="text-xs text-ink-soft">{REBUILD_TEXT[rebuild]}</p>}
        </div>
      </BottomSheet>
    );
  }

  if (alreadySwapped) {
    return (
      <BottomSheet label={`Replace ${out.webName}`} onClose={onClose}>
        {header}
        <div className="mt-4 space-y-3">
          <p className="text-sm text-ink">
            Already swapping out for <span className="font-semibold">{nameOf(alreadySwapped.in)}</span>. It applies at the
            next rebuild.
          </p>
          <button
            type="button"
            disabled={status === "saving"}
            onClick={() => undo(alreadySwapped)}
            className="inline-flex h-11 w-full items-center justify-center rounded-lg border border-line text-sm font-medium text-ink-soft hover:border-border-strong disabled:opacity-50"
          >
            {status === "saving" ? "Removing…" : "Remove this transfer"}
          </button>
          {status === "error" && <p role="alert" className="text-xs font-medium text-[var(--danger)]">{message}</p>}
        </div>
      </BottomSheet>
    );
  }

  if (chosen) {
    const xp = xpOver(chosen, horizon);
    const left = (outHeld?.sellPrice ?? 0) + bank - chosen.price;
    return (
      <BottomSheet label={`Replace ${out.webName}`} onClose={onClose}>
        {header}
        <div className="mt-4 space-y-3">
          <div className="rounded-lg border border-line px-3 py-2 text-sm">
            <span className="text-ink-soft line-through">{out.webName}</span>
            <span className="px-2 text-ink-faint">{"→"}</span>
            <span className="font-semibold text-ink">{chosen.webName}</span>
            <div className="mt-1 text-[11px] text-ink-soft">
              {chosen.team} · £{chosen.price.toFixed(1)}m · £{left.toFixed(1)}m left ·{" "}
              <span className={xp - outXp >= 0 ? "text-[var(--accent)]" : "text-[var(--danger)]"}>
                {fmt(xp - outXp)} xP over {horizon === 1 ? "this GW" : `${horizon} GWs`}
              </span>
            </div>
          </div>
          <button
            type="button"
            disabled={status === "saving"}
            onClick={save}
            className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-gradient-to-b from-[var(--accent)] to-[#23c78c] text-sm font-bold text-black disabled:opacity-50"
          >
            {status === "saving" ? "Saving…" : "Save transfer"}
          </button>
          <button
            type="button"
            onClick={() => {
              setChosen(null);
              setStatus("idle");
            }}
            className="inline-flex h-11 w-full items-center justify-center rounded-lg border border-line text-sm text-ink-soft hover:border-border-strong"
          >
            Back to options
          </button>
          {status === "error" && <p role="alert" className="text-xs font-medium text-[var(--danger)]">{message}</p>}
        </div>
      </BottomSheet>
    );
  }

  return (
    <BottomSheet label={`Replace ${out.webName}`} onClose={onClose}>
      {header}
      <div className="mt-3 flex items-center gap-1.5">
        {HORIZONS.map((h) => (
          <button
            key={h.value}
            type="button"
            aria-pressed={horizon === h.value}
            onClick={() => setHorizon(h.value)}
            className={`h-8 rounded-full border px-3 text-[11px] font-semibold transition-colors ${
              horizon === h.value
                ? "border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-[var(--accent)]"
                : "border-line text-ink-soft hover:border-border-strong"
            }`}
          >
            {h.label}
          </button>
        ))}
      </div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search a name…"
        className="mt-2 w-full rounded-lg border border-line bg-[var(--bg-2)] px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-[var(--accent)] focus:outline-none"
      />
      <ul className="mt-2 max-h-[44vh] divide-y divide-[var(--line)] overflow-y-auto">
        {options.map((o) => {
          const doubt = availabilityFlag(o.player.availability);
          return (
            <li key={o.player.id}>
              <button
                type="button"
                onClick={() => setChosen(o.player)}
                className="flex w-full items-center justify-between gap-3 py-2 text-left"
              >
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                    {o.player.webName}
                    {doubt && (
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: doubt.color }} title={doubt.label} />
                    )}
                  </span>
                  <span className="block text-[11px] text-ink-soft">
                    {o.player.team} · £{o.player.price.toFixed(1)}m · £{o.left.toFixed(1)}m left
                  </span>
                  <FormBars points={o.player.recentPoints} />
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-mono text-sm font-bold text-ink">{o.xp.toFixed(1)}</span>
                  <span
                    className={`block font-mono text-[11px] ${o.delta >= 0 ? "text-[var(--accent)]" : "text-[var(--danger)]"}`}
                  >
                    {fmt(o.delta)}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
        {options.length === 0 && (
          <li className="py-3 text-xs text-ink-faint">
            No {out.position} fits the budget and the three-per-club limit
            {query ? " for that search" : ""}.
          </li>
        )}
      </ul>
      <p className="mt-2 text-[10.5px] leading-snug text-ink-faint">
        Ranked by the model&rsquo;s expected points; healthy players only. xP is the player&rsquo;s own, with the gain
        over {out.webName} underneath.
      </p>
    </BottomSheet>
  );
}
