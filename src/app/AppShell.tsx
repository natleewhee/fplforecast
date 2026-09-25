"use client";

import { useEffect, useState, type ReactNode } from "react";
import type {
  BootstrapSnapshot,
  ChipStatus,
  Forecast,
  GameweekReview,
  OverridesFile,
  ParCalibration,
  RunningRecord,
} from "@/lib/snapshots";
import { OWNER_TEAM_ID, getClientTeamId, setClientTeamId } from "@/lib/teamId";
import { Card, Header, Module, Shell } from "./PageChrome";
import Pitch from "./Pitch";
import History from "./History";
import LiveTracker from "./LiveTracker";
import LeaguesPage from "./LeaguesPage";
import Scenarios from "./Scenarios";
import TransferForm from "./TransferForm";
import AppTabs from "./AppTabs";
import Carousel from "./Carousel";

function RunningRecordModule({ record }: { record: RunningRecord | null }) {
  if (!record || record.gameweeksScored === 0) {
    return (
      <Module label="Out-of-sample record">
        <p className="text-xs text-ink-soft">
          Fills in as gameweeks are scored — model vs baseline, out of sample.
        </p>
      </Module>
    );
  }
  return (
    <Module
      label={`Out-of-sample · ${record.gameweeksScored} GW`}
      accent={
        <span className={record.meaningful ? "chip chip-accent" : "chip"}>
          {record.meaningful ? "edge" : "no edge"}
        </span>
      }
    >
      <div className="flex items-end gap-4">
        <div>
          <div className="stat stat-glow text-2xl leading-none">
            {record.pooledDeltaPerGw > 0 ? "+" : ""}
            {record.pooledDeltaPerGw.toFixed(2)}
          </div>
          <div className="eyebrow mt-1">Δ per gameweek</div>
        </div>
        <div className="flex gap-3 text-xs text-ink-soft">
          <span className="stat">
            {record.modelTotal}
            <span className="ml-1 font-sans font-normal text-ink-faint">model</span>
          </span>
          <span className="stat">
            {record.baselineTotal}
            <span className="ml-1 font-sans font-normal text-ink-faint">base</span>
          </span>
        </div>
      </div>
    </Module>
  );
}

function ParCalibrationModule({ calibration }: { calibration: ParCalibration | null }) {
  if (!calibration || calibration.gameweeksScored === 0) {
    return (
      <Module label="Par calibration">
        <p className="text-xs text-ink-soft">
          Fills in as gameweeks are scored — how often the live tracker&apos;s par verdict
          correctly called whether your overall rank held.
        </p>
      </Module>
    );
  }
  const { hitRate, hitRateByVerdict } = calibration;
  const pct = (r: number | null) => (r == null ? "—" : `${Math.round(r * 100)}%`);
  return (
    <Module label={`Par calibration · ${calibration.gameweeksScored} GW`}>
      <div className="flex items-end gap-4">
        <div>
          <div className="stat stat-glow text-2xl leading-none">{pct(hitRate)}</div>
          <div className="eyebrow mt-1">hit rate</div>
        </div>
        <div className="flex gap-3 text-xs text-ink-soft">
          <span className="stat text-[var(--accent)]">
            {pct(hitRateByVerdict.green)}
            <span className="ml-1 font-sans font-normal text-ink-faint">green</span>
          </span>
          <span className="stat text-[var(--warn)]">
            {pct(hitRateByVerdict.amber)}
            <span className="ml-1 font-sans font-normal text-ink-faint">amber</span>
          </span>
          <span className="stat text-[var(--danger)]">
            {pct(hitRateByVerdict.red)}
            <span className="ml-1 font-sans font-normal text-ink-faint">red</span>
          </span>
        </div>
      </div>
    </Module>
  );
}

