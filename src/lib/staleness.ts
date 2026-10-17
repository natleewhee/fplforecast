import { ageText } from "./time.ts";

/* How fresh the live numbers are, in words the Live tab can show. Pure so it
 * can be tested without a clock or a network. */

export type Staleness =
  | { level: "ok"; text: string }
  | { level: "stale" | "error" | "offline"; text: string };

/** After this long without a good poll while matches are live, say so. */
export const STALE_AFTER_MS = 150_000;

export function staleness(args: {
  lastOkMs: number | null;
  nowMs: number;
  active: boolean;
  error: string | null;
  online: boolean;
}): Staleness {
  const { lastOkMs, nowMs, active, error, online } = args;
  const age = lastOkMs == null ? null : nowMs - lastOkMs;
  const when = age == null ? "no update yet" : `last update ${ageText(age)}`;
  if (!online) return { level: "offline", text: `You're offline, ${when}. It will refresh when you're back.` };
  if (error) return { level: "error", text: `Live data unavailable, ${when}. Retrying.` };
  if (active && age != null && age > STALE_AFTER_MS) return { level: "stale", text: `Numbers are ${ageText(age).replace(" ago", " old")}.` };
  return { level: "ok", text: age == null ? "" : `updated ${ageText(age)}` };
}
