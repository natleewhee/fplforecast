"use client";

import { commentate } from "@/lib/commentary";
import type { TrackerRow } from "@/lib/liveBlend";
import { sgKickoff } from "@/lib/liveLabels";
import type { FeedItem } from "./useLiveFx";

/* Two small glance-aids that sit above the Live pitch: what's still to come
 * for the eleven that count (in Singapore time, so a late-night kickoff is
 * obvious), and a short log of what just happened, since the floating +N on a
 * token fades after a couple of seconds. */

const names = (rows: TrackerRow[]) => rows.map((r) => r.webName).join(", ");

export function NextUp({ rows }: { rows: TrackerRow[] }) {
  const playing = rows.filter((r) => r.status === "playing");
  const byKickoff = new Map<string, TrackerRow[]>();
  for (const r of rows.filter((r) => r.status === "notStarted")) {
    const key = r.kickoffTime ?? "";
    byKickoff.set(key, [...(byKickoff.get(key) ?? []), r]);
  }
  const groups = [...byKickoff.entries()].sort(([a], [b]) => (a || "~").localeCompare(b || "~"));
  const bonus = rows.filter((r) => r.bonusPending);
  if (!playing.length && !groups.length && !bonus.length) return null;

  return (
    <div className="mb-2 space-y-1 rounded-xl border border-line px-3 py-2 text-[11px] leading-snug">
      <p className="eyebrow">Still to come</p>
      {playing.length > 0 && (
        <p>
          <span className="font-semibold text-[var(--accent)]">Playing now</span>
          <span className="text-ink-soft"> · {playing.map((r) => `${r.webName} ${r.minutes}'`).join(", ")}</span>
        </p>
      )}
      {groups.map(([iso, list]) => (
        <p key={iso || "tbc"}>
          <span className="font-mono font-semibold text-ink">{iso ? sgKickoff(iso) : "Time tbc"}</span>
          <span className="text-ink-soft">
            {" "}
            · {names(list)}
            {list.length > 1 ? ` (${list.length})` : ""}
          </span>
        </p>
      ))}
      {bonus.length > 0 && (
        <p>
          <span className="font-semibold text-[var(--warn)]">Bonus due</span>
          <span className="text-ink-soft">
            {" "}
            · {names(bonus)} (1–3 pts can still be added once FPL confirms the match)
          </span>
        </p>
      )}
    </div>
  );
}

export function LiveFeed({ feed, showEmpty }: { feed: FeedItem[]; showEmpty: boolean }) {
  if (!feed.length) {
    return showEmpty ? (
      <p className="mb-2 text-[10.5px] leading-snug text-ink-faint">
        Goals, assists, cards and bonus show up here as they happen while this page is open.
      </p>
    ) : null;
  }
  return (
    <div className="mb-2 rounded-xl border border-line px-3 py-2">
      <p className="eyebrow mb-1">What just happened</p>
      <ul className="space-y-1" aria-live="polite">
        {feed.map((f) => (
          <li key={f.key} className="flex items-baseline justify-between gap-2 text-[11.5px] leading-snug">
            <span className="min-w-0">
              <span className="text-ink">{commentate(f.name, f.what, f.delta, f.key)}</span>
              {f.minutes > 0 && <span className="font-mono text-ink-faint"> · {f.minutes}&prime;</span>}
            </span>
            {f.delta !== 0 && (
              <span
                className={`shrink-0 font-mono text-xs font-bold ${f.delta > 0 ? "text-[var(--accent)]" : "text-[var(--danger)]"}`}
              >
                {f.delta > 0 ? "+" : "\u2212"}
                {Math.abs(f.delta).toFixed(0)}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
