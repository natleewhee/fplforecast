import type { PendingTransfer } from "./transfers";

/* The browser side of /api/transfers, shared by the "Make a transfer" form and
 * the replace-on-the-pitch sheet. */

export type Rebuild = "started" | "scheduled" | "none";

export const REBUILD_TEXT: Record<Rebuild, string> = {
  started: "Rebuilding the forecast now — refresh in about 5 minutes to see your updated squad.",
  scheduled: "Your squad updates at the next daily rebuild (03:00 UTC, 11:00 SGT).",
  none: "",
};

export type TransferResult = { transfers: PendingTransfer[]; rebuild: Rebuild; duplicate: boolean };

async function call(method: "POST" | "DELETE", body: unknown): Promise<TransferResult> {
  const res = await fetch("/api/transfers", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || (method === "POST" ? "Failed to save" : "Failed to remove"));
  return {
    transfers: json.overrides?.transfers ?? [],
    rebuild: json.rebuild ?? "scheduled",
    duplicate: Boolean(json.duplicate),
  };
}

export const saveTransfer = (outId: number, inId: number, basedOnGw: number, note = "") =>
  call("POST", { outId, inId, basedOnGw, note });

export const removeTransfer = (outId: number, inId: number) => call("DELETE", { outId, inId });
