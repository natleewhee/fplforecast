"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { lookFor, type PitchKits, type PitchLooks, type Position } from "@/lib/appearance";
import { setPitchView, type PitchView } from "@/lib/pitchView";
import { benchSeat, formationSpots } from "./spots";
import type { FigureDef, StageHandle, StageState } from "./stage";

/* The 3D pitch used by the Live, Squad and Scenarios tabs: figures in kit
 * colours (height, skin and hair from the appearance data), the bench seated
 * behind the far goal line, and a name tag with a number above every starter.
 * three.js is loaded only when a 3D pitch is on screen. */

type PitchData = { looks?: PitchLooks; kits?: PitchKits };
const PitchDataContext = createContext<PitchData>({});
let focusCount = 0;
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

/** The 3D / 2D switch, shared by every pitch. */
export function ViewSwitch({ view, onChange }: { view: PitchView; onChange?: (v: PitchView) => void }) {
  return (
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
  const [state, setState] = useState<StageState>({ focusId: null, celebrating: null });
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

  // bring the pitch up under the sticky bar when a player is tapped, so he stays in view above the sheet.
  // Only on a new tap, not each time the live numbers refresh.
  useEffect(() => {
    if (ready && selectedId != null) hostRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [ready, selectedId]);

  // The sheet that opens on a tap dims everything behind it; let the pitch show through while a player is in focus.
  useEffect(() => {
    if (state.focusId == null) return;
    // Squad, Live and Scenarios each hold a pitch: count, so one letting go does not clear another's
    focusCount += 1;
    document.documentElement.setAttribute("data-pitch-focus", "");
    return () => {
      focusCount -= 1;
      if (focusCount <= 0) document.documentElement.removeAttribute("data-pitch-focus");
    };
  }, [state.focusId]);

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

  const floating = (p: Pitch3DPlayer) =>
    tagEl(
      p,
      "pointer-events-auto absolute left-0 top-0 flex max-w-[3.7rem] flex-col items-center rounded-md bg-[rgba(8,16,24,0.74)] px-1 py-px leading-tight text-ink will-change-transform focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]",
      <>
        <span className="flex max-w-full items-center gap-0.5">
          {roleBadge(p)}
          <span className="min-w-0 truncate text-[10px] font-semibold">{p.webName}</span>
          {badges(p, "text-[9px]")}
        </span>
        <span className={`max-w-full truncate font-mono text-[10px] ${subColor(p)}`}>{p.sub}</span>
      </>,
    );

  return (
    <div ref={rootRef} data-testid="pitch3d" data-focus={state.focusId ?? undefined} data-celebrating={state.celebrating ?? undefined}>
      <div ref={hostRef} className="relative aspect-[4/5] w-full scroll-mt-16 overflow-hidden rounded-xl bg-[#0a1a14]">
        <div ref={tagsRef} className="pointer-events-none absolute inset-0">
          {ready && xi.map(floating)}
        </div>
        {!ready && <p className="absolute inset-0 grid place-items-center text-xs text-ink-faint">Loading the 3D pitch…</p>}
      </div>
      {bench.length > 0 && (
        <div className="mt-2">
          <p className="eyebrow mb-1.5">Bench</p>
          <div className="flex gap-1.5">
            {bench.map((p) =>
              tagEl(
                p,
                "flex min-w-0 flex-1 basis-0 flex-col items-center rounded-md bg-[rgba(8,16,24,0.5)] px-1 py-1 leading-tight focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]",
                <>
                  <span className="flex max-w-full items-center gap-0.5">
                    {roleBadge(p)}
                    <span className="min-w-0 truncate text-[11px] font-semibold text-ink">{p.webName}</span>
                    {badges(p, "text-[10px]")}
                  </span>
                  <span className={`max-w-full truncate font-mono text-[10px] ${subColor(p)}`}>{p.sub}</span>
                </>,
              ),
            )}
          </div>
        </div>
      )}
    </div>
  );
}
