import type { ProjectionBreakdown } from "@/lib/snapshots";

/** Just the projected-points number. The old hover breakdown panel was removed
 * — it overflowed small screens and the components view already explains the
 * model. `breakdown` is kept in the props (and the JSON) but only `provisional`
 * is read, to tint newcomers. */
export default function ProjectionCell({
  points,
  breakdown,
}: {
  points: number | null;
  breakdown?: ProjectionBreakdown;
}) {
  if (points === null || points === undefined) {
    return <span className="text-xs italic text-ink-faint">—</span>;
  }
  const provisional = breakdown?.provisional;
  return (
    <span
      className={`font-mono font-bold tabular-nums ${
        provisional ? "text-[var(--warn)]" : "text-[var(--accent)]"
      }`}
      title={
        provisional ? "provisional — newcomer, projected from a prior" : undefined
      }
    >
      {points.toFixed(1)}
      {provisional && <sup className="ml-0.5 text-[9px] font-normal">est</sup>}
    </span>
  );
}
