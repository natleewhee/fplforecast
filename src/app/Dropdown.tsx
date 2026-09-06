"use client";

import { useEffect, useRef, useState } from "react";

export type DropdownOption<T extends string | number> = { value: T; label: string };

/** A themed stand-in for a native `<select>` -- the browser's own dropdown
 * chrome (system font, square corners, native arrow) is the one control in
 * this app that doesn't pick up the dark HUD styling everything else does,
 * and reads as an unfinished/default web form next to the rest of the UI.
 * This renders the trigger and menu as ordinary HTML (a button + a `.panel`
 * list), so it's just CSS -- no popover/portal library. */
export function Dropdown<T extends string | number>({
  value,
  options,
  onChange,
  placeholder = "Select…",
}: {
  value: T | "";
  options: DropdownOption<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = options.find((o) => o.value === value);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-line bg-[var(--bg-2)] px-3 py-2 text-sm text-ink transition-colors hover:border-border-strong"
      >
        <span className={`truncate ${current ? "text-ink" : "text-ink-faint"}`}>
          {current?.label ?? placeholder}
        </span>
        <span
          className={`shrink-0 text-[10px] text-ink-faint transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        >
          ▾
        </span>
      </button>
      {open && (
        <ul
          role="listbox"
          className="panel rise absolute z-20 mt-1 max-h-60 w-full overflow-y-auto !p-1 text-sm"
        >
          {options.map((o) => (
            <li key={String(o.value)} role="option" aria-selected={o.value === value}>
              <button
                type="button"
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                className={`block w-full truncate rounded-md px-2.5 py-1.5 text-left transition-colors hover:bg-white/[0.06] ${
                  o.value === value ? "font-semibold text-[var(--accent)]" : "text-ink"
                }`}
              >
                {o.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
