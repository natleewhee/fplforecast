"use client";

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import type {
  BootstrapSnapshot,
  Forecast,
  OverridesFile,
  ParCalibration,
  RunningRecord,
} from "@/lib/snapshots";
import {
  OWNER_TEAM_ID,
  getClientTeamId,
  setClientTeamId,
  getUrlTeamId,
  setUrlTeamId,
} from "@/lib/teamId";
import { Header, Module, Panel, Shell } from "./PageChrome";
import Pitch from "./Pitch";
import { PitchDataProvider } from "./pitch3d/Pitch3D";
import type { PitchKits, PitchLooks } from "@/lib/appearance";
import { usableLiveSquad, type LiveSquadFeed } from "@/lib/squadSync";
import DeadlineChecklist from "./DeadlineChecklist";
import DeadlineBanner from "./DeadlineBanner";
import History from "./History";
import LiveTracker from "./LiveTracker";
import LeaguesPage from "./LeaguesPage";
import RebuildButton from "./RebuildButton";
import RecapCard from "./RecapCard";
import Scenarios from "./Scenarios";
import TransferForm from "./TransferForm";
import AppTabs from "./AppTabs";
import {
  CLIENT_TIMEOUT_MS,
  INVALID_TEAM_ID_MESSAGE,
  NETWORK_MESSAGE,
  SLOW_LOAD_AFTER_MS,
  SLOW_LOAD_NOTE,
  TIMEOUT_MESSAGE,
  cleanTeamIdInput,
  forecastErrorMessage,
  isValidTeamIdInput,
} from "@/lib/forecastErrors";
import { STALE_AFTER_HOURS, describeAge, forecastAgeHours } from "@/lib/time";
import Carousel from "./Carousel";
import CaptainShortlist from "./CaptainShortlist";
import FixtureTicker from "./FixtureTicker";
import type { PendingTransfer } from "@/lib/transfers";
import type { TransferTools } from "./ReplaceSheet";

/** Thrown for a message that is already fit to show a person. */
class ForecastRequestError extends Error {}

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

/** What a guest sees instead of the model's record: that record is scored on the app
 * owner's own squad, so showing it beside someone else's team would pass off the
 * owner's numbers as theirs. */
