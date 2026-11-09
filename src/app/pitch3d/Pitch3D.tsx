"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { lookFor, type PitchKits, type PitchLooks, type Position } from "@/lib/appearance";
import { setPitchAmbient, setPitchView, usePitchAmbient, type PitchView } from "@/lib/pitchView";
import { benchSeat, formationSpots } from "./spots";
import type { FigureDef, StageHandle, StageState } from "./stage";

/* The 3D pitch used by the Live, Squad and Scenarios tabs: figures in kit
 * colours (height, skin and hair from the appearance data), the bench seated
 * behind the far goal line, and a name tag with a number above every starter.
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
function buildDefs(xi: Pitch3DPlayer[], bench: Pitch3DPlayer[], data: PitchData): FigureDef[] {
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
  bench.forEach((p, i) => out.push(def(p, benchSeat(i), true)));
  return out;
}

/** The 3D / 2D switch, shared by every pitch, with the passing switch beside it in 3D. */
export function ViewSwitch({ view, onChange }: { view: PitchView; onChange?: (v: PitchView) => void }) {
  const passing = usePitchAmbient();
  return (
    <div className="flex items-center gap-2">
      {view === "3d" && (
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
}: {
  xi: Pitch3DPlayer[];
  bench: Pitch3DPlayer[];
  selectedId?: number | null;
  /** Tapping a player. Leave out where there is nothing to open (the tags then are not buttons). */
  onSelect?: (id: number, trigger: HTMLButtonElement) => void;
  /** Called if this device cannot run WebGL, so the parent can show the 2D pitch. */
  onUnavailable: () => void;
}) {
  const data = useContext(PitchDataContext);
  const rootRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const tagsRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<StageHandle | null>(null);
  const [ready, setReady] = useState(false);
  const [visible, setVisible] = useState(false);
  const [state, setState] = useState<StageState>({ focusId: null, celebrating: null, passes: 0 });
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
  const defsJson = JSON.stringify(buildDefs(xi, bench, data));

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

  // Floating tags carry the whole surname and the number, nothing else: the icons are in the player's card.
  const floating = (p: Pitch3DPlayer) =>
    tagEl(
      p,
      "pointer-events-auto absolute left-0 top-0 flex max-w-[6.5rem] flex-col items-center rounded-md border border-white/15 bg-[rgba(8,16,24,0.82)] px-1.5 py-px leading-tight text-ink will-change-transform focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]",
      <>
        <span className="flex max-w-full items-center gap-1">
          {roleBadge(p)}
          <span className="min-w-0 truncate text-[11px] font-bold text-white">{p.webName}</span>
        </span>
        <span className={`max-w-full truncate font-mono text-[10.5px] font-semibold ${subColor(p)}`}>{p.sub}</span>
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
      data-passes={state.passes || undefined}
    >
      <div ref={hostRef} className="relative aspect-[4/5] w-full scroll-mt-16 overflow-hidden rounded-xl bg-[#0a1a14] [contain:paint]">
        <div ref={tagsRef} className="pointer-events-none absolute inset-0">
          {ready && xi.map(floating)}
        </div>
        {!ready && <p className="absolute inset-0 grid place-items-center text-xs text-ink-faint">Loading the 3D pitch…</p>}
      </div>
      {bench.length > 0 && (
        <div className="mt-3">
          <p className="eyebrow mb-1.5">Bench</p>
          <div className="grid grid-cols-4 gap-1.5">
            {bench.map((p) =>
              tagEl(
                p,
                "flex min-w-0 flex-col items-center gap-1 rounded-lg border border-white/15 bg-[rgba(8,16,24,0.9)] px-0.5 py-2 text-center leading-tight focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]",
                <>
                  <span className="h-2.5 w-7 rounded-full border border-white/40" style={{ background: kitColor(p) }} aria-hidden />
                  <span className="flex max-w-full flex-wrap items-center justify-center gap-1 text-[11px] font-bold text-white [overflow-wrap:anywhere]">
                    {roleBadge(p)}
                    {p.webName}
                  </span>
                  <span className={`font-mono text-[11px] font-semibold ${subColor(p)}`}>{p.sub}</span>
                  {(p.badges?.length ?? 0) > 0 && <span className="flex items-center justify-center gap-1 text-[11px]">{badges(p, "")}</span>}
                </>,
              ),
            )}
          </div>
        </div>
      )}
    </div>
  );
}
