"use client";

import { Children, useState, type ReactNode } from "react";

/** Shows one child at a time with dot navigation (tap only, no touch-drag).
 * Deliberately not swipeable: this lives inside AppTabs' swipeable page
 * shell, and a horizontal drag gesture here would fight the outer page-swipe
 * (the same touch is ambiguous between "change card" and "change tab").
 * Swipe is for pages; a toggle/tap is for content within a page. */
export default function Carousel({ children }: { children: ReactNode }) {
  const items = Children.toArray(children);
  const [active, setActive] = useState(0);

  if (items.length === 0) return null;
  if (items.length === 1) return <>{items}</>;

  const clamped = Math.min(active, items.length - 1);

  return (
    <div>
      <div className="relative flex items-center gap-1.5">
        <button
          onClick={() => setActive((a) => Math.max(0, a - 1))}
          disabled={clamped === 0}
          aria-label="Previous"
          className="shrink-0 rounded-full border border-line p-1.5 text-ink-soft transition hover:border-border-strong hover:text-ink disabled:opacity-30"
        >
          ‹
        </button>
        <div className="min-w-0 flex-1">{items[clamped]}</div>
        <button
          onClick={() => setActive((a) => Math.min(items.length - 1, a + 1))}
          disabled={clamped === items.length - 1}
          aria-label="Next"
          className="shrink-0 rounded-full border border-line p-1.5 text-ink-soft transition hover:border-border-strong hover:text-ink disabled:opacity-30"
        >
          ›
        </button>
      </div>
      <div className="mt-1.5 flex justify-center gap-1.5">
        {items.map((_, i) => (
          <button
            key={i}
            onClick={() => setActive(i)}
            aria-label={`Go to ${i + 1}`}
            className={`h-1.5 rounded-full transition-all ${
              i === clamped ? "w-4 bg-[var(--accent)]" : "w-1.5 bg-[var(--border-strong)]"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
