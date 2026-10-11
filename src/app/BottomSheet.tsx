"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** The shared shell for the app's player sheets: a modal that rises from the
 * bottom on a phone and centres on a larger screen, closing on Escape, a
 * backdrop tap or its Close button, and moving focus to Close on open (the
 * caller returns focus to whatever opened it).
 *
 * Rendered through a portal to <body>: a `position: fixed` overlay inside any
 * ancestor with a CSS transform (the `rise` entrance animation, a swiping tab
 * pane) is positioned against that ancestor, not the screen, so it stops short
 * of the viewport edges. Only ever mounted after a tap, so `document` exists. */
export default function BottomSheet({
  label,
  onClose,
  children,
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
