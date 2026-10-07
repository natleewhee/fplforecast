export type PendingTransfer = { out: number; in: number; note?: string };

export function sameTransfer(a: PendingTransfer, b: PendingTransfer): boolean {
  return a.out === b.out && a.in === b.in;
}

/** Drops repeats of an identical out/in pair, keeping the first. A second copy
 * can never apply -- its "out" player is already gone. */
export function dedupeTransfers(transfers: PendingTransfer[]): PendingTransfer[] {
  return transfers.filter((t, i) => transfers.findIndex((u) => sameTransfer(t, u)) === i);
}
