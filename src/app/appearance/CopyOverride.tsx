"use client";

import { useState } from "react";

/** Copies a ready-to-edit override for one player. */
export default function CopyOverride({ snippet, label }: { snippet: string; label: string }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(snippet);
      setDone(true);
      setTimeout(() => setDone(false), 1600);
    } catch {
      window.prompt("Copy this:", snippet);
    }
  }
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Copy an override for ${label}`}
      className="inline-flex h-11 shrink-0 items-center rounded-full border border-line px-3 text-[11px] text-ink-soft hover:border-border-strong"
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}
