import type { ReactNode } from "react";

/** Shared chrome used by both the server-rendered fallback states in
 * page.tsx (no data yet / no forecast yet) and AppShell.tsx's client-side
 * "ready" view -- split out so neither has to duplicate it or import from
 * the other. */

const POSITION_COLOR: Record<string, string> = {
  GKP: "bg-[var(--gkp)]",
  DEF: "bg-[var(--def)]",
  MID: "bg-[var(--mid)]",
  FWD: "bg-[var(--fwd)]",
};

export function PositionBadge({ position }: { position: string }) {
  return (
    <span
      className={`inline-block w-9 shrink-0 rounded-md py-0.5 text-center text-[10px] font-bold tracking-wide text-black/85 ${
        POSITION_COLOR[position] ?? "bg-ink-soft"
      }`}
    >
      {position}
    </span>
  );
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`panel rise p-4 ${className}`}>{children}</div>;
}

/** A compact HUD stat module: eyebrow label, then free-form body. */
export function Module({
  label,
  accent,
  children,
}: {
  label: string;
  accent?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Panel className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="eyebrow">{label}</span>
        {accent}
      </div>
      {children}
    </Panel>
  );
}

export function Header({ subtitle }: { subtitle: string }) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-[color-mix(in_srgb,var(--bg-0)_78%,transparent)] backdrop-blur-xl">
      <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="grid h-7 w-7 place-items-center rounded-lg border border-[color-mix(in_srgb,var(--accent)_45%,transparent)] bg-[color-mix(in_srgb,var(--accent)_12%,transparent)]">
            <span className="h-2 w-2 rounded-full bg-[var(--accent)] pulse" />
          </span>
          <div className="leading-tight">
            <div className="font-mono text-[13px] font-bold tracking-[0.14em] text-ink">
              FPL·FORECASTER
            </div>
            <div className="text-[10px] tracking-wide text-ink-faint">{subtitle}</div>
          </div>
        </div>
        <span className="hidden h-px flex-1 bg-gradient-to-r from-transparent via-[var(--border-strong)] to-transparent sm:block" />
      </div>
    </header>
  );
}

/** kept so any leftover callers still compile; identical to Panel */
export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <Panel className={className}>{children}</Panel>;
}

export function Shell({ children }: { children: ReactNode }) {
  return <main className="mx-auto min-h-screen w-full max-w-4xl px-4 pb-16">{children}</main>;
}
