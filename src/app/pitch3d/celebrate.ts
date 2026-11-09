/* When may a live goal make a player celebrate on his own? Pure and three-free, so the rules are
 * unit-tested without a browser. The page calls this once per event and acts on the answer. */

export type CelebrationEvent = {
  /** Unique per event (run, poll, player, kind): the same event is never played twice. */
  key: string;
  id: number;
  kind: "goal";
  /** How many polls had been compared when it arrived: 0 would be the first poll after load. */
  poll: number;
};

export type CelebrationContext = {
  /** Keys already dealt with (played, queued or dropped). */
  handled: ReadonlySet<string>;
  reducedMotion: boolean;
  /** document.hidden */
  tabHidden: boolean;
  /** The 3D pitch is on screen. */
  onScreen: boolean;
  /** He is one of the starters drawn on the pitch (not a sub). */
  onPitch: boolean;
  selectedId: number | null;
  /** Another celebration is playing. */
  busy: boolean;
};

/** play: now. queue: keep as the one pending event, play when free. drop: never (and do not retry). */
export type CelebrationVerdict = "play" | "queue" | "drop";

export function decideCelebration(ev: CelebrationEvent, c: CelebrationContext): CelebrationVerdict {
  if (c.handled.has(ev.key)) return "drop";
  if (ev.poll < 1) return "drop"; // the first poll would replay the whole day's goals
  if (c.reducedMotion || c.tabHidden || !c.onScreen || !c.onPitch) return "drop";
  if (c.selectedId != null) return "drop";
  if (c.busy) return "queue";
  return "play";
}