function GameweekReviewModule({ review }: { review: GameweekReview | null }) {
  if (!review || review.xiPoints == null) return null;
  const mvb = review.modelVsBaseline;
  const scored = mvb && "model" in mvb;
  const cap = review.captain;
  return (
    <Module
      label={`GW${review.gameweek} result`}
      accent={!review.dataChecked ? <span className="chip chip-warn">provisional</span> : null}
    >
      <div className="flex items-end gap-4">
        <div>
          <div className="stat text-3xl leading-none text-ink">{review.xiPoints}</div>
          <div className="eyebrow mt-1">points</div>
        </div>
        <div className="space-y-0.5 text-xs text-ink-soft">
          <div className="stat">
            {review.benchPoints ?? "—"}
            <span className="ml-1 font-sans font-normal text-ink-faint">bench</span>
          </div>
          {review.transfersCost > 0 && (
            <div className="text-[var(--danger)]">−{review.transfersCost} hit</div>
          )}
          {review.overallRank != null && (
            <div className="font-mono tabular-nums text-ink-faint">
              OR {review.overallRank.toLocaleString()}
            </div>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-2 text-[11px]">
        {cap && (
          <span className="tabular-nums text-ink-soft">
            <span className="text-ink-faint">C</span>{" "}
            <span className="font-medium text-ink">{cap.webName}</span> {cap.actual ?? "—"}×
            {cap.multiplier}
            {cap.actual != null && <span className="text-ink"> = {cap.actual * cap.multiplier}</span>}
          </span>
        )}
        {scored ? (
          <span className="tabular-nums text-ink-soft">
            model <span className="font-semibold text-ink">{mvb.model}</span> · base{" "}
            <span className="font-semibold text-ink">{mvb.baseline}</span>{" "}
            <span className={mvb.delta >= 0 ? "text-[var(--accent)]" : "text-[var(--danger)]"}>
              ({mvb.delta >= 0 ? "+" : ""}
              {mvb.delta})
            </span>
          </span>
        ) : (
          <span className="text-ink-faint">
            {mvb && "status" in mvb && mvb.status === "no_prediction"
              ? "no prediction logged"
              : "model vs baseline pending"}
          </span>
        )}
      </div>
    </Module>
  );
}

function CaptainModule({ forecast }: { forecast: Forecast }) {
  const edge = forecast.captainEdge;
  return (
    <Module
      label={`Captain · GW${forecast.targetGameweek}`}
      accent={
        forecast.overridesApplied > 0 ? (
          <span className="chip chip-warn">{forecast.overridesApplied} manual</span>
        ) : null
      }
    >
      <div className="flex items-end gap-3">
        <div>
          <div className="text-xl font-bold leading-none text-ink">
            {forecast.captain?.webName ?? "—"}
          </div>
          {forecast.captain?.points != null && (
            <div className="eyebrow mt-1">
              <span className="stat text-[var(--accent)]">{forecast.captain.points.toFixed(1)}</span>{" "}
              proj
            </div>
          )}
        </div>
      </div>
      {forecast.viceCaptain && (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-soft">
          <span>
            <span className="text-ink-faint">VC</span> {forecast.viceCaptain.webName}
            {forecast.viceCaptain.points != null && (
              <span className="tabular-nums"> ({forecast.viceCaptain.points.toFixed(1)})</span>
            )}
          </span>
          {edge && (
            <span className={edge.label === "clear edge" ? "chip chip-accent" : "chip"}>
              {edge.label} +{edge.points.toFixed(1)}
            </span>
          )}
        </div>
      )}
    </Module>
  );
}

/** A compact bar for switching whose team this page shows. Always visible
 * (not hidden behind a settings menu) since "type in any team ID" is the
 * whole point of this component's existence -- burying it would defeat the
 * feature it's here to expose. */
function TeamIdBar({
  teamId,
  teamName,
  managerName,
  onChange,
  onReset,
  loading,
  error,
}: {
  teamId: string;
  teamName?: string;
  managerName?: string;
  onChange: (id: string) => void;
  onReset: () => void;
  loading: boolean;
  error: string | null;
}) {
  const [draft, setDraft] = useState("");

  return (
    <div className="flex flex-wrap items-center gap-2 px-1 pb-1 pt-3">
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ""))}
        placeholder="Switch team ID"
        inputMode="numeric"
        className="h-11 w-40 rounded-lg border border-line bg-[var(--bg-2)] px-2.5 text-xs text-ink placeholder:text-ink-faint focus:border-[var(--accent)] focus:outline-none"
      />
      {/* h-11 (44px, adapt.md's minimum touch target -- see Carousel.tsx's
       * own comment) on every tappable control here, padding absorbing the
       * extra height rather than growing the text. */}
      <button
        className="inline-flex h-11 items-center rounded-lg border border-line px-2.5 text-xs font-medium text-ink-soft transition-colors hover:border-border-strong disabled:cursor-not-allowed disabled:opacity-50"
        disabled={!draft || loading}
        onClick={() => onChange(draft)}
      >
        {loading ? "Loading…" : "View"}
      </button>
      <button
        className="inline-flex h-11 items-center rounded-lg px-2.5 text-xs text-ink-faint underline"
        onClick={() => {
          setDraft("");
          onReset();
        }}
      >
        Switch team
      </button>
      {!loading && !error && (
        <span className="chip chip-accent">
          viewing {teamName ? `${teamName} (${managerName})` : `team ${teamId}`}
        </span>
      )}
      {error && <span className="text-xs text-[var(--danger)]">{error}</span>}
    </div>
  );
}

