"use client";

import type { BenchCoverItem, TrackerRow } from "@/lib/liveBlend";

/** "If a starter doesn't play, who comes on?" for everyone whose match is yet
 * to start, from FPL's own autosub rules. Only shown while there is
 * someone left to cover. */
export default function BenchCover({ cover, rows }: { cover: BenchCoverItem[]; rows: TrackerRow[] }) {
  if (cover.length === 0) return null;
  const name = (id: number) => rows.find((r) => r.id === id)?.webName ?? `#${id}`;
  const gaps = cover.filter((c) => c.inId == null);
  const covered = cover.length - gaps.length;

  return (
    <details className="mt-3 rounded-xl border border-line px-3 py-2 text-[11.5px]" data-testid="bench-cover">
      <summary className="cursor-pointer list-none">
        <span className="eyebrow">Bench cover</span>
        <span className="ml-2 text-ink-soft">
          {gaps.length === 0
            ? `all ${cover.length} starters still to play are covered`
            : `${covered} of ${cover.length} covered`}
        </span>
        {gaps.length > 0 && (
          <span className="mt-1 block text-[var(--warn)]">
            No cover if they don&rsquo;t play: {gaps.map((g) => name(g.outId)).join(", ")}
          </span>
        )}
      </summary>
      <ul className="mt-2 space-y-1">
        {cover.map((c) => (
          <li key={c.outId} className="flex items-baseline justify-between gap-2">
            <span className="min-w-0 truncate text-ink">{name(c.outId)}</span>
            <span className={`shrink-0 ${c.inId == null ? "text-[var(--warn)]" : "text-[var(--accent)]"}`}>
              {c.inId == null ? "no cover" : `→ ${name(c.inId)}`}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