function GuestRecordModule() {
  return (
    <Module label="Model record">
      <p className="text-xs text-ink-soft" data-testid="guest-record-empty">
        The model&apos;s scored record is kept for this app&apos;s own team, so it isn&apos;t shown for yours.
      </p>
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

/** The header's overflow button: "Copy link" and "Change team" live in this one
 * 44px menu instead of two pills, so they stay one tap away on every tab
 * without costing a row of screen. A real button (aria-haspopup, aria-expanded);
 * Arrow keys move, Escape closes and returns focus to the button. */
function TeamMenu({
  teamId,
  teamName,
  onChangeTeam,
}: {
  teamId: string;
  teamName?: string;
  onChangeTeam: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const copyLink = async () => {
    const url = `${window.location.origin}${window.location.pathname}?team=${teamId}`;
    // Web Share API on mobile (a share sheet beats a bare clipboard copy
    // there); clipboard everywhere else, including a share-sheet cancel.
    if (navigator.share) {
      try {
        await navigator.share({ url, title: teamName ? `${teamName} on GafferFPL` : "GafferFPL" });
        return;
      } catch {
        // user cancelled the share sheet, or the browser doesn't actually
        // support it despite the feature check -- fall through to clipboard
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard access denied -- nothing more to do silently; the address
      // bar itself already reflects this URL, so it can be copied by hand
    }
  };

  /** Closes the menu; focus goes back to its button unless something else takes it. */
  const closeMenu = (refocus = true) => {
    setMenuOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  // Opening moves focus to the first item, so the keyboard lands inside the menu.
  useEffect(() => {
    if (menuOpen) menuRef.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
  }, [menuOpen]);

  // A tap or focus anywhere outside the menu closes it.
  useEffect(() => {
    if (!menuOpen) return;
    const away = (e: Event) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("focusin", away);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("focusin", away);
    };
  }, [menuOpen]);

  const onMenuKeyDown = (e: ReactKeyboardEvent) => {
    if (!menuOpen) return;
    if (e.key === "Escape") {
      e.preventDefault();
      closeMenu();
      return;
    }
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      items[(i + 1) % items.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      items[(i - 1 + items.length) % items.length]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      items[items.length - 1]?.focus();
    } else if (e.key === "Tab") {
      setMenuOpen(false); // Tab carries on to wherever it was going
    }
  };

  const itemClass =
    "flex h-11 w-full items-center px-4 text-left text-xs font-medium text-ink-soft hover:bg-white/5 hover:text-ink";
  return (
    <div className="flex shrink-0 items-center gap-2">
      {copied && (
        <span role="status" className="text-xs font-medium text-[var(--accent)]">
          Link copied
        </span>
      )}
      <div className="relative" ref={menuRef} onKeyDown={onMenuKeyDown}>
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? "team-menu" : undefined}
          aria-label="Team options"
          data-testid="team-menu-button"
          onClick={() => setMenuOpen((v) => !v)}
          className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-line text-ink-soft transition-colors hover:border-border-strong"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
            <circle cx="5" cy="12" r="1.8" />
            <circle cx="12" cy="12" r="1.8" />
            <circle cx="19" cy="12" r="1.8" />
          </svg>
        </button>
        {menuOpen && (
          <div
            id="team-menu"
            role="menu"
            aria-label="Team options"
            className="absolute right-0 top-12 z-40 min-w-40 overflow-hidden rounded-xl border border-line bg-[var(--bg-2)] shadow-lg"
          >
            <button
              type="button"
              role="menuitem"
              className={itemClass}
              onClick={() => {
                closeMenu();
                void copyLink();
              }}
            >
              Copy link
            </button>
            <button
              type="button"
              role="menuitem"
              className={itemClass}
              onClick={() => {
                onChangeTeam();
                closeMenu(false);
              }}
            >
              Change team
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Whose team this page shows (one text line), plus the team-ID field when
 * "Change team" is chosen from the header menu. */
function TeamIdBar({
  teamId,
  teamName,
  managerName,
  onChange,
  onReset,
  editing,
  setEditing,
  loading,
  slow,
  error,
}: {
  teamId: string;
  teamName?: string;
  managerName?: string;
  onChange: (id: string) => void;
  onReset: () => void;
  editing: boolean;
  setEditing: (v: boolean) => void;
  loading: boolean;
  slow: boolean;
  error: string | null;
}) {
  const [draft, setDraft] = useState("");

  return (
    <div className="space-y-2 px-1 pb-1 pt-2" data-testid="team-bar">
      <p className="truncate text-xs text-ink-soft">
        {loading ? (
          "Loading…"
        ) : (
          <>
            <span className="text-ink-faint">Viewing </span>
            <span className="font-semibold text-ink">
              {teamName ? `${teamName} (${managerName})` : `team ${teamId}`}
            </span>
          </>
        )}
      </p>
      {error && (
        <p role="alert" className="text-xs text-[var(--danger)]">
          {error}
        </p>
      )}
      {/* always in the page, only its text changes, so screen readers announce it */}
      <p role="status" className={loading && slow ? "text-xs text-ink-soft" : "sr-only"}>
        {loading && slow ? SLOW_LOAD_NOTE : ""}
      </p>
      {editing && draft && !isValidTeamIdInput(draft) && (
        <p id="team-id-bar-hint" className="text-xs text-ink-soft">
          {INVALID_TEAM_ID_MESSAGE}
        </p>
      )}
      {editing && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(cleanTeamIdInput(e.target.value))}
            placeholder="Team ID"
            inputMode="numeric"
            aria-label="Team ID"
            aria-describedby={draft && !isValidTeamIdInput(draft) ? "team-id-bar-hint" : undefined}
            autoFocus
            className="h-11 w-36 rounded-lg border border-line bg-[var(--bg-2)] px-2.5 text-xs text-ink placeholder:text-ink-faint focus:border-[var(--accent)] focus:outline-none"
          />
          <button
            className="inline-flex h-11 items-center rounded-full bg-[var(--accent)] px-4 text-xs font-bold text-[var(--bg-0)] transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!isValidTeamIdInput(draft) || loading}
            onClick={() => {
              onChange(draft);
              setEditing(false);
              setDraft("");
            }}
          >
            View
          </button>
          <button
            className="inline-flex h-11 items-center rounded-lg px-2.5 text-xs text-ink-faint underline"
            onClick={() => {
              setDraft("");
              setEditing(false);
              onReset();
            }}
          >
            Switch team
          </button>
        </div>
      )}
    </div>
  );
}

/** Shown only while viewing a team via a shared `?team=` link that differs
 * from (or hasn't yet been saved as) this browser's own saved team --
 * confirms whose team is on screen before anything else, per Nat's own
 * choice when this was planned, rather than silently treating a link as
 * "now your default". */
function SharedLinkBanner({
  teamName,
  managerName,
  onMakeMine,
}: {
  teamName?: string;
  managerName?: string;
  onMakeMine: () => void;
}) {
  return (
    <div className="mx-1 mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--accent)]/40 bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] px-3 py-2 text-xs">
      <span className="text-ink">
        You&rsquo;re viewing <span className="font-semibold">{teamName ?? "this team"}</span>
        {managerName && <span className="text-ink-soft"> ({managerName})</span>}
      </span>
      <button
        type="button"
        onClick={onMakeMine}
        className="inline-flex h-11 items-center rounded-lg border border-line px-2.5 font-medium text-ink-soft transition-colors hover:border-border-strong"
      >
        Make this my team
      </button>
    </div>
  );
}

/** Warns when the forecast is older than a daily rebuild should ever leave it:
 * the squad, scenarios and any saved transfers on screen are then out of date,
 * and nothing else in the app says so. "Now" is read after mount -- this page
 * is built statically, so a server-side clock would be frozen at build time. */
function StaleForecastBanner({ generatedAt }: { generatedAt: string }) {
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    const id = setTimeout(() => setNowMs(Date.now()), 0);
    return () => clearTimeout(id);
  }, []);

  const hours = nowMs == null ? null : forecastAgeHours(generatedAt, nowMs);
  if (hours == null || hours < STALE_AFTER_HOURS) return null;
  return (
    <div
      role="status"
      className="mx-1 mt-3 rounded-lg border border-[var(--warn)]/40 bg-[color-mix(in_srgb,var(--warn)_10%,transparent)] px-3 py-2 text-xs text-ink"
    >
      <span className="font-semibold text-[var(--warn)]">Forecast is {describeAge(hours)} old.</span>{" "}
      <span className="text-ink-soft">
        Last rebuilt {new Date(generatedAt).toLocaleString()}. The daily rebuild may be failing, so your
        squad, scenarios and any saved transfers could be out of date.
      </span>
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
  slow,
  error,
}: {
  onSubmit: (id: string) => void;
  loading: boolean;
  slow: boolean;
  error: string | null;
}) {
  const [draft, setDraft] = useState("");
  const valid = isValidTeamIdInput(draft);
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
            <p className="text-xs text-ink">
              GafferFPL is a Fantasy Premier League decision tool for managers: it forecasts your next
              gameweek, picks your captain and tests transfers against your own squad.
            </p>
            <p className="text-xs text-ink-soft">
              Anyone can look up their own team. Saving transfers is only available for this
              app&apos;s own team.
            </p>
            <p className="text-xs text-ink-soft">
              Find it in the URL on the FPL site: fantasy.premierleague.com/entry/
              <span className="text-ink">123456</span>/event/…
            </p>
            <div className="flex w-full gap-2">
              <input
                value={draft}
                onChange={(e) => setDraft(cleanTeamIdInput(e.target.value))}
                placeholder="e.g. 1168513"
                inputMode="numeric"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter" && valid && !loading) onSubmit(draft);
                }}
                aria-label="FPL team ID"
                aria-describedby={draft && !valid ? "team-id-hint" : undefined}
                className="h-11 flex-1 rounded-lg border border-line bg-[var(--bg-2)] px-3 text-sm text-ink placeholder:text-ink-faint focus:border-[var(--accent)] focus:outline-none"
              />
              {/* h-11 (44px, adapt.md's minimum touch target) here too --
               * this is the very first tap a new visitor makes. */}
              <button
                className="inline-flex h-11 items-center rounded-lg border border-line px-3 text-sm font-medium text-ink-soft transition-colors hover:border-border-strong disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!valid || loading}
                onClick={() => onSubmit(draft)}
              >
                {loading ? "Loading…" : "View squad"}
              </button>
            </div>
            {draft && !valid && !loading && (
              <span id="team-id-hint" className="text-xs text-ink-soft">
                {INVALID_TEAM_ID_MESSAGE}
              </span>
            )}
            <span role="status" className={loading && slow ? "text-xs text-ink-soft" : "sr-only"}>
              {loading && slow ? SLOW_LOAD_NOTE : ""}
            </span>
            {error && (
              <span role="alert" className="text-xs text-[var(--danger)]">
                {error}
              </span>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

export default function AppShell({
  initialForecast,
  bootstrap,
  initialOverrides,
  pitchLooks,
  pitchKits,
  footer,
}: {
  initialForecast: Forecast;
  bootstrap: BootstrapSnapshot;
  initialOverrides: OverridesFile | null;
  /** Per-player height, skin and hair, and club kits, for the 3D Squad pitch. */
  pitchLooks?: PitchLooks;
  pitchKits?: PitchKits;
  footer: ReactNode;
}) {
  // `null` means "no team ID cookie yet" -- shown as a prompt, never
  // defaulted to this app's own team, so a stranger's first visit never
  // looks like it's showing them their own squad when it isn't.
  const [teamId, setTeamId] = useState<string | null>(null);
  // Mirrors the *saved* cookie (independent of `teamId`, which is whatever's
  // currently being viewed) -- lets a shared `?team=` link be viewed without
  // silently overwriting the browser's own saved team.
  const [savedTeamId, setSavedTeamId] = useState<string | null>(null);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  // Whether matches are live right now (reported by the Live tab), so the
  // recap card can fold itself away while there's football to watch.
  const [liveActive, setLiveActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A guest forecast can take ~10s on a cold start: after a few seconds say so.
  const [slow, setSlow] = useState(false);
  // Saved transfers waiting for the next rebuild. `null` until one is saved or
  // removed this visit, when the committed file's list is used. Shared by the
  // transfer form, the pitch's replace sheet and the deadline banner.
  const [pendingEdited, setPendingEdited] = useState<PendingTransfer[] | null>(null);

  const isGuest = teamId !== OWNER_TEAM_ID;
  // True only while looking at a team that differs from what's saved --
  // i.e. an unsaved `?team=` link, not a manual switch via TeamIdBar (which
  // always saves immediately, same as before this phase).
  const isViewingSharedLink = teamId != null && teamId !== savedTeamId;
  // Pending-transfer display is an owner-only convenience (it reads this
  // app's own committed overrides) -- hidden rather than shown wrong for a
  // guest lookup. Chip status is per team and rides in the forecast itself.
  const overrides = isGuest ? null : initialOverrides;

  // Only the newest lookup may touch state: switching team or resetting mid-load must
  // not be undone by a request the person has already walked away from.
  const requestSeq = useRef(0);
  const inFlight = useRef<AbortController | null>(null);

  const loadTeam = async (id: string, opts: { save?: boolean; quiet?: boolean } = {}) => {
    const save = opts.save ?? true;
    const seq = ++requestSeq.current;
    inFlight.current?.abort();
    inFlight.current = null;
    if (id === OWNER_TEAM_ID) {
      if (save) setClientTeamId(OWNER_TEAM_ID);
      setTeamId(OWNER_TEAM_ID);
      if (save) setSavedTeamId(OWNER_TEAM_ID);
      setForecast(initialForecast);
      setError(null);
      setUrlTeamId(OWNER_TEAM_ID);
      return;
    }
    if (!isValidTeamIdInput(id)) {
      // a stale bad cookie or ?team= value is not something the person just typed
      setLoading(false);
      if (!opts.quiet) setError(INVALID_TEAM_ID_MESSAGE);
      return;
    }
    setLoading(true);
    setError(null);
    setSlow(false);
    const slowTimer = setTimeout(() => setSlow(true), SLOW_LOAD_AFTER_MS);
    // api/forecast.py fits the same model the daily cron does, live, on a
    // cold container -- measured ~8s+ for that alone, before the FPL API
    // round trips. 45s gives real cold starts room while still surfacing a
    // clear message instead of leaving "Loading…" up forever if something
    // is actually stuck (a hung Vercel Function, a dropped connection).
    const controller = new AbortController();
    inFlight.current = controller;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, CLIENT_TIMEOUT_MS);
    try {
      const res = await fetch(`/api/forecast?teamId=${id}`, { signal: controller.signal });
      const text = await res.text();
      let json: (Forecast & { error?: unknown }) | null = null;
      try {
        json = JSON.parse(text);
      } catch {
        // handled below: an unreadable body is reported by status
      }
      if (seq !== requestSeq.current) return;
      if (!res.ok || !json) {
        const fromApp = !!json && typeof json.error === "string";
        throw new ForecastRequestError(forecastErrorMessage(res.ok ? 502 : res.status, id, fromApp));
      }
      if (save) {
        setClientTeamId(id);
        setSavedTeamId(id);
      }
      setTeamId(id);
      setForecast(json);
      setUrlTeamId(id);
    } catch (err) {
      if (seq !== requestSeq.current) return; // abandoned by the person, not a failure
      const isAbort = err instanceof DOMException && err.name === "AbortError";
      setError(
        isAbort && timedOut
          ? TIMEOUT_MESSAGE
          : err instanceof ForecastRequestError
            ? err.message
            : NETWORK_MESSAGE,
      );
    } finally {
      clearTimeout(timeout);
      clearTimeout(slowTimer);
      if (seq === requestSeq.current) {
        inFlight.current = null;
        setSlow(false);
        setLoading(false);
      }
    }
  };

  const resetTeam = () => {
    requestSeq.current++; // anything still in flight is now stale
    inFlight.current?.abort();
    inFlight.current = null;
    setLoading(false);
    setSlow(false);
    setClientTeamId(null);
    setUrlTeamId(null);
    setTeamId(null);
    setSavedTeamId(null);
    setForecast(null);
    setError(null);
  };

  const makeThisMyTeam = () => {
    if (!teamId) return;
    setClientTeamId(teamId);
    setSavedTeamId(teamId);
  };

  // On mount only: a `?team=` link takes precedence over the saved cookie
  // (viewed without being saved, unless it happens to match the cookie
  // already); otherwise pick up whatever a previous visit saved, so a
  // refresh survives without the (static) page itself knowing about it
  // server-side. Deferred one tick (matching LiveTracker's own first-poll
  // pattern) so loadTeam's setState lands after mount, not synchronously
  // inside the effect.
  useEffect(() => {
    const urlTeam = getUrlTeamId();
    const stored = getClientTeamId();
    const toLoad = urlTeam ?? stored;
    if (!toLoad) return;
    const t = setTimeout(() => {
      setSavedTeamId(stored);
      loadTeam(toLoad, { save: toLoad === stored, quiet: true });
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Your squad as FPL has it now. The forecast starts from the squad you held when the last gameweek
  // finished, so a transfer made since then is missing from it; the Squad pitch uses this to show it.
  const [teamEditing, setTeamEditing] = useState(false); // the header menu's "Change team" opens the team-ID field
  const [liveFeed, setLiveFeed] = useState<{ teamId: string; builtAt: string; feed: LiveSquadFeed } | null>(null);
  const forecastBuiltAt = forecast?.generatedAt;
  useEffect(() => {
    if (!teamId || !forecastBuiltAt) return;
    let stale = false;
    // `squad=1` asks for just the squad (a light request); the browser tests also use it to tell this call from the Live tab's
    const qs = teamId !== savedTeamId ? `?squad=1&teamId=${teamId}` : "?squad=1";
    fetch(`/api/live${qs}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { gameweek?: number; chip?: string | null; squad?: { id: number; position: string }[] } | null) => {
        if (stale) return;
        setLiveFeed(
          json?.squad && typeof json.gameweek === "number"
            ? { teamId, builtAt: forecastBuiltAt, feed: { gameweek: json.gameweek, chip: json.chip ?? null, squad: json.squad } }
            : null,
        );
      })
      .catch(() => {
        if (!stale) setLiveFeed(null);
      });
    return () => {
      stale = true;
    };
  }, [teamId, savedTeamId, forecastBuiltAt]);
  // only ever compared with the team and forecast it was fetched for
  const liveSquad =
    forecast && liveFeed && liveFeed.teamId === teamId && liveFeed.builtAt === forecast.generatedAt
      ? usableLiveSquad(liveFeed.feed, forecast.basedOnGameweek)
      : null;

  if (!teamId || !forecast) {
    return <TeamIdGate onSubmit={loadTeam} loading={loading} slow={slow} error={error} />;
  }

  const committedPending: PendingTransfer[] =
    overrides && overrides.basedOnGw === forecast.basedOnGameweek ? overrides.transfers : [];
  const pendingTransfers = pendingEdited ?? committedPending;
  // Only the app's own team can save transfers (the route enforces it too).
  const transferTools: TransferTools | undefined = isGuest
    ? undefined
    : {
        basedOnGw: forecast.basedOnGameweek,
        bank: forecast.squad.bank,
        pool: forecast.pool ?? [],
        allPlayers: bootstrap.players,
        pending: pendingTransfers,
        onPendingChange: setPendingEdited,
      };

  const liveTab = (
    <>
      <LiveTracker
        teamId={isViewingSharedLink ? teamId : null}
        onActive={setLiveActive}
      />
      <RecapCard teamId={isViewingSharedLink ? teamId : null} collapsed={liveActive} />
    </>
  );
  const leaguesTab = <LeaguesPage teamId={isViewingSharedLink ? teamId : null} />;

  const squadTab = (
    <>
      {/* First thing on the tab: after saving a transfer this is what you
       * reach for, so it shouldn't sit below the pitch. Own team only. */}
      {transferTools && (
        <div className="panel rise p-3">
          <RebuildButton builtAt={forecast.generatedAt} />
        </div>
      )}
      <DeadlineChecklist forecast={forecast} />
      <Pitch forecast={forecast} transferTools={transferTools} liveSquad={liveSquad} />
      <FixtureTicker forecast={forecast} liveSquad={liveSquad} pending={transferTools?.pending} pool={transferTools?.pool} />
      <CaptainShortlist forecast={forecast} liveSquad={liveSquad} pending={transferTools?.pending} pool={transferTools?.pool} />

      <Carousel>
        {isGuest && <GuestRecordModule />}
        {!isGuest && <RunningRecordModule record={forecast.runningRecord} />}
        {!isGuest && <ParCalibrationModule calibration={forecast.parCalibration} />}
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
          chips={forecast.chips ?? null}
        />
      )}

      {isGuest ? (
        <Panel>
          <p className="text-xs text-ink-soft">
            Saving a transfer is only available for this app&apos;s own team.
          </p>
        </Panel>
      ) : (
        <Panel>
          <TransferForm
            squad={forecast.squad.players}
            allPlayers={bootstrap.players}
            basedOnGw={forecast.basedOnGameweek}
            bank={forecast.squad.bank}
            pending={pendingTransfers}
            onPendingChange={setPendingEdited}
          />
        </Panel>
      )}
    </>
  );

  return (
    <>
      <Header
        actions={<TeamMenu teamId={teamId} teamName={forecast.teamName} onChangeTeam={() => { setError(null); setTeamEditing((v) => !v); }} />}
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
          editing={teamEditing}
          setEditing={setTeamEditing}
          loading={loading}
          slow={slow}
          error={error}
        />
        <StaleForecastBanner generatedAt={forecast.generatedAt} />
        <DeadlineBanner
          deadline={forecast.deadlineTime}
          gameweek={forecast.targetGameweek}
          pendingTransfers={isGuest ? 0 : pendingTransfers.length}
        />
        {isViewingSharedLink && (
          <SharedLinkBanner
            teamName={forecast.teamName}
            managerName={forecast.managerName}
            onMakeMine={makeThisMyTeam}
          />
        )}
        <div className="pt-1">
          <PitchDataProvider value={{ looks: pitchLooks, kits: pitchKits }}>
            <AppTabs
              deadline={forecast.deadlineTime}
              tabs={[
                { id: "live", label: "Live", content: liveTab },
                { id: "squad", label: "Squad", content: squadTab },
                { id: "scenarios", label: "Scenarios", content: scenariosTab },
                { id: "leagues", label: "Leagues", content: leaguesTab },
              ]}
            />
          </PitchDataProvider>
          {!isGuest && footer}
        </div>
      </Shell>
    </>
  );
}
