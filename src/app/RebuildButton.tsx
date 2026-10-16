"use client";

import { useState } from "react";
import { REBUILD_TEXT, rebuildNow, type Rebuild } from "@/lib/transfersClient";

const COOLDOWN_MS = 60_000;

/** Starts the forecast rebuild (fresh FPL data plus the optimiser) right now,
 * instead of waiting for the daily 03:00 UTC run. The squad on screen only
 * changes once the rebuild finishes and the page is refreshed. */
export default function RebuildButton({ builtAt }: { builtAt?: string }) {
  const [phase, setPhase] = useState<"idle" | "busy" | "cooldown">("idle");
  const [result, setResult] = useState<{ rebuild: Rebuild; hint?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const go = async () => {
    setPhase("busy");
    setError(null);
    try {
      const r = await rebuildNow();
      setResult(r);
      setPhase("cooldown");
      setTimeout(() => setPhase("idle"), COOLDOWN_MS);
    } catch (err) {
      setError((err as Error).message);
      setPhase("idle");
    }
  };

  const built = builtAt ? new Date(builtAt) : null;
  const builtText = built && !Number.isNaN(built.getTime()) ? built.toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : null;

  return (
    <div className="space-y-1" data-testid="rebuild">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={go}
          disabled={phase !== "idle"}
          className="inline-flex h-11 items-center rounded-full border border-line px-4 text-xs font-semibold text-ink-soft transition-colors hover:border-border-strong disabled:cursor-not-allowed disabled:opacity-50"
        >
          {phase === "busy" ? "Starting…" : phase === "cooldown" ? "Rebuild requested" : "Rebuild now"}
        </button>
        {builtText && <span className="text-[11px] text-ink-faint">Forecast built {builtText}</span>}
      </div>
      {(result || error) && (
        <p role="status" className={`text-xs ${error || result?.rebuild === "scheduled" ? "text-[var(--warn)]" : "text-ink-soft"}`}>
          {error ?? (result?.rebuild === "scheduled" && result.hint ? `${REBUILD_TEXT.scheduled} ${result.hint}` : result ? REBUILD_TEXT[result.rebuild] : "")}
        </p>
      )}
    </div>
  );
}
