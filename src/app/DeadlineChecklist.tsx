"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { Forecast } from "@/lib/snapshots";
import { chipChecklist } from "@/lib/chips";
import { availabilityFlag, hasRiskData, risksForGameweek } from "@/lib/availability";
import { NO_PRICE_DATA, priceRow } from "@/lib/priceWatch";
import { countdown } from "@/lib/time";
import { lineupFor, resolveSwaps, type PendingSwap } from "@/lib/squadView";

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
  compact = false,
  children,
}: {
  status: RowStatus;
  label: string;
  detail?: string;
  /** One short line (the neutral "not in this build yet" rows and the info rows). */
  compact?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className={`flex items-start gap-2 ${compact ? "py-1" : "py-1.5"}`}>
      <span
        className="mt-1 h-2 w-2 shrink-0 rounded-full"
        style={{ background: DOT_COLOR[status] }}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-ink">{label}</div>
        {detail != null && <div className="text-[11px] text-ink-soft">{detail}</div>}
        {children}
      </div>
    </div>
  );
}

/** What FPL's risk kinds mean in two or three words. The full FPL sentence stays reachable. */
function riskPhrase(kind: string): string {
  if (kind === "suspension_risk") return "one yellow from a ban";
  if (kind === "loan_ineligible") return "loan-ban risk";
  return "flagged by FPL";
}

type Risk = { name: string; kind: string; notes: string };

/** "Tavernier, Groß: one yellow from a ban (FPL)": players grouped by what FPL flagged them for. */
function shortRisks(risks: Risk[]): string {
  const byKind = new Map<string, string[]>();
  for (const r of risks) {
    const names = byKind.get(r.kind) ?? [];
    if (!names.includes(r.name)) names.push(r.name);
    byKind.set(r.kind, names);
  }
  return [...byKind].map(([kind, names]) => `${names.join(", ")}: ${riskPhrase(kind)} (FPL)`).join("; ");
}

function RiskDetail({ risks }: { risks: Risk[] }) {
  const [open, setOpen] = useState(false);
  const full = risks.map((r) => `${r.name}: ${r.notes}`);
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? "checklist-risk-wording" : undefined}
        title={full.join(" ")}
        onClick={() => setOpen((o) => !o)}
        className="relative -my-1 flex min-h-11 w-full items-center justify-between gap-2 text-left text-[11px] text-ink-soft"
      >
        <span className="min-w-0">{shortRisks(risks)}</span>
        <span className="shrink-0 text-ink-faint" aria-hidden>
          {open ? "▴" : "▾"}
        </span>
      </button>
      {open && (
        <ul id="checklist-risk-wording" className="mb-1 space-y-0.5 text-[11px] text-ink-faint">
          {full.map((l, i) => (
            <li key={`${i}-${l}`}>{l}</li>
          ))}
        </ul>
      )}
    </>
  );
}

/** The Squad tab's quick view before targetGameweek's deadline -- pulls together decisions otherwise spread
 * across the Squad and Scenarios tabs (captain, injury risk, bench order,
 * whether to use a transfer, chips) into one glance. Reflects the last
 * daily forecast build, not real-time news -- see the "as of" line. */
