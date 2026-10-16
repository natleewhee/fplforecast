import type { PendingTransfer } from "./transfers";

/* The browser side of /api/transfers, shared by the "Make a transfer" form and
 * the replace-on-the-pitch sheet. */

export type Rebuild = "started" | "running" | "scheduled" | "none";

export const REBUILD_TEXT: Record<Rebuild, string> = {
  started: "Rebuilding the forecast now — refresh in about 5 minutes to see your updated squad.",
  running: "A rebuild is already running. Refresh in a few minutes to see your updated squad.",
  scheduled: "Your squad updates at the next daily rebuild (03:00 UTC, 11:00 SGT).",
  none: "",
};

export type TransferResult = {
  transfers: PendingTransfer[];
  rebuild: Rebuild;
  /** Why a rebuild could not start, when it could not. */
  rebuildHint?: string;
  duplicate: boolean;
};

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
    rebuildHint: json.rebuildHint,
    duplicate: Boolean(json.duplicate),
  };
}

export const saveTransfer = (outId: number, inId: number, basedOnGw: number, note = "") =>
  call("POST", { outId, inId, basedOnGw, note });

export const removeTransfer = (outId: number, inId: number) => call("DELETE", { outId, inId });

/** The "Rebuild now" button's call. */
export async function rebuildNow(): Promise<{ rebuild: Rebuild; hint?: string }> {
  const res = await fetch("/api/rebuild", { method: "POST" });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "Couldn't start a rebuild");
  return { rebuild: json.rebuild ?? "scheduled", hint: json.hint };
}
