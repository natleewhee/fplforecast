"use client";

import { useState, type ReactNode } from "react";
import type { Forecast, ForecastPlayer, OpponentLeg } from "@/lib/snapshots";
import { fdrColor, kitFor } from "@/lib/teamColors";

function bandLabel(band: { floor: number; ceiling: number; bandProvisional: boolean } | null | undefined) {
  if (!band) return "";
  const range = `${band.floor.toFixed(1)}–${band.ceiling.toFixed(1)}`;
  return band.bandProvisional ? `${range} (provisional range)` : range;
}

type ViewMode = "model" | "baseline" | "yours";
const MODE_LABEL: Record<ViewMode, string> = {
  model: "Model",
  baseline: "Baseline",
  yours: "Your XI",
};

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

function FieldMarkings() {
  const line = "rgba(255,255,255,0.16)";
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 300 440"
      preserveAspectRatio="none"
      aria-hidden
    >
      <g fill="none" stroke={line} strokeWidth="1.5">
        <rect x="6" y="6" width="288" height="428" rx="4" />
        <line x1="6" y1="220" x2="294" y2="220" />
        <circle cx="150" cy="220" r="46" />
        <circle cx="150" cy="220" r="2.5" fill={line} stroke="none" />
        {/* top box */}
        <rect x="66" y="6" width="168" height="66" />
        <rect x="108" y="6" width="84" height="26" />
        <path d="M112 72 A44 44 0 0 0 188 72" />
        {/* bottom box */}
        <rect x="66" y="368" width="168" height="66" />
        <rect x="108" y="408" width="84" height="26" />
        <path d="M112 368 A44 44 0 0 1 188 368" />
      </g>
    </svg>
  );
}

function Ring({
  frac,
  color,
  size,
  children,
}: {
  frac: number;
  color: string;
  size: number;
  children: ReactNode;
}) {
  const deg = Math.max(0, Math.min(1, frac)) * 360;
  return (
    <div
      className="relative grid place-items-center rounded-full shadow-[0_2px_10px_-2px_rgba(0,0,0,0.6)]"
      style={{
        width: size,
        height: size,
        background: `conic-gradient(${color} ${deg}deg, rgba(255,255,255,0.16) 0deg)`,
      }}
    >
      <div className="absolute inset-[3.5px] grid place-items-center rounded-full ring-1 ring-black/30">
        {children}
      </div>
    </div>
  );
}

function ShirtGlyph({ fill }: { fill: string }) {
  // faint kit silhouette behind the number
  return (
    <svg viewBox="0 0 48 44" className="absolute inset-0 h-full w-full opacity-25" aria-hidden>
      <path
        d="M17 6 L10 10 L4 20 L11 25 L13 21 L13 40 Q24 44 35 40 L35 21 L37 25 L44 20 L38 10 L31 6 Q24 12 17 6 Z"
        fill={fill}
      />
    </svg>
  );
}

function OppChip({ opponents }: { opponents: OpponentLeg[] }) {
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
};

