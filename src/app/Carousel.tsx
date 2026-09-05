"use client";

import { Children, useRef, useState, type ReactNode } from "react";

/** Native horizontal scroll-snap carousel -- swipe works for free on
 * touch/trackpad, no gesture code needed. Shows small dot indicators and
 * snaps one child per "page" (a child can itself be wider on desktop via
 * its own className; the dots just track scroll position). */
export default function Carousel({ children }: { children: ReactNode }) {
  const items = Children.toArray(children);
  const [active, setActive] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);

  const onScroll = () => {
    const el = trackRef.current;
    if (!el || el.children.length === 0) return;
    const childWidth = (el.children[0] as HTMLElement).offsetWidth + 12; // + gap
    setActive(Math.round(el.scrollLeft / childWidth));
  };

  const goTo = (i: number) => {
    const el = trackRef.current;
    if (!el || !el.children[i]) return;
    (el.children[i] as HTMLElement).scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
  };

  if (items.length <= 1) return <>{items}</>;

  return (
    <div>
      <div
        ref={trackRef}
        onScroll={onScroll}
        className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map((child, i) => (
          <div key={i} className="w-full shrink-0 snap-start">
            {child}
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex justify-center gap-1.5">
        {items.map((_, i) => (
          <button
            key={i}
            onClick={() => goTo(i)}
            aria-label={`Go to ${i + 1}`}
            className={`h-1.5 rounded-full transition-all ${
              i === active ? "w-4 bg-[var(--accent)]" : "w-1.5 bg-[var(--border-strong)]"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
