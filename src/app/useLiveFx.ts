"use client";

import { useEffect, useState } from "react";
import { loadFeed, saveFeed } from "@/lib/feedStore";
import type { TrackerRow } from "@/lib/liveBlend";
import { eventCounts, totalEvents, type EventCounts } from "@/lib/liveLabels";

/* Spots what changed between one poll and the next so the pitch can react:
 * a floating "+N" when a player's points go up (or down), a pop on a badge
 * that just appeared, and a flare when a goal goes in. The first set of rows
 * seen only seeds the baseline, so opening the tab mid-match animates nothing. */

export type Float = { key: string; id: number; delta: number };
/** One line in the "what just happened" feed: a player, what they did, and the
 * points it moved by (captain-doubled where it applies). */
export type FeedItem = {
  key: string;
  id: number;
  name: string;
  what: string[];
  delta: number;
  minutes: number;
  /** When it was seen (ms since epoch), so old events can be dropped on reload. */
  at: number;
};
type Snap = {
  points: Record<number, number>;
  events: Record<number, number>;
  counts: Record<number, EventCounts>;
  bonus: Record<number, number>;
  goals: number;
};
type Fx = { floats: Float[]; popped: Set<number>; goalFlare: number; seq: number; feed: FeedItem[] };

const FEED_MAX = 8;

const FLOAT_MS = 2600;

function snapshot(rows: TrackerRow[]): Snap {
  const points: Record<number, number> = {};
  const events: Record<number, number> = {};
  const counts: Record<number, EventCounts> = {};
  const bonus: Record<number, number> = {};
  let goals = 0;
  for (const r of rows) {
    points[r.id] = r.pointsSoFar;
    const c = eventCounts(r.breakdown);
    counts[r.id] = c;
    events[r.id] = totalEvents(c);
    bonus[r.id] = r.breakdown.find((b) => b.identifier === "bonus")?.value ?? 0;
    goals += c.goals;
  }
  return { points, events, counts, bonus, goals };
}

/** What changed for one player between two polls, in plain words. */
function whatHappened(before: EventCounts | undefined, now: EventCounts, bonusBefore: number, bonusNow: number): string[] {
  const b = before;
  const up = (k: keyof EventCounts) => now[k] > (b?.[k] ?? 0);
  const out: string[] = [];
  if (up("goals")) out.push(now.goals - (b?.goals ?? 0) > 1 ? "scored again" : "scored");
  if (up("assists")) out.push("assist");
  if (up("penSaved")) out.push("saved a penalty");
  if (up("penMissed")) out.push("missed a penalty");
  if (up("ownGoals")) out.push("own goal");
  if (up("red")) out.push("red card");
  if (up("yellow")) out.push("yellow card");
  if (up("cleanSheet")) out.push("clean sheet");
  if (up("defcon")) out.push("defensive contribution");
  if (bonusNow > bonusBefore) out.push(`bonus +${bonusNow - bonusBefore}`);
  return out;
}

export function useLiveFx(rows: TrackerRow[], gameweek: number, polledAt: number): Fx {
  const [seen, setSeen] = useState<Snap | null>(null);
  // The feed is remembered across a refresh or reopening the app mid-match.
  const [runId] = useState(() => Date.now().toString(36));
  const [fx, setFx] = useState<Fx>(() => ({
    floats: [],
    popped: new Set(),
    goalFlare: 0,
    seq: 0,
    feed: loadFeed(gameweek, Date.now()),
  }));
  const [last, setLast] = useState(rows);

  // Derived-state-from-props: compare once per new `rows` instead of in an effect.
  if (rows !== last) {
    setLast(rows);
    const now = snapshot(rows);
    if (seen) {
      const seq = fx.seq + 1;
      const floats: Float[] = [];
      const popped = new Set<number>();
      const entries: FeedItem[] = [];
      for (const r of rows) {
        const before = seen.points[r.id];
        if (before != null && Math.abs(r.pointsSoFar - before) >= 1) {
          floats.push({ key: `${seq}:${r.id}`, id: r.id, delta: r.pointsSoFar - before });
        }
        if ((seen.events[r.id] ?? 0) < now.events[r.id]) popped.add(r.id);
        if (before != null) {
          const what = whatHappened(seen.counts[r.id], now.counts[r.id], seen.bonus[r.id] ?? 0, now.bonus[r.id]);
          if (what.length) {
            entries.push({
              key: `${runId}:${seq}:${r.id}`,
              id: r.id,
              name: r.webName,
              what,
              delta: r.pointsSoFar - before,
              minutes: r.minutes,
              at: polledAt,
            });
          }
        }
      }
      if (floats.length || popped.size || entries.length) {
        setFx((f) => ({
          floats,
          popped,
          seq,
          feed: [...entries, ...f.feed].slice(0, FEED_MAX),
          goalFlare: now.goals > seen.goals ? f.goalFlare + 1 : f.goalFlare,
        }));
      }
    }
    setSeen(now);
  } else if (seen === null) {
    setSeen(snapshot(rows));
  }

  useEffect(() => {
    saveFeed(gameweek, fx.feed);
  }, [gameweek, fx.feed]);

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