function PlayerToken({
  t,
  isCaptain,
  isVice,
  bench = false,
}: {
  t: Tok;
  isCaptain?: boolean;
  isVice?: boolean;
  bench?: boolean;
}) {
  const kit = kitFor(t.team);
  const size = bench ? 40 : 52;
  const frac = t.xp != null ? t.xp / RING_FULL : 0;
  const ringColor = t.provisional ? "var(--warn)" : "var(--accent)";
  const bandTitle = bandLabel(t.floorCeiling);
  return (
    <div
      className={`flex w-[4.4rem] flex-col items-center gap-0.5 ${bench ? "sm:w-[4.2rem]" : "sm:w-20"}`}
      title={bandTitle ? `${t.webName} — typical range ${bandTitle}` : t.webName}
    >
      <div className="relative">
        <Ring frac={frac} color={ringColor} size={size}>
          <div
            className="grid h-full w-full place-items-center overflow-hidden rounded-full"
            style={{ background: kit.primary }}
          >
            <ShirtGlyph fill={kit.ink} />
            <span
              className="relative font-mono font-bold tabular-nums"
              style={{ color: kit.ink, fontSize: bench ? 11 : 13 }}
            >
              {t.xp != null ? t.xp.toFixed(1) : "—"}
            </span>
          </div>
        </Ring>
        {(isCaptain || isVice) && (
          <span
            className={`absolute -right-1 -top-1 grid h-4 w-4 place-items-center rounded-full text-[9px] font-black ${
              isCaptain ? "bg-[var(--accent)] text-black" : "bg-[var(--border-strong)] text-ink"
            }`}
          >
            {isCaptain ? "C" : "V"}
          </span>
        )}
        {t.minutesRisk && (
          <span
            className="absolute -bottom-0.5 -left-0.5 h-2 w-2 rounded-full border border-[var(--bg-0)] bg-[var(--warn)]"
            title="minutes risk"
          />
        )}
      </div>
      <span className="flex items-center gap-1">
        <span
          className="h-1 w-1 rounded-full"
          style={{ background: POSITION_DOT[t.position] ?? "var(--ink-soft)" }}
        />
        <span className="max-w-[4.2rem] truncate text-[11px] font-semibold text-ink">
          {t.webName}
        </span>
      </span>
      <OppChip opponents={t.opponents} />
    </div>
  );
}

/* ---------- main ---------- */

