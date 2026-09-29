"use client";

import { useEffect, useState } from "react";
import type { ChipStatus, Forecast } from "@/lib/snapshots";
import { availabilityFlag } from "@/lib/availability";
import { countdown } from "@/lib/countdown";

type RowStatus = "ok" | "amber" | "red" | "info";

const DOT_COLOR: Record<RowStatus, string> = {
  ok: "var(--accent)",
  amber: "var(--warn)",
  red: "var(--danger)",
  info: "var(--ink-faint)",
};

function ChecklistRow({
  status,
  label,
  detail,
}: {
  status: RowStatus;
  label: string;
  detail: string;
}) {
  return (
    <div className="flex items-start gap-2 py-1.5">
      <span
        className="mt-1 h-2 w-2 shrink-0 rounded-full"
        style={{ background: DOT_COLOR[status] }}
        aria-hidden
      />
      <div className="min-w-0">
        <div className="text-xs font-medium text-ink">{label}</div>
        <div className="text-[11px] text-ink-soft">{detail}</div>
      </div>
    </div>
  );
}

/** A "ready for the deadline?" summary, shown only in the last 24h before
 * targetGameweek's deadline -- pulls together decisions otherwise spread
 * across the Squad and Scenarios tabs (captain, injury risk, bench order,
 * whether to use a transfer, chips) into one glance. Reflects the last
 * daily forecast build, not real-time news -- see the "as of" line. */
export default function DeadlineChecklist({
  forecast,
  chips,
}: {
  forecast: Forecast;
  chips?: ChipStatus[] | null;
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const deadline = forecast.deadlineTime;
  if (!deadline) return null;
  const diffMs = Date.parse(deadline) - nowMs;
  const hoursLeft = diffMs / (60 * 60 * 1000);
  // Hidden once the deadline has passed (picks then reflect last gameweek's
  // squad until it finishes, per docs/solutions/snapshot-picks-window.md --
  // showing "ready for the deadline?" against stale data would mislead) and
  // outside the 24h window Nat chose when this was planned.
  if (hoursLeft <= 0 || hoursLeft > 24) return null;

  const countdownStatus: RowStatus = hoursLeft < 3 ? "red" : "amber";

  const startingIds = new Set(forecast.squad.startingXi);
  const xiPlayers = forecast.squad.players.filter((p) => startingIds.has(p.id));
  const doubts = xiPlayers
    .map((p) => ({ player: p, flag: availabilityFlag(p.availability) }))
    .filter((d): d is { player: (typeof xiPlayers)[number]; flag: NonNullable<ReturnType<typeof availabilityFlag>> } => d.flag != null);
  const injuryStatus: RowStatus = doubts.some((d) => d.flag.color === "var(--danger)")
    ? "red"
    : doubts.length > 0
      ? "amber"
      : "ok";
  const injuryDetail =
    doubts.length === 0
      ? "No doubts flagged in your starting XI."
      : doubts.map((d) => `${d.player.webName} (${d.flag.label})`).join(", ");

  // Bench-order check is a simplification, not a full autosub simulation
  // (that needs formation-legality checking, overkill for a planning aid):
  // for each doubtful starter, whether the bench's next outfield player
  // (bench[1], since bench[0] is always the GK per squad.ts's own rule) is
  // also doubtful -- a reasonable proxy for "would the auto-sub also be a
  // doubt", not a guarantee of exactly who'd come on.
  const byId = new Map(forecast.squad.players.map((p) => [p.id, p]));
  const firstOutfieldSubId = forecast.squad.bench[1];
  const firstOutfieldSub = firstOutfieldSubId != null ? byId.get(firstOutfieldSubId) : null;
  const subDoubt = firstOutfieldSub ? availabilityFlag(firstOutfieldSub.availability) : null;
  const outfieldStarterDoubts = doubts.filter((d) => d.player.position !== "GKP");
  const benchStatus: RowStatus = outfieldStarterDoubts.length > 0 && subDoubt != null ? "amber" : "ok";
  const benchDetail =
    benchStatus === "amber"
      ? `Your bench's likely first sub in, ${firstOutfieldSub?.webName}, is also a doubt (${subDoubt?.label}).`
      : "Your bench order looks fine against today's doubts.";

  const topScenario = forecast.scenarios.byHorizon["1"]?.[0] ?? null;
  const transferDetail = !topScenario
    ? "No transfer scenario available yet."
    : topScenario.transfersIn.length === 0
      ? "Rolling your transfer is the best move this week -- no swap clears the gap."
      : `Best move: ${topScenario.transfersOut.map((p) => p.webName).join(", ")} → ${topScenario.transfersIn
          .map((p) => p.webName)
          .join(", ")} (${topScenario.netPoints >= 0 ? "+" : ""}${topScenario.netPoints.toFixed(1)} net pts)`;

  const edge = forecast.captainEdge;
  const captainStatus: RowStatus = edge?.label === "coin-flip" ? "amber" : "ok";
  const captainDetail = !forecast.captain
    ? "No captain picked yet."
    : `${forecast.captain.webName}${forecast.viceCaptain ? `, vice ${forecast.viceCaptain.webName}` : ""}${
        edge ? ` -- ${edge.label} (+${edge.points.toFixed(1)})` : ""
      }`;

  const chipNames = (chips ?? []).filter((c) => c.remaining > 0).map((c) => c.name);

  return (
    <div className="panel rise space-y-1 p-3 sm:p-4">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="font-mono text-[13px] font-bold tracking-[0.12em] text-ink">
          BEFORE THE DEADLINE
        </h2>
        <span
          className="chip"
          style={{ color: DOT_COLOR[countdownStatus], borderColor: DOT_COLOR[countdownStatus] }}
        >
          {countdown(deadline, nowMs)}
        </span>
      </div>

      <div className="divide-y divide-[var(--line)]">
        <ChecklistRow status={captainStatus} label="Captain" detail={captainDetail} />
        <ChecklistRow status={injuryStatus} label="Injury / doubt risk in your XI" detail={injuryDetail} />
        <ChecklistRow status={benchStatus} label="Bench order" detail={benchDetail} />
        <ChecklistRow status="info" label="Transfer" detail={transferDetail} />
        {chips != null && (
          <ChecklistRow
            status="info"
            label="Chips available"
            detail={chipNames.length ? chipNames.join(", ") : "None remaining"}
          />
        )}
      </div>

      <p className="mt-2 text-[10px] text-ink-faint">
        As of last night&rsquo;s build ({new Date(forecast.generatedAt).toLocaleString()}) -- not live news.
      </p>
    </div>
  );
}
