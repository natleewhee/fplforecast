"use client";

import { useEffect, useRef, useState } from "react";
import { ROLL_MS, rollValue } from "@/lib/roll";

/* A figure that rolls to its new value when it changes (the estimated overall rank),
 * and tints for a moment: green when it moved in the manager's favour, red when against.
 * The first value just shows. With reduced motion it jumps and does not tint.
 * `lowerIsBetter` is true for a rank, where a smaller number is a better one. */

export default function RollingNumber({ value, prefix = "", lowerIsBetter = false }: { value: number; prefix?: string; lowerIsBetter?: boolean }) {
  const [shown, setShown] = useState(value);
  const [tint, setTint] = useState<"good" | "bad" | null>(null);
  const last = useRef(value);
  const shownRef = useRef(value);
  useEffect(() => {
    shownRef.current = shown;
  });

  useEffect(() => {
    const from = last.current;
    if (value === from) return;
    last.current = value;
    let reduce = false;
    try {
      reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {}
    if (reduce) {
      const t = setTimeout(() => setShown(value), 0);
      return () => clearTimeout(t);
    }
    const start = shownRef.current;
    const better = lowerIsBetter ? value < from : value > from;
    let raf = 0;
    let t0 = 0;
    const step = (ts: number) => {
      if (!t0) t0 = ts;
      const p = (ts - t0) / ROLL_MS;
      setShown(rollValue(start, value, p));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    const on = setTimeout(() => setTint(better ? "good" : "bad"), 0);
    const off = setTimeout(() => setTint(null), ROLL_MS + 700);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(on);
      clearTimeout(off);
    };
  }, [value, lowerIsBetter]);

  return (
    <span
      className="tabular-nums transition-colors duration-500"
      style={{ color: tint === "good" ? "var(--accent)" : tint === "bad" ? "var(--danger)" : undefined }}
      data-testid="rolling-number"
      data-value={value}
    >
      {prefix}
      {shown.toLocaleString()}
    </span>
  );
}
