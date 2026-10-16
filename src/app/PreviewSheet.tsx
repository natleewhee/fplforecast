"use client";

import { useState } from "react";
import type { PoolPlayer } from "@/lib/snapshots";
import { removeTransfer } from "@/lib/transfersClient";
import type { PendingTransfer } from "@/lib/transfers";
import BottomSheet from "./BottomSheet";

/** What a tap on a previewed (saved-but-not-yet-rebuilt) player shows: who
 * they replace, the numbers that are known, and a way to undo the transfer. */
export default function PreviewSheet({
  incoming,
  replaces,
  outId,
  xp,
  gameweek,
  onUndone,
  onClose,
}: {
  incoming: PoolPlayer;
  replaces: string;
  outId: number;
  xp: number | null;
  gameweek: number;
  onUndone: (next: PendingTransfer[]) => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const undo = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await removeTransfer(outId, incoming.id);
      onUndone(r.transfers);
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <BottomSheet label={`${incoming.webName} saved transfer preview`} onClose={onClose}>
      <p className="eyebrow">Saved transfer · preview</p>
      <h3 className="text-lg font-semibold text-ink">{incoming.webName}</h3>
      <p className="mt-1 text-xs text-ink-soft">
        Replaces {replaces}. This is a preview: the model re-picks the XI and captain at the next rebuild.
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-line pt-3 text-[11px]">
        <dt className="text-ink-faint">GW{gameweek} projection</dt>
        <dd className="text-right font-mono text-[var(--accent)]">{xp != null ? `${xp.toFixed(1)} xP` : "—"}</dd>
        <dt className="text-ink-faint">Price</dt>
        <dd className="text-right font-mono text-ink">£{incoming.price.toFixed(1)}m</dd>
        <dt className="text-ink-faint">Form</dt>
        <dd className="text-right font-mono text-ink">{incoming.form.toFixed(1)}</dd>
      </dl>
      <button
        type="button"
        onClick={undo}
        disabled={busy}
        className="mt-4 inline-flex h-11 w-full items-center justify-center rounded-lg border border-line text-sm font-semibold text-ink-soft disabled:opacity-50"
      >
        {busy ? "Removing…" : `Undo ${replaces} → ${incoming.webName}`}
      </button>
      {error && <p className="mt-2 text-xs text-[var(--danger)]">{error}</p>}
    </BottomSheet>
  );
}
