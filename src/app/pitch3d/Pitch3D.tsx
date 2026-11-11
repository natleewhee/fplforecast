"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { lookFor, type PitchKits, type PitchLooks, type Position } from "@/lib/appearance";
import { setPitchAmbient, setPitchView, usePitchAmbient, usePrefersReducedMotion, type PitchView } from "@/lib/pitchView";
import { decideCelebration, type CelebrationEvent } from "./celebrate";
import { formationSpots } from "./spots";
import type { FigureDef, StageHandle, StageState } from "./stage";

/* The 3D pitch used by the Live, Squad and Scenarios tabs: figures in kit
 * colours (height, skin and hair from the appearance data) and a name tag above every starter. The subs are
 * not on the pitch: they are a dashed team-sheet strip under it, in the order they would come on.
 * three.js is loaded only when a 3D pitch is on screen. */

type PitchData = { looks?: PitchLooks; kits?: PitchKits };
const PitchDataContext = createContext<PitchData>({});
export const PitchDataProvider = PitchDataContext.Provider;

export type Pitch3DPlayer = {
  id: number;
  webName: string;
  position: string;
  team: string;
  code?: number | null;
  /** The small line under the name: expected points, live points and minutes, and so on. */
  sub: string;
  subTone?: "accent" | "warn" | "faint";
  role?: "C" | "V" | null;
  /** 0..1: fades a player who has not played yet, or is off. */
  dim?: number;
  /** For a sub: his place among the outfield subs (1 = first to come on). A goalkeeper sub shows "GK". */
  benchOrder?: number;
  /** What he did this gameweek, so he can celebrate when tapped. */
  goals?: number;
  cleanSheet?: boolean;
  ariaLabel: string;
  title: string;
  badges?: { key: string; node: ReactNode; title: string }[];
};

const ROW_ORDER: Position[] = ["GKP", "DEF", "MID", "FWD"];
const FALLBACK_KIT = { shirt: "#8a95a3", shorts: "#2b323b", socks: "#8a95a3" };

/** Where everyone stands. Pure, so the layout is the same on every render. */
function buildDefs(xi: Pitch3DPlayer[], data: PitchData): FigureDef[] {
  const def = (p: Pitch3DPlayer, at: { x: number; z: number }, isBench: boolean): FigureDef => {
    const position = (ROW_ORDER as string[]).includes(p.position) ? (p.position as Position) : "MID";
    const look = lookFor(data.looks, p.code, position);
    const club = data.kits?.[p.team];
    const kit = club ? (position === "GKP" ? club.gk : club) : FALLBACK_KIT;
    return {
      id: p.id,
      name: p.webName,
      kit: { shirt: kit.shirt, shorts: kit.shorts, socks: kit.socks },
      cm: look.cm,
      skin: look.skin,
      hair: look.hair,
      captain: p.role === "C",
      bench: isBench,
      dim: p.dim,
      goals: p.goals,
      cleanSheet: p.cleanSheet,
      x: at.x,
      z: at.z,
    };
  };
  const rows = ROW_ORDER.map((pos) => xi.filter((p) => p.position === pos)).filter((r) => r.length);
  const placed = formationSpots(rows.map((r) => r.length));
  const out: FigureDef[] = [];
  rows.forEach((row, r) => row.forEach((p, i) => out.push(def(p, placed[r][i], false))));
  return out;
}