/** First-visit gate: shown whenever no team ID cookie exists yet, instead of
 * silently defaulting to this app's own team -- a visitor's dashboard should
 * never look like it's showing their team when it's actually someone else's
 * (KTD-style "don't assume" per the vault's own working rules). */
function TeamIdGate({
  onSubmit,
  loading,
  error,
}: {
  onSubmit: (id: string) => void;
  loading: boolean;
  error: string | null;
}) {
  const [draft, setDraft] = useState("");
  return (
    <>
      {/* Dimmed backdrop -- deliberately generic chrome, never this app's own
       * squad, so a first-time visitor never sees "someone's" data behind
       * the prompt and mistakes it for a preview of their own. */}
      <div aria-hidden className="pointer-events-none select-none blur-[2px] opacity-40">
        <Header subtitle="GW — · enter a team ID to begin" />
        <Shell>
          <div className="space-y-3 py-4">
            <div className="h-24 rounded-xl border border-line bg-[var(--bg-2)]" />
            <div className="h-24 rounded-xl border border-line bg-[var(--bg-2)]" />
            <div className="h-24 rounded-xl border border-line bg-[var(--bg-2)]" />
          </div>
        </Shell>
      </div>

      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
        <div className="w-full max-w-sm rounded-2xl border border-line bg-[var(--bg-1)] p-6 shadow-xl">
          <div className="flex flex-col items-center gap-3 text-center">
            <h1 className="text-lg font-semibold text-ink">Enter your FPL team ID</h1>
            <p className="text-xs text-ink-soft">
              Find it in the URL on the FPL site: fantasy.premierleague.com/entry/
              <span className="text-ink">123456</span>/event/…
            </p>
            <div className="flex w-full gap-2">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ""))}
                placeholder="e.g. 1168513"
                inputMode="numeric"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter" && draft && !loading) onSubmit(draft);
                }}
                className="h-11 flex-1 rounded-lg border border-line bg-[var(--bg-2)] px-3 text-sm text-ink placeholder:text-ink-faint focus:border-[var(--accent)] focus:outline-none"
              />
              {/* h-11 (44px, adapt.md's minimum touch target) here too --
               * this is the very first tap a new visitor makes. */}
              <button
                className="inline-flex h-11 items-center rounded-lg border border-line px-3 text-sm font-medium text-ink-soft transition-colors hover:border-border-strong disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!draft || loading}
                onClick={() => onSubmit(draft)}
              >
                {loading ? "Loading…" : "View squad"}
              </button>
            </div>
            {error && <span className="text-xs text-[var(--danger)]">{error}</span>}
          </div>
        </div>
      </div>
    </>
  );
}

