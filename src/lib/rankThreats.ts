/** "What could still move my rank": plain-language lines for the Live tab,
 * built only from figures the live payload already carries (ownership from
 * bootstrap, fixtures, the live feed and the same xP decay maths the squad
 * uses). A line whose figure is missing is dropped, never filled in. Pure, so
 * it can be unit-tested without React. */

import { playerProjection, playerStatus, type LivePayload, type PlayerStatus, type TrackerView } from "@/lib/liveBlend";
import { sgKickoff } from "@/lib/liveLabels";

export type RankThreatLine = {
  key: string;
  kind: "yours" | "missing";
  text: string;
};

const MAX_OWN = 2;
const MAX_MISSING = 3;
const toPlay = (s: PlayerStatus) => s === "notStarted" || s === "playing";
const pts = (n: number) => `${n.toFixed(1)}`;

function listNames(names: string[]): string {
  if (names.length <= 3) return names.join(", ");
  return `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
}

export function buildRankThreats(
  payload: LivePayload,
  prev: LivePayload | null,
  view: TrackerView,
): RankThreatLine[] {
  const lines: RankThreatLine[] = [];

  // Your own: who in the counting XI still has a match to play.
  const pending = view.rows.filter((r) => r.inLineup && toPlay(r.status) && r.opponent != null);
  const armband = pending.find((r) => r.isArmband);
  if (armband) {
    const when =
      armband.status === "playing"
        ? `is playing now (${armband.minutes}')`
        : `plays ${sgKickoff(armband.kickoffTime)} SGT`;
    lines.push({
      key: `cap-${armband.id}`,
      kind: "yours",
      text: `Your armband is on ${armband.webName}, who ${when}: his points count ${payload.picks.chip === "3xc" ? "triple" : "double"}.`,
    });
  }
  const others = pending.filter((r) => !r.isArmband);
  if (others.length > 0) {
    const xp = pending.every((r) => !r.noBakedXp) ? pending.reduce((s, r) => s + r.remainingXp, 0) : null;
    lines.push({
      key: "xi-pending",
      kind: "yours",
      text:
        `${others.length} more of your XI ${others.length === 1 ? "has" : "have"} a match left: ${listNames(others.map((r) => r.webName))}.` +
        (xp != null ? ` The model still expects about ${pts(xp)} pts from your ${pending.length} to play.` : ""),
    });
  }

  // Popular players you don't own who still have a match.
  let missing = 0;
  for (const t of payload.threats ?? []) {
    if (missing >= MAX_MISSING) break;
    if (!Number.isFinite(t.ownedPct) || t.ownedPct <= 0 || t.opponent == null) continue;
    const el = payload.liveByElement[t.id];
    const status = playerStatus(el, prev?.liveByElement[t.id], payload.generatedAt, prev?.generatedAt);
    if (!toPlay(status)) continue;
    const when =
      status === "playing" ? `is playing now (${el?.minutes ?? 0}')` : `plays ${sgKickoff(t.kickoffTime)} SGT`;
    const xp = t.components ? playerProjection(el, t.components, status).remainingXp : null;
    lines.push({
      key: `miss-${t.id}`,
      kind: "missing",
      text:
        `${Math.round(t.ownedPct)}% of managers own ${t.webName}, he ${when} vs ${t.opponent}, not in your squad.` +
        (xp != null ? ` The model expects about ${pts(xp)} more pts.` : ""),
    });
    missing += 1;
  }

  const own = lines.filter((l) => l.kind === "yours").slice(0, MAX_OWN);
  return [...own, ...lines.filter((l) => l.kind === "missing")];
}