/** The 3D / 2D switch, shared by every pitch, with the passing switch beside it in 3D. */
export function ViewSwitch({ view, onChange }: { view: PitchView; onChange?: (v: PitchView) => void }) {
  const passing = usePitchAmbient();
  const reduced = usePrefersReducedMotion();
  return (
    <div className="flex items-center gap-2">
      {view === "3d" && !reduced && (
        <button
          type="button"
          aria-pressed={passing}
          onClick={() => setPitchAmbient(!passing)}
          className={`h-8 rounded-lg border px-2.5 text-[11px] font-semibold transition ${passing ? "border-[color-mix(in_srgb,var(--accent)_50%,transparent)] text-[var(--accent)]" : "border-line text-ink-faint hover:text-ink-soft"}`}
          title="The ball goes round the pitch while nobody is selected. Switch off to save battery."
        >
          Passing {passing ? "on" : "off"}
        </button>
      )}
      <div className="inline-flex overflow-hidden rounded-lg border border-line text-[11px] font-semibold" role="group" aria-label="Pitch view">
        {(["3d", "2d"] as const).map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
            onClick={() => (onChange ?? setPitchView)(v)}
            className={`h-8 px-3 transition ${view === v ? "bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] text-[var(--accent)]" : "text-ink-faint hover:text-ink-soft"}`}
          >
            {v.toUpperCase()}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Pitch3D({
  xi,
  bench,
  selectedId = null,
  onSelect,
  onUnavailable,
  goals,
  compact: compactCard = false,
}: {
  xi: Pitch3DPlayer[];
  bench: Pitch3DPlayer[];
  selectedId?: number | null;
  /** Tapping a player. Leave out where there is nothing to open (the tags then are not buttons). */
  onSelect?: (id: number, trigger: HTMLButtonElement) => void;
  /** Called if this device cannot run WebGL, so the parent can show the 2D pitch. */
  onUnavailable: () => void;
  /** Live goals from the latest poll: a starter who scored celebrates on his own (see celebrate.ts for the rules). */
  goals?: CelebrationEvent[];
  /** A pitch inside a card (a scenario): when the card is narrow (under 340px) it gets a taller frame and smaller, shorter name tags, so the eleven fit without touching. */
  compact?: boolean;
}) {
  const data = useContext(PitchDataContext);
  const rootRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const tagsRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<StageHandle | null>(null);
  const [cardWidth, setCardWidth] = useState(0);
  const compact = compactCard && cardWidth < 340; // narrow until measured: phones come first
  useEffect(() => {
    const el = rootRef.current;
    if (!el || !compactCard || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setCardWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [compactCard]);
  const [ready, setReady] = useState(false);
  const [visible, setVisible] = useState(false);
  const [state, setState] = useState<StageState>({ focusId: null, celebrating: null });
  const passing = usePitchAmbient();
  const passingRef = useRef(passing);
  useEffect(() => {
    passingRef.current = passing;
  });
  const onSelectRef = useRef(onSelect);
  const onUnavailableRef = useRef(onUnavailable);
  useEffect(() => {
    onSelectRef.current = onSelect;
    onUnavailableRef.current = onUnavailable;
  });

  // The figures depend only on this string, so a re-render with the same lineup rebuilds nothing.
  const defsJson = JSON.stringify(buildDefs(xi, data));

  // A 3D scene holds a GPU context, and a phone allows only a few. Hidden tabs and
  // collapsed cards are not on screen, so they get none until they are.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    // no IntersectionObserver (very old browsers): treat it as on screen
    if (typeof IntersectionObserver === "undefined") {
      const t = setTimeout(() => setVisible(true), 0);
      return () => clearTimeout(t);
    }
    const io = new IntersectionObserver((es) => setVisible(es[es.length - 1].isIntersecting), { rootMargin: "120px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let handle: StageHandle | null = null;
    void import("./stage").then(({ createStage }) => {
      if (cancelled || !hostRef.current || !tagsRef.current) return;
      try {
        handle = createStage({
          host: hostRef.current,
          tagLayer: tagsRef.current,
          onState: setState,
          onPass: (n) => {
            // straight onto the element: a pass should not re-render the whole pitch
            if (rootRef.current) rootRef.current.dataset.passes = String(n);
          },
          ambient: passingRef.current,
          onPick: (id) => {
            const el = rootRef.current?.querySelector<HTMLButtonElement>(`button[data-tag="${id}"]`);
            if (el) onSelectRef.current?.(id, el);
          },
        });
      } catch {
        onUnavailableRef.current();
        return;
      }
      stageRef.current = handle;
      setReady(true);
    });
    return () => {
      cancelled = true;
      stageRef.current = null;
      handle?.dispose();
      setReady(false);
    };
  }, [visible]);

  useEffect(() => {
    if (ready) stageRef.current?.setPlayers(JSON.parse(defsJson) as FigureDef[]);
  }, [ready, defsJson]);
  useEffect(() => {
    if (!ready) return;
    stageRef.current?.setSelected(selectedId);
  }, [ready, selectedId, defsJson]);

  // The ball goes round while nobody is selected, if passing is on.
  useEffect(() => {
    if (ready) stageRef.current?.setAmbient(passing);
  }, [ready, passing]);

  // A new live goal makes the scorer celebrate where he stands. The rules are in decideCelebration;
  // this only keeps the bookkeeping: events already dealt with, and the one pending event if busy.
  const reduced = usePrefersReducedMotion();
  const handled = useRef(new Set<string>());
  const pending = useRef<CelebrationEvent | null>(null);
  const xiIds = xi.map((p) => p.id).join(",");
  const celebrating = state.celebrating;
  useEffect(() => {
    const run = (ev: CelebrationEvent, fresh: boolean) => {
      const verdict = decideCelebration(ev, {
        handled: fresh ? handled.current : new Set(),
        reducedMotion: reduced,
        tabHidden: typeof document !== "undefined" && document.hidden,
        onScreen: visible && ready,
        onPitch: xiIds.split(",").includes(String(ev.id)),
        selectedId,
        busy: celebrating !== null,
      });
      if (fresh) handled.current.add(ev.key);
      // the stage may be busy after all (two goals in one poll): keep the later one pending. Any other refusal drops it.
      if (verdict === "queue" || (verdict === "play" && stageRef.current?.celebrate(ev.id, ev.kind) === "busy")) pending.current = ev;
    };
    // a pending event goes first once the stage is free, as long as nothing else has become a reason not to
    if (celebrating === null && pending.current) {
      const ev = pending.current;
      pending.current = null;
      run(ev, false);
    }
    for (const ev of goals ?? []) if (!handled.current.has(ev.key)) run(ev, true);
  }, [goals, celebrating, reduced, visible, ready, selectedId, xiIds]);
  // a tap or a leave-the-page ends the wait: nothing queued should fire later out of context
  useEffect(() => {
    if (selectedId != null || !visible) pending.current = null;
  }, [selectedId, visible]);

  // Bring the pitch up under the sticky bar when a player is tapped, so it sits clear of the card that
  // opens below. Straight up or down only: scrolling an element into view can also push the page sideways.
  // Only on a new tap, not each time the live numbers refresh.
  useEffect(() => {
    if (!ready || selectedId == null || !hostRef.current) return;
    const top = hostRef.current.getBoundingClientRect().top + window.scrollY - 72;
    window.scrollTo({ top: Math.max(0, top), left: window.scrollX, behavior: "smooth" });
  }, [ready, selectedId]);

  const subColor = (p: Pitch3DPlayer) =>
    p.subTone === "warn" ? "text-[var(--warn)]" : p.subTone === "faint" ? "text-ink-faint" : "text-[var(--accent)]";
  const roleBadge = (p: Pitch3DPlayer) =>
    p.role ? (
      <span className="rounded-sm bg-[#f3b94d] px-[3px] text-[9px] font-black leading-[12px] text-[#1a1305]">{p.role}</span>
    ) : null;
  const badges = (p: Pitch3DPlayer, size: string) =>
    (p.badges ?? []).map((b) => (
      <span key={b.key} className={size} title={b.title}>
        {b.node}
      </span>
    ));

  /** One tappable name tag; a plain label where there is nothing to open. */
  const tagProps = (p: Pitch3DPlayer, className: string) => ({
    "data-tag": p.id,
    "aria-label": p.ariaLabel,
    title: p.title,
    className: `${className} ${p.id === selectedId ? "ring-1 ring-white/70" : ""}`,
  });
  const tagEl = (p: Pitch3DPlayer, className: string, children: ReactNode) =>
    onSelect ? (
      <button key={p.id} type="button" onClick={(e) => onSelect(p.id, e.currentTarget)} {...tagProps(p, className)}>
        {children}
      </button>
    ) : (
      <div key={p.id} role="group" {...tagProps(p, className)}>
        {children}
      </div>
    );

  // Floating tags carry the whole surname on one line, and the number with the player's icons
  // (goals, assists, clean sheet, cards, bonus) on the next, so a good game shows at a glance.
  const floating = (p: Pitch3DPlayer) =>
    tagEl(
      p,
      `group pointer-events-auto absolute left-0 top-0 flex flex-col items-center rounded-md border border-white/15 bg-[rgba(8,16,24,0.82)] leading-tight text-ink will-change-transform focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] data-[tag-size=sm]:max-w-[3.6rem] data-[tag-size=xs]:max-w-[2.6rem] ${compact ? "max-w-[4.4rem] px-1 py-0" : "max-w-[9rem] px-1.5 py-px"}`,
      <>
        <span className={`flex max-w-full items-center ${compact ? "gap-0.5" : "gap-1"} group-data-[tag-size=xs]:hidden`}>
          {roleBadge(p)}
          <span className={`min-w-0 truncate font-bold text-white group-data-[tag-size=sm]:text-[9px] ${compact ? "text-[10px]" : "text-[11px]"}`}>{p.webName}</span>
        </span>
        <span className="flex max-w-full items-center justify-center gap-1">
          <span className={`font-mono font-semibold ${compact ? "text-[9.5px]" : "text-[10.5px]"} ${subColor(p)}`}>{p.sub}</span>
          {compact && (p.badges?.length ?? 0) > 0 && (
            <span className="text-[10px] font-black leading-none text-[var(--warn)]" aria-hidden>
              !
            </span>
          )}
          {!compact && badges(p, "text-[10px] leading-none")}
        </span>
      </>,
    );

  const kitColor = (p: Pitch3DPlayer) => {
    const club = data.kits?.[p.team];
    return club ? (p.position === "GKP" ? club.gk.shirt : club.shirt) : "#8a95a3";
  };

  return (
    <div
      ref={rootRef}
      data-testid="pitch3d"
      data-focus={state.focusId ?? undefined}
      data-celebrating={state.celebrating ?? undefined}
    >
      <div ref={hostRef} className={`relative w-full scroll-mt-16 overflow-hidden ${compact ? "aspect-[5/6]" : "aspect-[6/5]"}  rounded-xl bg-[#0a1a14] [contain:paint]`}>
        <div ref={tagsRef} className="pointer-events-none absolute inset-0">
          {ready && xi.map(floating)}
        </div>
        {!ready && <p className="absolute inset-0 grid place-items-center text-xs text-ink-faint">Loading the 3D pitch…</p>}
      </div>
      {bench.length > 0 && (
        <div className="mt-2.5" data-testid="subs-strip">
          <p className="eyebrow mb-1.5 flex items-baseline gap-1.5">
            Subs <span className="font-sans text-[10px] font-normal normal-case tracking-normal text-ink-faint">in the order they come on</span>
          </p>
          <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${Math.min(bench.length, compact ? 2 : 4)}, minmax(0, 1fr))` }}>
            {bench.map((p, i) =>
              tagEl(
                p,
                "relative flex min-h-11 min-w-0 flex-col items-center justify-center gap-0.5 overflow-hidden rounded-lg border border-dashed border-white/30 bg-[rgba(8,16,24,0.45)] px-0.5 pb-1 pt-1.5 text-center leading-tight focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]",
                <>
                  <span className="absolute inset-x-0 top-0 h-[3px]" style={{ background: kitColor(p) }} aria-hidden />
                  <SubName name={p.webName} />
                  <span className="flex flex-wrap items-center justify-center gap-1">
                    <span
                      className="grid h-4 min-w-4 place-items-center rounded-full bg-white/15 px-1 text-[9px] font-bold text-ink-soft"
                      title={p.position === "GKP" ? "Substitute goalkeeper" : `Sub number ${p.benchOrder ?? i}: comes on after the ones before`}
                    >
                      {p.position === "GKP" ? "GK" : (p.benchOrder ?? i)}
                    </span>
                    <span className={`font-mono text-[10.5px] font-semibold ${subColor(p)}`}>{p.sub}</span>
                    {badges(p, "text-[10px] leading-none")}
                  </span>
                </>,
              ),
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** A sub's name on the tile: wraps between words (after a hyphen or at a space), never inside one; a word
 * wider than the tile is cut with an ellipsis instead. */
function SubName({ name }: { name: string }) {
  const words = name.match(/\S+?(?:-|(?=\s|$))\s*/g) ?? [name];
  return (
    <span
      className="flex max-w-full flex-wrap justify-center text-[9px] font-bold leading-tight text-white/90 min-[380px]:text-[10px]"
      title={name}
      data-testid="sub-name"
    >
      {words.map((w, i) => (
        <span key={i} className={`min-w-0 max-w-full truncate ${/\s$/.test(w) ? "mr-[0.25em]" : ""}`}>
          {w.trimEnd()}
        </span>
      ))}
    </span>
  );
}
