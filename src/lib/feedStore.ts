import type { FeedItem } from "@/app/useLiveFx";

/* The "what just happened" feed only fills while the page is open, so a
 * refresh or reopening the app mid-match would wipe it. Keep the last few
 * events in the browser, per gameweek, and drop anything older than a few
 * hours so a stale feed never greets the next match day. */

export const FEED_KEEP = 8;
export const FEED_MAX_AGE_MS = 4 * 60 * 60 * 1000;

const key = (gameweek: number) => `gaffer-feed:${gameweek}`;

/** Newest first, recent only, at most FEED_KEEP, and only well-formed rows. */
export function pruneFeed(items: unknown, nowMs: number): FeedItem[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter(
      (x): x is FeedItem =>
        !!x &&
        typeof x.key === "string" &&
        typeof x.id === "number" &&
        typeof x.name === "string" &&
        Array.isArray(x.what) &&
        typeof x.delta === "number" &&
        typeof x.minutes === "number" &&
        typeof x.at === "number" &&
        nowMs - x.at <= FEED_MAX_AGE_MS,
    )
    .slice(0, FEED_KEEP);
}

export function loadFeed(gameweek: number, nowMs: number): FeedItem[] {
  try {
    return pruneFeed(JSON.parse(localStorage.getItem(key(gameweek)) ?? "[]"), nowMs);
  } catch {
    return [];
  }
}

export function saveFeed(gameweek: number, feed: FeedItem[]): void {
  try {
    localStorage.setItem(key(gameweek), JSON.stringify(feed.slice(0, FEED_KEEP)));
  } catch {
    // storage unavailable: the feed just won't survive a refresh
  }
}
