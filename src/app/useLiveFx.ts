"use client";

import { useEffect, useState } from "react";
import type { TrackerRow } from "@/lib/liveBlend";
import { eventCounts, totalEvents } from "@/lib/liveLabels";

/* Spots what changed between one poll and the next so the pitch can react:
 * a floating "+N" when a player's points go up (or down), a pop on a badge
 * that just appeared, and a flare when a goal goes in. The first set of rows
 * seen only seeds the baseline, so opening the tab mid-match animates nothing. */

export type Float = { key: string; id: number; delta: number };
type Snap = {
  points: Record<number, number>;
  events: Record<number, number>;
  goals: number;
};
type Fx = { floats: Float[]; popped: Set<number>; goalFlare: number; seq: number };

const FLOAT_MS = 2600;

function snapshot(rows: TrackerRow[]): Snap {
  const points: Record<number, number> = {};
  const events: Record<number, number> = {};
  let goals = 0;
  for (const r of rows) {
    points[r.id] = r.pointsSoFar;
    const c = eventCounts(r.breakdown);
    events[r.id] = totalEvents(c);
    goals += c.goals;
  }
  return { points, events, goals };
}

export function useLiveFx(rows: TrackerRow[]): Fx {
  const [seen, setSeen] = useState<Snap | null>(null);
  const [fx, setFx] = useState<Fx>({ floats: [], popped: new Set(), goalFlare: 0, seq: 0 });
  const [last, setLast] = useState(rows);

  // Derived-state-from-props: compare once per new `rows` instead of in an effect.
  if (rows !== last) {
    setLast(rows);
    const now = snapshot(rows);
    if (seen) {
      const seq = fx.seq + 1;
      const floats: Float[] = [];
      const popped = new Set<number>();
      for (const r of rows) {
        const before = seen.points[r.id];
        if (before != null && Math.abs(r.pointsSoFar - before) >= 1) {
          floats.push({ key: `${seq}:${r.id}`, id: r.id, delta: r.pointsSoFar - before });
        }
        if ((seen.events[r.id] ?? 0) < now.events[r.id]) popped.add(r.id);
      }
      if (floats.length || popped.size) {
        setFx((f) => ({
          floats,
          popped,
          seq,
          goalFlare: now.goals > seen.goals ? f.goalFlare + 1 : f.goalFlare,
        }));
      }
    }
    setSeen(now);
  } else if (seen === null) {
    setSeen(snapshot(rows));
  }

  // Floats are one-shot: clear them once their animation has played.
  useEffect(() => {
    if (!fx.floats.length && !fx.popped.size) return;
    const t = setTimeout(
      () => setFx((f) => ({ ...f, floats: [], popped: new Set() })),
      FLOAT_MS,
    );
    return () => clearTimeout(t);
  }, [fx.floats, fx.popped]);

  return fx;
}
