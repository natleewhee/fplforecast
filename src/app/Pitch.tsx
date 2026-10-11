"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import type { Forecast, ForecastPlayer, OpponentLeg } from "@/lib/snapshots";
import { availabilityFlag } from "@/lib/availability";
import { fdrColor } from "@/lib/teamColors";
import PlayerBreakdownSheet from "./PlayerBreakdownSheet";
import { PitchScene } from "./PitchScene";
import { RangeBar, Shirt, ShirtBadges } from "./Shirt";

function bandLabel(band: { floor: number; ceiling: number; bandProvisional: boolean } | null | undefined) {
  if (!band) return "";
  const range = `${band.floor.toFixed(1)}–${band.ceiling.toFixed(1)}`;
  return band.bandProvisional ? `${range} (provisional range)` : range;
}

// This app's recommended XI/captain is the only view shown (Baseline and
// Your XI were removed as a toggle per feedback -- the comparison deltas
// below the header ("vs no change", "vs baseline") still carry that
// information without needing a separate pitch view to switch to).
const MODEL_CAPTION =
  "This app's recommended XI and captain: scoring history, form and ICT, plus fixture difficulty and minutes risk.";

const POSITION_DOT: Record<string, string> = {
  GKP: "var(--gkp)",
  DEF: "var(--def)",
  MID: "var(--mid)",
  FWD: "var(--fwd)",
};
const ROWS = ["GKP", "DEF", "MID", "FWD"];
const fmtDelta = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}`;
const RING_FULL = 11; // xP that fills the ring

/* ---------- pitch furniture ---------- */

export { FieldMarkings } from "./PitchScene";

export function OppChip({ opponents }: { opponents: OpponentLeg[] }) {
  if (!opponents.length) return <span className="text-[9px] text-ink-faint">— blank —</span>;
  return (
    <span className="flex items-center justify-center gap-1">
      {opponents.map((o, i) => (
        <span key={i} className="flex items-center gap-0.5 text-[9px] text-ink-soft">
          <span
            className="h-1 w-1 rounded-full"
            style={{ background: fdrColor(o.fdrRating) }}
          />
          {o.wasHome ? "v" : "@"}
          {o.team ?? "?"}
        </span>
      ))}
    </span>
  );
}

type Tok = {
  id: number;
  webName: string;
  position: string;
  team: string;
  xp: number | null;
  provisional?: boolean;
  minutesRisk?: boolean;
  opponents: OpponentLeg[];
  breakdown?: ForecastPlayer["breakdown"];
  floorCeiling?: ForecastPlayer["floorCeiling"];
  availability?: ForecastPlayer["availability"];
};

/** Risk icons for a shirt: FPL's doubt flag and this model's minutes risk. */
export function riskBadges(
  availability: ForecastPlayer["availability"] | null | undefined,
  minutesRisk: boolean | undefined,
) {
  const doubt = availabilityFlag(availability);
  const items: { key: string; node: ReactNode; title: string }[] = [];
  if (doubt) {
    const out = doubt.color === "var(--danger)";
    items.push({
      key: "doubt",
      title: doubt.label,
      node: (
        <span className="font-black" style={{ color: doubt.color }}>
          {out ? "\u271A" : "!"}
        </span>
      ),
    });
  }
  if (minutesRisk) {
    items.push({
      key: "mins",
      title: "minutes risk: may not play a full match",
      node: <span className="text-[var(--warn)]">{"\u23F1\uFE0E"}</span>,
    });
  }
  return items;
}

function PlayerToken({
  t,
  isCaptain,
  isVice,
  bench = false,
  showRange = false,
  onSelect,
}: {
  t: Tok;
  isCaptain?: boolean;
  isVice?: boolean;
  bench?: boolean;
  showRange?: boolean;
  onSelect: (id: number, trigger: HTMLButtonElement) => void;
}) {
  const w = bench ? 42 : 56;
  const frac = t.xp != null ? t.xp / RING_FULL : 0;
  const bandTitle = bandLabel(t.floorCeiling);
  const doubt = availabilityFlag(t.availability);
  const badges = riskBadges(t.availability, t.minutesRisk);
  return (
    <button
      type="button"
      onClick={(e) => onSelect(t.id, e.currentTarget)}
      aria-label={`${t.webName}: ${t.xp != null ? t.xp.toFixed(1) : "no"} xP${
        bandTitle ? `, typical range ${bandTitle}` : ""
      }${doubt ? `, ${doubt.label}` : ""}, show breakdown`}
      className={`flex min-w-0 max-w-[4.4rem] flex-1 basis-0 flex-col items-center gap-0.5 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${bench ? "sm:max-w-[4.2rem]" : "sm:max-w-20"}`}
      title={[t.webName, bandTitle && `typical range ${bandTitle}`, doubt?.label]
        .filter(Boolean)
        .join(" — ")}
    >
      <div className="relative" style={{ width: w, height: Math.round((w * 52) / 56) }}>
        <Shirt
          team={t.team}
          position={t.position}
          width={w}
          label={t.xp != null ? t.xp.toFixed(1) : "\u2014"}
          tone={t.provisional ? "warn" : "ink"}
          progress={frac}
          progressColor={t.provisional ? "var(--warn)" : "var(--accent)"}
        />
        <ShirtBadges items={badges} />
        {(isCaptain || isVice) && (
          <span
            className={`armband absolute -right-1 -top-1 h-4 w-4 text-[9px] ${
              isCaptain ? "armband-captain" : "armband-vice"
            }`}
          >
            {isCaptain ? "C" : "V"}
          </span>
        )}
      </div>
      <span className="mt-1 flex max-w-full items-center gap-1">
        <span
          className="h-1 w-1 shrink-0 rounded-full"
          style={{ background: POSITION_DOT[t.position] ?? "var(--ink-soft)" }}
        />
        <span className="min-w-0 truncate text-[11px] font-semibold text-ink [text-shadow:0_1px_3px_rgba(0,0,0,0.85)]">
          {t.webName}
        </span>
      </span>
      {showRange && t.floorCeiling && (
        <RangeBar floor={t.floorCeiling.floor} ceiling={t.floorCeiling.ceiling} xp={t.xp} />
      )}
      <OppChip opponents={t.opponents} />
    </button>
  );
}

/* ---------- main ---------- */

export default function Pitch({ forecast }: { forecast: Forecast }) {
  const { squad, upcoming } = forecast;
  const byId = new Map(squad.players.map((p) => [p.id, p]));
  const [gwIdx, setGwIdx] = useState(0);
  const [showAllGws, setShowAllGws] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const openSheet = useCallback((id: number, trigger: HTMLButtonElement) => {
    triggerRef.current = trigger;
    setSelectedId(id);
  }, []);
  const closeSheet = useCallback(() => {
    setSelectedId(null);
    triggerRef.current?.focus();
  }, []);

  const active = upcoming[gwIdx] ?? upcoming[0];
  if (!active) return null;
  const isTargetGw = gwIdx === 0;

  // which eleven + captain -- always this app's recommended XI
  const xiIds = active.startingXi;
  const benchIds = active.bench;
  const captainId = active.captainId;
  const viceId = active.viceCaptainId;

  // per-player xP / opponents for the shown GW, from that gameweek's own
  // player entry (fixtures/minutes can differ gameweek to gameweek).
  const gwPlayerById = new Map(active.players.map((p) => [p.id, p]));
  const tok = (id: number): Tok | null => {
    const base = byId.get(id);
    if (!base) return null;
    const gp = gwPlayerById.get(id);
    return {
      id,
      webName: base.webName,
      position: base.position,
      team: base.team,
      xp: gp?.projectedPoints ?? null,
      provisional: gp?.provisional,
      minutesRisk: base.minutesRisk,
      opponents: gp?.opponents ?? [],
      breakdown: base.breakdown,
      floorCeiling: base.floorCeiling,
      availability: base.availability,
    };
  };

  const xi = xiIds.map(tok).filter(Boolean) as Tok[];
  const benched = benchIds.map(tok).filter(Boolean) as Tok[];
  const rows = ROWS.map((pos) => xi.filter((p) => p.position === pos)).filter((r) => r.length);

  const headline = active.points;

  return (
    <div className="space-y-4">
      {/* ===== the pitch ===== */}
      <div className="panel rise overflow-hidden p-3 sm:p-4">
        {/* GW rail -- collapsed to the current gameweek by default; "what's my
           score next week" is secondary to "what's my team right now". */}
        <div className="-mx-1 mb-3 flex items-center gap-1.5 overflow-x-auto px-1 pb-1">
          {(showAllGws ? upcoming : upcoming.slice(0, 1)).map((u, i) => {
            const on = i === gwIdx;
            return (
              <button
                key={u.gameweek}
                onClick={() => setGwIdx(i)}
                className={`shrink-0 rounded-xl border px-3 py-1.5 text-left transition ${
                  on
                    ? "border-[color-mix(in_srgb,var(--accent)_55%,transparent)] bg-[color-mix(in_srgb,var(--accent)_12%,transparent)]"
                    : "border-line hover:border-border-strong"
                }`}
              >
                <div className="font-mono text-[11px] font-bold tracking-wide text-ink">
                  GW{u.gameweek}
                </div>
                <div className={`stat text-xs ${on ? "text-[var(--accent)]" : "text-ink-soft"}`}>
                  {u.points.toFixed(0)}
                </div>
              </button>
            );
          })}
          {!showAllGws && upcoming.length > 1 && (
            <button
              onClick={() => setShowAllGws(true)}
              className="shrink-0 rounded-xl border border-line px-3 py-1.5 text-[11px] text-ink-faint transition hover:border-border-strong hover:text-ink-soft"
            >
              +{upcoming.length - 1} more
            </button>
          )}
        </div>

        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-mono text-[13px] font-bold tracking-[0.12em] text-ink">
              MODEL · GW{active.gameweek}
            </h2>
            {isTargetGw ? (
              <p className="mt-1 max-w-[26rem] text-[10.5px] leading-snug text-ink-faint">
                {MODEL_CAPTION}
              </p>
            ) : (
              <p className="eyebrow mt-0.5">projected lineup</p>
            )}
          </div>
          <div className="shrink-0 text-right">
            <div className="stat stat-glow text-2xl leading-none sm:text-3xl">
              {headline.toFixed(0)}
            </div>
            <div className="eyebrow mt-1">proj pts</div>
            {isTargetGw && (
              <details className="mt-0.5">
                <summary className="cursor-pointer list-none font-mono text-[10px] text-ink-faint hover:text-ink-soft">
                  {forecast.xiFloorCeiling.floor.toFixed(0)}–{forecast.xiFloorCeiling.ceiling.toFixed(0)}
                  {forecast.xiFloorCeiling.bandProvisional && " (prov.)"}
                </summary>
                <p className="mt-1 max-w-[10rem] text-left text-[10px] leading-snug text-ink-faint">
                  Likely range for the XI&rsquo;s total: one realised-residual standard deviation
                  either side of the projection.
                  {forecast.xiFloorCeiling.bandProvisional &&
                    " Provisional -- too little realised history yet, so this band is wider than it will settle to."}
                </p>
              </details>
            )}
          </div>
        </div>

        {isTargetGw && (
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <span className="chip">{fmtDelta(forecast.nextGw.deltaVsNoChange)} vs no change</span>
            <span className="chip">{fmtDelta(forecast.nextGw.deltaVsBaselineXi)} vs baseline</span>
            <span className="chip">agree {forecast.lineupAgreement}/11</span>
          </div>
        )}

        {/* broadcast pitch */}
        <PitchScene>
          <div className="space-y-5">
            {rows.map((row, i) => (
              <div key={i} className="flex justify-center gap-x-1 gap-y-4">
                {row.map((t) => (
                  <PlayerToken
                    key={t.id}
                    t={t}
                    isCaptain={t.id === captainId}
                    isVice={t.id === viceId}
                    showRange={isTargetGw}
                    onSelect={openSheet}
                  />
                ))}
              </div>
            ))}
          </div>
        </PitchScene>
        <p className="mt-2 text-[10.5px] leading-snug text-ink-faint">
          Number = expected points · the shirt outline fills as expected points rise · the blue bar
          under a name is the typical range (white tick = projection) · ✚ doubtful or out, ⏱ minutes
          risk · tap a player for the breakdown
        </p>

        {/* bench */}
        <div className="mt-3">
          <p className="eyebrow mb-1.5">Bench</p>
          <div className="flex gap-x-1 gap-y-3">
            {benched.map((t) => (
              <PlayerToken key={t.id} t={t} isCaptain={t.id === captainId} bench showRange={isTargetGw} onSelect={openSheet} />
            ))}
          </div>
        </div>

        {isTargetGw && (
          <details className="mt-3 border-t border-line pt-3">
            <summary className="cursor-pointer text-[11px] font-medium text-ink-soft hover:text-ink">
              Why this XI?
            </summary>
            <ul className="mt-2 space-y-1 font-mono text-[10.5px] leading-relaxed text-ink-faint [overflow-wrap:anywhere]">
              {(benchIds.map((id) => byId.get(id)).filter(Boolean) as ForecastPlayer[])
                .filter((p) => p.rationale)
                .map((p) => (
                  <li key={p.id}>
                    <span className="text-ink-soft">{p.webName}</span> benched — {p.rationale}
                  </li>
                ))}
            </ul>
          </details>
        )}
      </div>

      {selectedId != null && byId.get(selectedId) && (
        <PlayerBreakdownSheet
          player={byId.get(selectedId)!}
          xp={gwPlayerById.get(selectedId)?.projectedPoints ?? null}
          opponents={gwPlayerById.get(selectedId)?.opponents ?? []}
          gameweek={active.gameweek}
          isTargetGw={isTargetGw}
          onClose={closeSheet}
        />
      )}
    </div>
  );
}
