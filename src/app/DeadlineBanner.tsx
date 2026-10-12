"use client";

import { useEffect, useState } from "react";
import { countdown } from "@/lib/countdown";

/* A one-line reminder under the team bar, on every tab, while a deadline is
 * ahead: how long is left, when it is in Singapore time, whether a transfer is
 * waiting to be applied, and who the captain is. It turns amber inside a day
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
  captain,
}: {
  deadline: string | null | undefined;
  gameweek: number;
  pendingTransfers: number;
  captain: string | null;
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
      ? { color: "var(--danger)", label: "Deadline soon" }
      : hours < 24
        ? { color: "var(--warn)", label: "Deadline today" }
        : { color: "var(--accent)", label: "Next deadline" };

  return (
    <div
      role="status"
      className="mx-1 mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-xs"
      style={{
        borderColor: `color-mix(in srgb, ${tone.color} 40%, transparent)`,
        background: `color-mix(in srgb, ${tone.color} 8%, transparent)`,
      }}
    >
      <span className="font-semibold" style={{ color: tone.color }}>
        {tone.label} · GW{gameweek}
      </span>
      <span className="font-mono font-semibold tabular-nums text-ink">{countdown(deadline, nowMs)}</span>
      <span className="text-ink-faint">{sgDeadline(deadline)}</span>
      {pendingTransfers > 0 && (
        <span className="chip chip-warn">
          {pendingTransfers} transfer{pendingTransfers > 1 ? "s" : ""} pending
        </span>
      )}
      {captain && (
        <span className="text-ink-soft">
          <span className="text-ink-faint">C</span> {captain}
        </span>
      )}
    </div>
  );
}
