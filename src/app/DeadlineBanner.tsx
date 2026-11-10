"use client";

import { useEffect, useState } from "react";
import { countdown } from "@/lib/time";

/* A one-line reminder under the team bar, on every tab, while a deadline is
 * ahead: how long is left, when it is in Singapore time, and whether a transfer is
 * waiting to be applied (the captain is on the pitch and in the checklist, so it
 * is not repeated here). One line, never wrapped. It turns amber inside a day
 * and red inside three hours. "Now" is read after mount because this page is
 * built statically. */

function sgDeadline(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-GB", { weekday: "short", timeZone: "Asia/Singapore" });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Singapore" });
  return `${day} ${time} SGT`;
}

export default function DeadlineBanner({
  deadline,
  gameweek,
  pendingTransfers,
}: {
  deadline: string | null | undefined;
  gameweek: number;
  pendingTransfers: number;
}) {
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    const first = setTimeout(() => setNowMs(Date.now()), 0);
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);

  if (!deadline || nowMs == null) return null;
  const msLeft = Date.parse(deadline) - nowMs;
  if (!Number.isFinite(msLeft) || msLeft <= 0) return null;

  const hours = msLeft / 3_600_000;
  const tone =
    hours < 3
      ? { key: "soon", color: "var(--danger)" }
      : hours < 24
        ? { key: "today", color: "var(--warn)" }
        : { key: "next", color: "var(--accent)" };

  return (
    <div
      role="status"
      data-testid="deadline-banner"
      data-tone={tone.key}
      className="mx-1 mt-1 flex items-center gap-x-2 overflow-hidden whitespace-nowrap rounded-lg border px-3 py-1.5 text-xs"
      style={{
        borderColor: `color-mix(in srgb, ${tone.color} 40%, transparent)`,
        background: `color-mix(in srgb, ${tone.color} 8%, transparent)`,
      }}
    >
      <span className="shrink-0 font-semibold" style={{ color: tone.color }}>
        GW{gameweek} deadline
        {tone.key !== "next" && <span className="sr-only">, {tone.key === "soon" ? "soon" : "today"}</span>}
      </span>
      <span className="shrink-0 font-mono font-semibold tabular-nums text-ink">{countdown(deadline, nowMs)}</span>
      <span className="min-w-0 truncate text-ink-faint">{sgDeadline(deadline)}</span>
      {pendingTransfers > 0 && (
        <span className="chip chip-warn ml-auto shrink-0">{pendingTransfers} pending</span>
      )}
    </div>
  );
}
