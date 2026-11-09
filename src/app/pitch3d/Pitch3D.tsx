"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { lookFor, type PitchKits, type PitchLooks, type Position } from "@/lib/appearance";
import { benchSeat, formationSpots } from "./spots";
import type { FigureDef, StageHandle } from "./stage";

/* The 3D Squad pitch: figures in kit colours (height, skin and hair from the
 * appearance data), the bench seated at the side, and a tappable name tag
 * above every player. three.js is loaded only when this view is on screen. */

export type Pitch3DPlayer = {
  id: number;
  webName: string;
  position: string;
  team: string;
  code?: number | null;
  xp: number | null;
  provisional?: boolean;
  ariaLabel: string;
  title: string;
  badges: { key: string; node: ReactNode; title: string }[];
};

const ROW_ORDER: Position[] = ["GKP", "DEF", "MID", "FWD"];
const FALLBACK_KIT = { shirt: "#8a95a3", shorts: "#2b323b", socks: "#8a95a3" };

/** Where everyone stands. Pure, so the layout is the same on every render. */
function buildDefs(
  xi: Pitch3DPlayer[],
  bench: Pitch3DPlayer[],
  captainId: number | null | undefined,
  looks: PitchLooks | undefined,
  kits: PitchKits | undefined,
): FigureDef[] {
  const def = (p: Pitch3DPlayer, at: { x: number; z: number }, isBench: boolean): FigureDef => {
    const position = (ROW_ORDER as string[]).includes(p.position) ? (p.position as Position) : "MID";
    const look = lookFor(looks, p.code, position);
    const club = kits?.[p.team];
    const kit = club ? (position === "GKP" ? club.gk : club) : FALLBACK_KIT;
    return {
      id: p.id,
      name: p.webName,
      kit: { shirt: kit.shirt, shorts: kit.shorts, socks: kit.socks },
      cm: look.cm,
      skin: look.skin,
      hair: look.hair,
      captain: p.id === captainId,
      bench: isBench,
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

export default function Pitch3D({
  xi,
  bench,
  captainId,
  viceId,
  selectedId,
  looks,
  kits,
  onSelect,
  onUnavailable,
}: {
  xi: Pitch3DPlayer[];
  bench: Pitch3DPlayer[];
  captainId: number | null | undefined;
  viceId: number | null | undefined;
  selectedId: number | null;
  looks: PitchLooks | undefined;
  kits: PitchKits | undefined;
  onSelect: (id: number, trigger: HTMLButtonElement) => void;
  /** Called once if this device cannot run WebGL, so the parent can show the 2D pitch. */
  onUnavailable: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const tagsRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<StageHandle | null>(null);
  const [ready, setReady] = useState(false);
  const onSelectRef = useRef(onSelect);
  const onUnavailableRef = useRef(onUnavailable);
  useEffect(() => {
    onSelectRef.current = onSelect;
    onUnavailableRef.current = onUnavailable;
  });

  // The figures depend only on this string, so a re-render with the same lineup rebuilds nothing.
  const defsJson = JSON.stringify(buildDefs(xi, bench, captainId, looks, kits));

  // create the stage once
  useEffect(() => {
    let cancelled = false;
    let handle: StageHandle | null = null;
    void import("./stage").then(({ createStage }) => {
      if (cancelled || !hostRef.current || !tagsRef.current) return;
      try {
        handle = createStage({
          host: hostRef.current,
          tagLayer: tagsRef.current,
          onPick: (id) => {
            const el = rootRef.current?.querySelector<HTMLButtonElement>(`[data-tag="${id}"]`);
            if (el) onSelectRef.current(id, el);
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
  }, []);

  useEffect(() => {
    if (ready) stageRef.current?.setPlayers(JSON.parse(defsJson) as FigureDef[]);
  }, [ready, defsJson]);
  useEffect(() => {
    if (ready) stageRef.current?.setSelected(selectedId);
  }, [ready, selectedId, defsJson]);

  const roleOf = (id: number) => (id === captainId ? "C" : id === viceId ? "V" : null);
  const xpText = (p: Pitch3DPlayer) => (p.xp != null ? p.xp.toFixed(1) : "\u2014");
  const xpColor = (p: Pitch3DPlayer) => (p.provisional ? "text-[var(--warn)]" : "text-[var(--accent)]");
  const roleBadge = (id: number) => {
    const role = roleOf(id);
    return role ? (
      <span className="rounded-sm bg-[#f3b94d] px-[3px] text-[9px] font-black leading-[12px] text-[#1a1305]">{role}</span>
    ) : null;
  };

  // a name tag floats above each starter (the stage moves it to follow the figure)
  const tag = (p: Pitch3DPlayer) => (
    <button
      key={p.id}
      type="button"
      data-tag={p.id}
      onClick={(e) => onSelect(p.id, e.currentTarget)}
      aria-label={p.ariaLabel}
      title={p.title}
      className={`pointer-events-auto absolute left-0 top-0 flex max-w-[3.7rem] flex-col items-center rounded-md bg-[rgba(8,16,24,0.74)] px-1 py-px leading-tight text-ink will-change-transform focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${p.id === selectedId ? "ring-1 ring-white/70" : ""}`}
    >
      <span className="flex max-w-full items-center gap-0.5">
        {roleBadge(p.id)}
        <span className="min-w-0 truncate text-[10px] font-semibold">{p.webName}</span>
        {p.badges.map((b) => (
          <span key={b.key} className="text-[9px]" title={b.title}>
            {b.node}
          </span>
        ))}
      </span>
      <span className={`font-mono text-[10px] ${xpColor(p)}`}>{xpText(p)}</span>
    </button>
  );

  return (
    <div ref={rootRef} data-testid="pitch3d">
      <div ref={hostRef} className="relative aspect-[4/5] w-full overflow-hidden rounded-xl bg-[#0a1a14]">
        <div ref={tagsRef} className="pointer-events-none absolute inset-0">
          {ready && xi.map(tag)}
        </div>
        {!ready && <p className="absolute inset-0 grid place-items-center text-xs text-ink-faint">Loading the 3D pitch…</p>}
      </div>
      {/* the bench sits in the dugout on the pitch; its names live here, where there is room */}
      <div className="mt-2">
        <p className="eyebrow mb-1.5">Bench</p>
        <div className="flex gap-1.5">
          {bench.map((p) => (
            <button
              key={p.id}
              type="button"
              data-tag={p.id}
              onClick={(e) => onSelect(p.id, e.currentTarget)}
              aria-label={p.ariaLabel}
              title={p.title}
              className={`flex min-w-0 flex-1 basis-0 flex-col items-center rounded-md bg-[rgba(8,16,24,0.5)] px-1 py-1 leading-tight focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${p.id === selectedId ? "ring-1 ring-white/70" : ""}`}
            >
              <span className="flex max-w-full items-center gap-0.5">
                {roleBadge(p.id)}
                <span className="min-w-0 truncate text-[11px] font-semibold text-ink">{p.webName}</span>
                {p.badges.map((b) => (
                  <span key={b.key} className="text-[10px]" title={b.title}>
                    {b.node}
                  </span>
                ))}
              </span>
              <span className={`font-mono text-[10px] ${xpColor(p)}`}>{xpText(p)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
