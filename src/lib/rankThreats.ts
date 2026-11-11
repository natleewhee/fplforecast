/** "What could still move my rank": plain-language lines for the Live tab,
 * built only from figures the live payload already carries (ownership from
 * bootstrap, fixtures, the live feed and the same xP decay maths the squad
 * uses). A line whose figure is missing is dropped, never filled in. Pure, so
 * it can be unit-tested without React. */

import {
  playerProjection,
  playerStatus,
  type LiveElement,
  type LivePayload,
  type PlayerStatus,
  type TrackerView,
} from "@/lib/liveBlend";
import { sgKickoff } from "@/lib/liveLabels";

export type RankThreatLine = {
  key: string;
  kind: "yours" | "missing";
  text: string;
};

const MAX_OWN = 2;
const MAX_MISSING = 3;
const toPlay = (s: PlayerStatus) => s === "notStarted" || s === "playing";
const pts = (n: number) => n.toFixed(1);

/** Minutes in the match being played (a double gameweek's second leg starts at 0). */
const legMins = (el: LiveElement | undefined) => el?.legMinutes ?? el?.minutes ?? 0;

/** "plays Sun 23:30 SGT", "is playing now (45')", or, for a live match he has not
 * come on in, no claim that he is playing. No kickoff time: no time phrase. */
function when(status: PlayerStatus, minutes: number, kickoff: string | null): string {
  if (status === "playing") {
    return minutes > 0 ? `is playing now (${minutes}')` : "has a match under way but no minutes yet";
  }
  return kickoff && Number.isFinite(Date.parse(kickoff)) ? `plays ${sgKickoff(kickoff)} SGT` : "has a match still to come";
}

/** The count line that leads the Live tab's "still to play" card: how many of
 * the side that counts (the XI, or all 15 on Bench Boost) have a match left. */
export function stillToPlayCount(view: TrackerView): { toPlay: number; total: number; side: "XI" | "15" } {
  const counting = view.rows.filter((r) => r.inLineup);
  return { toPlay: counting.filter((r) => toPlay(r.status)).length, total: counting.length, side: view.benchBoost ? "15" : "XI" };
}

export function buildRankThreats(
  payload: LivePayload,
  prev: LivePayload | null,
  view: TrackerView,
): RankThreatLine[] {
  const own: RankThreatLine[] = [];

  // Your own: who in the counting side still has a match to play.
  const pending = view.rows.filter((r) => r.inLineup && toPlay(r.status) && r.opponent != null);
  const xp = pending.length > 0 && pending.every((r) => !r.noBakedXp) ? pending.reduce((s, r) => s + r.remainingXp, 0) : null;
  const xpText = xp != null ? ` The model still expects about ${pts(xp)} pts from your ${pending.length} to play.` : "";
  const armband = pending.find((r) => r.isArmband);
  const others = pending.filter((r) => !r.isArmband);
  if (armband) {
    own.push({
      key: `cap-${armband.id}`,
      kind: "yours",
      text:
        `Your armband is on ${armband.webName}, who ${when(armband.status, legMins(payload.liveByElement[armband.id]), armband.kickoffTime)}: ` +
        `his points count ${payload.picks.chip === "3xc" ? "triple" : "double"}.` +
        (others.length === 0 ? xpText : ""),
    });
  }
  // Who is left, and when, is the card's count line and kickoff list above these lines;
  // only the model's expectation is new here.
  if (others.length > 0 && xp != null) {
    own.push({ key: "xi-pending", kind: "yours", text: xpText.trim() });
  }

  // Popular players you don't count: not in your squad, or on your bench.
  const rowById = new Map(view.rows.map((r) => [r.id, r]));
  const missing: RankThreatLine[] = [];
  for (const t of payload.threats ?? []) {
    if (missing.length >= MAX_MISSING) break;
    if (!Number.isFinite(t.ownedPct) || t.ownedPct <= 0 || t.opponent == null) continue;
    if (rowById.get(t.id)?.inLineup) continue; // subbed into your side: covered by the lines above
    const el = payload.liveByElement[t.id];
    const status = playerStatus(el, prev?.liveByElement[t.id], payload.generatedAt, prev?.generatedAt);
    if (!toPlay(status)) continue;
    const exp = t.components ? playerProjection(el, t.components, status).remainingXp : null;
    missing.push({
      key: `miss-${t.id}`,
      kind: "missing",
      text:
        `${Math.round(t.ownedPct)}% of managers own ${t.webName}, he ${when(status, legMins(el), t.kickoffTime)} vs ${t.opponent}, ` +
        (t.onBench ? "on your bench so his points only count if he is subbed in." : "not in your squad.") +
        (exp != null ? ` The model expects about ${pts(exp)} more pts.` : ""),
    });
  }
  return [...own.slice(0, MAX_OWN), ...missing];
}