export default function Pitch({ forecast }: { forecast: Forecast }) {
  const { squad, upcoming } = forecast;
  const byId = new Map(squad.players.map((p) => [p.id, p]));
  const [gwIdx, setGwIdx] = useState(0);
  const [mode, setMode] = useState<ViewMode>("model");

  const active = upcoming[gwIdx] ?? upcoming[0];
  if (!active) return null;
  const isTargetGw = gwIdx === 0;
  const effMode: ViewMode = isTargetGw ? mode : "model";

  // which eleven + captain
  let xiIds: number[];
  let benchIds: number[];
  let captainId: number | null;
  let viceId: number | null;
  if (effMode === "baseline") {
    xiIds = squad.baselineXi;
    benchIds = squad.baselineBench;
    captainId = squad.baselineCaptainId;
    viceId = null;
  } else if (effMode === "yours") {
    xiIds = squad.yourXi;
    benchIds = squad.yourBench;
    captainId = squad.yourCaptainId;
    viceId = null;
  } else {
    xiIds = active.startingXi;
    benchIds = active.bench;
    captainId = active.captainId;
    viceId = active.viceCaptainId;
  }

  // per-player xP / opponents for the shown GW+mode
  const gwPlayerById = new Map(active.players.map((p) => [p.id, p]));
  const tok = (id: number): Tok | null => {
    const base = byId.get(id);
    if (!base) return null;
    const gp = gwPlayerById.get(id);
    // baseline / yours at the target GW: score on the model's target-GW points
    const useSquad = effMode !== "model";
    return {
      id,
      webName: base.webName,
      position: base.position,
      team: base.team,
      xp: useSquad ? base.projectedPoints ?? null : gp?.projectedPoints ?? null,
      provisional: useSquad ? base.provisional : gp?.provisional,
      minutesRisk: base.minutesRisk,
      opponents: useSquad ? base.opponents : gp?.opponents ?? [],
      breakdown: base.breakdown,
      floorCeiling: base.floorCeiling,
    };
  };

  const xi = xiIds.map(tok).filter(Boolean) as Tok[];
  const benched = benchIds.map(tok).filter(Boolean) as Tok[];
  const rows = ROWS.map((pos) => xi.filter((p) => p.position === pos)).filter((r) => r.length);

  // headline total for this view
  let headline = active.points;
  if (effMode === "baseline")
    headline = forecast.nextGw.points - forecast.nextGw.deltaVsBaselineXi;
  if (effMode === "yours")
    headline = forecast.nextGw.points - forecast.nextGw.deltaVsNoChange;
  const vsModel = headline - forecast.nextGw.points;

  return (
    <div className="space-y-4">
      {/* ===== the pitch ===== */}
      <div className="panel rise overflow-hidden p-3 sm:p-4">
        {/* GW rail */}
        <div className="-mx-1 mb-3 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {upcoming.map((u, i) => {
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
        </div>

        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-mono text-[13px] font-bold tracking-[0.12em] text-ink">
              {isTargetGw ? MODE_LABEL[mode].toUpperCase() : "MODEL"} · GW{active.gameweek}
            </h2>
            {isTargetGw ? (
              <div className="mt-1 segment">
                {(Object.keys(MODE_LABEL) as ViewMode[]).map((m) => (
                  <button key={m} data-active={mode === m} onClick={() => setMode(m)}>
                    {MODE_LABEL[m]}
                  </button>
                ))}
              </div>
            ) : (
              <p className="eyebrow mt-0.5">projected lineup</p>
            )}
          </div>
          <div className="shrink-0 text-right">
            <div className="stat stat-glow text-2xl leading-none sm:text-3xl">
              {headline.toFixed(0)}
            </div>
            <div className="eyebrow mt-1">proj pts</div>
            {isTargetGw && effMode === "model" && (
              <div
                className="mt-0.5 font-mono text-[10px] text-ink-faint"
                title="Safety-score band: one realised-residual stdev either side, aggregated over the XI assuming independence"
              >
                {forecast.xiFloorCeiling.floor.toFixed(0)}–{forecast.xiFloorCeiling.ceiling.toFixed(0)}
                {forecast.xiFloorCeiling.bandProvisional && " (provisional)"}
              </div>
            )}
          </div>
        </div>

        {isTargetGw && (
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            {effMode === "model" ? (
              <>
                <span className="chip">{fmtDelta(forecast.nextGw.deltaVsNoChange)} vs no change</span>
                <span className="chip">
                  {fmtDelta(forecast.nextGw.deltaVsBaselineXi)} vs baseline
                </span>
                <span className="chip">
                  agree {forecast.lineupAgreement}/11
                </span>
              </>
            ) : (
              <span className={vsModel >= 0 ? "chip chip-accent" : "chip chip-danger"}>
                {fmtDelta(vsModel)} vs model XI
              </span>
            )}
          </div>
        )}

        {/* broadcast pitch */}
        <div
          className="relative rounded-2xl px-1 py-6"
          style={{
            background:
              "linear-gradient(160deg,#0f5130,#0c3f26 45%,#0a3421)",
          }}
        >
          <FieldMarkings />
          <div className="relative z-10 space-y-5">
            {rows.map((row, i) => (
              <div key={i} className="flex flex-wrap justify-center gap-x-2 gap-y-3">
                {row.map((t) => (
                  <PlayerToken
                    key={t.id}
                    t={t}
                    isCaptain={t.id === captainId}
                    isVice={t.id === viceId}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* bench */}
        <div className="mt-3">
          <p className="eyebrow mb-1.5">Bench</p>
          <div className="flex flex-wrap gap-x-2 gap-y-2">
            {benched.map((t) => (
              <PlayerToken key={t.id} t={t} isCaptain={t.id === captainId} bench />
            ))}
          </div>
        </div>

        {isTargetGw && effMode === "model" && (
          <ul className="mt-3 space-y-1 border-t border-line pt-3 font-mono text-[10.5px] leading-relaxed text-ink-faint [overflow-wrap:anywhere]">
            {(benchIds.map((id) => byId.get(id)).filter(Boolean) as ForecastPlayer[])
              .filter((p) => p.rationale)
              .map((p) => (
                <li key={p.id}>
                  <span className="text-ink-soft">{p.webName}</span> benched — {p.rationale}
                </li>
              ))}
          </ul>
        )}
      </div>
    </div>
  );
}