export default function AppShell({
  initialForecast,
  bootstrap,
  initialChips,
  initialOverrides,
  footer,
}: {
  initialForecast: Forecast;
  bootstrap: BootstrapSnapshot;
  initialChips: ChipStatus[] | null;
  initialOverrides: OverridesFile | null;
  footer: ReactNode;
}) {
  // `null` means "no team ID cookie yet" -- shown as a prompt, never
  // defaulted to this app's own team, so a stranger's first visit never
  // looks like it's showing them their own squad when it isn't.
  const [teamId, setTeamId] = useState<string | null>(null);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isGuest = teamId !== OWNER_TEAM_ID;
  // Chip-usage badges and pending-transfer display are owner-only
  // conveniences (they read this app's own committed history/overrides) --
  // hidden rather than shown wrong for a guest lookup.
  const chips = isGuest ? null : initialChips;
  const overrides = isGuest ? null : initialOverrides;

  const loadTeam = async (id: string) => {
    if (id === OWNER_TEAM_ID) {
      setClientTeamId(OWNER_TEAM_ID);
      setTeamId(OWNER_TEAM_ID);
      setForecast(initialForecast);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    // api/forecast.py fits the same model the daily cron does, live, on a
    // cold container -- measured ~8s+ for that alone, before the FPL API
    // round trips. 45s gives real cold starts room while still surfacing a
    // clear message instead of leaving "Loading…" up forever if something
    // is actually stuck (a hung Vercel Function, a dropped connection).
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);
    try {
      const res = await fetch(`/api/forecast?teamId=${id}`, { signal: controller.signal });
      const text = await res.text();
      let json: Forecast | { error?: string };
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error(
          res.ok
            ? "Got an unreadable response -- try again in a moment."
            : `Server error (HTTP ${res.status}) -- try again in a moment.`,
        );
      }
      if (!res.ok) throw new Error((json as { error?: string }).error || `HTTP ${res.status}`);
      setClientTeamId(id);
      setTeamId(id);
      setForecast(json as Forecast);
    } catch (err) {
      const isAbort = err instanceof DOMException && err.name === "AbortError";
      setError(isAbort ? "Timed out -- the model's taking too long, try again." : (err as Error).message);
    } finally {
      clearTimeout(timeout);
      setLoading(false);
    }
  };

  const resetTeam = () => {
    setClientTeamId(null);
    setTeamId(null);
    setForecast(null);
    setError(null);
  };

  // On mount only: pick up a team ID a previous visit already chose, so the
  // switch survives a refresh without needing the (static) page itself to
  // know about it server-side. Deferred one tick (matching LiveTracker's own
  // first-poll pattern) so loadTeam's setState lands after mount, not
  // synchronously inside the effect.
  useEffect(() => {
    const stored = getClientTeamId();
    if (!stored) return;
    const t = setTimeout(() => loadTeam(stored), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!teamId || !forecast) {
    return <TeamIdGate onSubmit={loadTeam} loading={loading} error={error} />;
  }

  const liveTab = <LiveTracker lastGameweek={forecast.lastGameweek} />;
  const leaguesTab = <LeaguesPage />;

  const squadTab = (
    <>
      <Pitch forecast={forecast} />

      {chips && (
        <div className="flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <span
              key={c.name}
              className={c.remaining > 0 ? "chip chip-accent" : "chip opacity-50 line-through"}
            >
              {c.name} {c.remaining > 0 ? `(${c.remaining})` : "used"}
            </span>
          ))}
        </div>
      )}

      <Carousel>
        <CaptainModule forecast={forecast} />
        <GameweekReviewModule review={forecast.lastGameweek} />
        <RunningRecordModule record={forecast.runningRecord} />
        <ParCalibrationModule calibration={forecast.parCalibration} />
      </Carousel>

      {forecast.history && <History history={forecast.history} />}
    </>
  );

  const scenariosTab = (
    <>
      {forecast.scenarios && (
        <Scenarios
          scenarios={forecast.scenarios}
          pool={forecast.pool ?? []}
          squad={forecast.squad.players}
          forecastGw={forecast.targetGameweek}
          upcoming={forecast.upcoming}
          chips={chips}
        />
      )}

      {overrides &&
        overrides.basedOnGw === forecast.basedOnGameweek &&
        overrides.transfers.length > 0 && (
          <p className="font-mono text-[11px] text-ink-faint">
            pending: {overrides.transfers.map((t) => `out ${t.out} → in ${t.in}`).join(", ")}
          </p>
        )}

      {isGuest ? (
        <Card>
          <p className="text-xs text-ink-soft">
            Saving a transfer is only available for this app&apos;s own team.
          </p>
        </Card>
      ) : (
        <Card>
          <TransferForm
            squad={forecast.squad.players}
            allPlayers={bootstrap.players}
            basedOnGw={forecast.basedOnGameweek}
            bank={forecast.squad.bank}
          />
        </Card>
      )}
    </>
  );

  return (
    <>
      <Header
        subtitle={
          isGuest
            ? `GW${forecast.targetGameweek} · ${forecast.teamName ?? `team ${teamId}`}`
            : `GW${forecast.targetGameweek} · from your GW${forecast.basedOnGameweek} squad`
        }
      />
      <Shell>
        <TeamIdBar
          teamId={teamId}
          teamName={forecast.teamName}
          managerName={forecast.managerName}
          onChange={loadTeam}
          onReset={resetTeam}
          loading={loading}
          error={error}
        />
        <div className="pt-1">
          <AppTabs
            tabs={[
              { id: "live", label: "Live", content: liveTab },
              { id: "squad", label: "Squad", content: squadTab },
              { id: "scenarios", label: "Scenarios", content: scenariosTab },
              { id: "leagues", label: "Leagues", content: leaguesTab },
            ]}
          />
          {!isGuest && footer}
        </div>
      </Shell>
    </>
  );
}