export default function DeadlineChecklist({
  forecast,
  liveSquad,
  pending,
  pool,
}: {
  forecast: Forecast;
  /** with these, the captain row follows the same armband as the pitch and shortlist */
  liveSquad?: { id: number; position: string }[] | null;
  pending?: PendingSwap[];
  pool?: Forecast["pool"];
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [showClear, setShowClear] = useState(false);

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
  // showing "ready for the deadline?" against stale data would mislead). It
  // shows for the whole planning week now, as the Squad tab's quick view.
  if (hoursLeft <= 0) return null;

  const countdownStatus: RowStatus = hoursLeft < 3 ? "red" : hoursLeft < 24 ? "amber" : "info";

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

  // FPL's own suspension / loan-ban warnings for the whole squad (a benched
  // player still matters if he is the auto-sub). Quoted, never inferred.
  const riskList: Risk[] = forecast.squad.players.flatMap((p) =>
    risksForGameweek(p.availability, forecast.targetGameweek).map((r) => ({ name: p.webName, kind: r.kind, notes: r.notes })),
  );
  const riskKnown = hasRiskData(forecast.squad.players);
  // "FPL flags none" only holds when FPL's risk data is on every player; partial data is said as partial.
  const riskCovered = forecast.squad.players.filter((p) => Array.isArray(p.availability?.risks)).length;
  const riskComplete = riskCovered === forecast.squad.players.length;
  const riskStatus: RowStatus = !riskKnown ? "info" : riskList.length > 0 ? "amber" : riskComplete ? "ok" : "info";

  const price = priceRow(forecast.squad.players);
  // "Nothing near a change" folds away only when every player has price data and nothing moved this GW.
  const priceCovered = forecast.squad.players.filter((p) => p.priceWatch != null && Number.isFinite(p.priceWatch.percent)).length;
  const priceMoved = forecast.squad.players.some((p) => Number.isFinite(p.priceWatch?.changeThisGw) && p.priceWatch!.changeThisGw !== 0);
  const priceFold = price.status === "ok" && priceCovered === forecast.squad.players.length && !priceMoved;

  const topScenario = forecast.scenarios.byHorizon["1"]?.[0] ?? null;
  const transferDetail = !topScenario
    ? "No transfer scenario available yet."
    : topScenario.transfersIn.length === 0
      ? "Rolling your transfer is the best move this week -- no swap clears the gap."
      : `Best move: ${topScenario.transfersOut.map((p) => p.webName).join(", ")} → ${topScenario.transfersIn
          .map((p) => p.webName)
          .join(", ")} (${topScenario.netPoints >= 0 ? "+" : ""}${topScenario.netPoints.toFixed(1)} net pts)`;

  // The captain the pitch shows: the model's, unless saved or made transfers moved the armband.
  const resolved = resolveSwaps(forecast, liveSquad, pending, pool);
  const lineup = lineupFor(forecast, resolved);
  const byPlayerId = new Map(forecast.squad.players.map((p) => [p.id, p]));
  const nameOf = (id: number | null | undefined) =>
    id == null ? null : (resolved.swaps.get(id)?.webName ?? byPlayerId.get(id)?.webName ?? null);
  const swapped = resolved.swaps.size > 0;
  const capMoved = !!lineup && swapped && lineup.captainChanged;
  const viceMoved = !!lineup && swapped && !capMoved && lineup.viceChanged;
  const moved = capMoved || viceMoved;
  const captainName = moved ? nameOf(lineup!.captain) : (forecast.captain?.webName ?? null);
  const viceName = moved ? nameOf(lineup!.vice) : (forecast.viceCaptain?.webName ?? null);
  const edge = moved ? null : forecast.captainEdge; // the edge was the model's captain over the model's vice
  const captainStatus: RowStatus = !captainName ? "amber" : capMoved || edge?.label === "coin-flip" ? "amber" : "ok";
  const captainDetail = !captainName
    ? "No captain picked yet."
    : `${captainName}${viceName ? `, vice ${viceName}` : ""}${
        capMoved
          ? " -- the app moved the armband for your transfers; the model re-picks at the next rebuild"
          : viceMoved
            ? " -- vice adjusted for your transfers; the model re-picks at the next rebuild"
            : edge
              ? ` -- ${edge.label} (+${edge.points.toFixed(1)})`
              : ""
      }`;

  const chipRow = chipChecklist(forecast.chips, forecast.targetGameweek);

  // The checks with nothing to act on fold into one "all clear" line; the full sentences stay a tap away.
  const clear: { label: string; short: string; detail: string }[] = [];
  if (captainStatus === "ok")
    clear.push({ label: "Captain", short: `captain ${captainName}${viceMoved ? " (vice adjusted)" : ""}`, detail: captainDetail });
  if (injuryStatus === "ok") clear.push({ label: "Injury / doubt risk in your XI", short: "injury (no doubts in your XI)", detail: injuryDetail });
  if (riskStatus === "ok")
    clear.push({
      label: "Suspension / loan-ban risk (FPL)",
      short: "suspension (FPL flags none)",
      detail: `FPL flags no suspension or loan-ban risk in your squad for GW${forecast.targetGameweek}.`,
    });
  if (priceFold) clear.push({ label: "Price changes (FPL)", short: "price (none near a change)", detail: price.detail });
  if (benchStatus === "ok") clear.push({ label: "Bench order", short: "bench", detail: benchDetail });

  return (
    <div className="panel rise space-y-1 p-3 sm:p-4">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="font-mono text-[13px] font-bold tracking-[0.12em] text-ink">
          THIS WEEK&rsquo;S DECISIONS
        </h2>
        <span
          className="chip"
          style={{ color: DOT_COLOR[countdownStatus], borderColor: DOT_COLOR[countdownStatus] }}
        >
          {countdown(deadline, nowMs)}
        </span>
      </div>

      <div className="divide-y divide-[var(--line)]">
        {captainStatus === "ok" ? null : <ChecklistRow status={captainStatus} label="Captain" detail={captainDetail} />}
        {injuryStatus === "ok" ? null : <ChecklistRow status={injuryStatus} label="Injury / doubt risk in your XI" detail={injuryDetail} />}
        {riskStatus === "ok" ? null : !riskKnown ? (
          <ChecklistRow compact status="info" label="Suspension / loan-ban risk (FPL)" detail="Not in this build yet; arrives with the next daily update." />
        ) : riskList.length === 0 ? (
          <ChecklistRow compact status="info" label="Suspension / loan-ban risk (FPL)" detail={`FPL risk data covers ${riskCovered} of ${forecast.squad.players.length} players; none flagged among them.`} />
        ) : (
          <ChecklistRow status="amber" label="Suspension / loan-ban risk (FPL)">
            <RiskDetail risks={riskList} />
            {!riskComplete && (
              <div className="text-[10.5px] text-ink-faint">
                FPL risk data covers {riskCovered} of {forecast.squad.players.length} players.
              </div>
            )}
          </ChecklistRow>
        )}
        {priceFold ? null : price.detail === NO_PRICE_DATA ? (
          <ChecklistRow compact status="info" label="Price changes (FPL)" detail={price.detail} />
        ) : (
          <ChecklistRow status={price.status === "ok" ? "info" : price.status} label="Price changes (FPL)" detail={price.detail} />
        )}
        {benchStatus === "ok" ? null : <ChecklistRow status={benchStatus} label="Bench order" detail={benchDetail} />}
        <ChecklistRow compact status="info" label="Transfer" detail={transferDetail} />
        <ChecklistRow compact status={chipRow.status} label="Chips" detail={chipRow.detail} />
      </div>

      {clear.length > 0 && (
        <div className="border-t border-[var(--line)]">
          <button
            type="button"
            aria-expanded={showClear}
            aria-controls="checklist-clear"
            onClick={() => setShowClear((o) => !o)}
            className="flex min-h-11 w-full items-center gap-2 py-1.5 text-left"
          >
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: DOT_COLOR.ok }} aria-hidden />
            <span className="min-w-0 flex-1 text-[11px] text-ink-soft" data-testid="checklist-all-clear">
              <span className="font-medium text-ink">All clear:</span> {clear.map((c) => c.short).join(", ")}
            </span>
            <span className="shrink-0 text-ink-faint" aria-hidden>
              {showClear ? "▴" : "▾"}
            </span>
          </button>
          {showClear && (
            <div id="checklist-clear" className="divide-y divide-[var(--line)] pb-1">
              {clear.map((c) => (
                <ChecklistRow key={c.label} compact status="ok" label={c.label} detail={c.detail} />
              ))}
            </div>
          )}
        </div>
      )}

      <p className="mt-2 text-[10px] text-ink-faint">
        As of last night&rsquo;s build ({new Date(forecast.generatedAt).toLocaleString()}) -- not live news.
      </p>
    </div>
  );
}
