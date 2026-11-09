"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** The shared shell for the app's player sheets: a modal that rises from the
 * bottom on a phone and centres on a larger screen, closing on Escape, a
 * backdrop tap or its Close button, and moving focus to Close on open (the
 * caller returns focus to whatever opened it).
 *
 * With `peek`, it first opens as a short card at the bottom of the screen with no dimming and no
 * focus grab, so what is behind it (a 3D pitch, a celebration) stays in view and tappable; "Show all"
 * turns it into the full sheet.
 *
 * Rendered through a portal to <body>: a `position: fixed` overlay inside any
 * ancestor with a CSS transform (the `rise` entrance animation, a swiping tab
 * pane) is positioned against that ancestor, not the screen, so it stops short
 * of the viewport edges. Only ever mounted after a tap, so `document` exists. */
export default function BottomSheet({
  label,
  onClose,
  children,
  peek = false,
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
  peek?: boolean;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(false);
  const compact = peek && !expanded;

  useEffect(() => {
    if (!compact) closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, compact]);

  if (compact) {
    return createPortal(
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center"
        role="dialog"
        aria-modal="false"
        aria-label={label}
      >
        <div className="rise pointer-events-auto relative w-full max-w-md rounded-t-2xl border border-line bg-[var(--bg-1)] px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-xl">
          <div className="relative max-h-[11rem] overflow-hidden">
            {children}
            <div
              className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-[var(--bg-1)] to-transparent"
              aria-hidden
            />
          </div>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="inline-flex h-10 flex-1 items-center justify-center rounded-lg border border-[color-mix(in_srgb,var(--accent)_45%,transparent)] text-sm font-semibold text-[var(--accent)]"
            >
              Show all
            </button>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-10 flex-1 items-center justify-center rounded-lg border border-line text-sm text-ink-soft hover:border-border-strong"
            >
              Close
            </button>
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={label}>
      <button type="button" aria-label="Close" tabIndex={-1} className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="rise relative w-full max-w-md rounded-t-2xl border border-line bg-[var(--bg-1)] p-4 pb-6 shadow-xl sm:rounded-2xl">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-[var(--border-strong)] sm:hidden" aria-hidden />
        {children}
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="mt-4 inline-flex h-11 w-full items-center justify-center rounded-lg border border-line text-sm text-ink-soft hover:border-border-strong"
        >
          Close
        </button>
      </div>
    </div>,
    document.body,
  );
}
