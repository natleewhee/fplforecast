"use client";

import { useRef, useState, type ReactNode, type TouchEvent } from "react";

type Tab = { id: string; label: string; content: ReactNode };

const SWIPE_THRESHOLD_PX = 60;

/** Three-pane swipeable shell: a persistent tab bar (works on desktop too,
 * where swipe isn't a thing) plus horizontal touch-drag between panes on
 * mobile. Renders all panes at once (translated off-screen, not unmounted)
 * so each tab's own state/polling isn't reset by switching tabs. */
export default function AppTabs({ tabs }: { tabs: Tab[] }) {
  const [active, setActive] = useState(0);
  const touchStartX = useRef<number | null>(null);
  const touchDeltaX = useRef(0);

  const onTouchStart = (e: TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchDeltaX.current = 0;
  };
  const onTouchMove = (e: TouchEvent) => {
    if (touchStartX.current == null) return;
    touchDeltaX.current = e.touches[0].clientX - touchStartX.current;
  };
  const onTouchEnd = () => {
    if (touchDeltaX.current < -SWIPE_THRESHOLD_PX && active < tabs.length - 1) {
      setActive((a) => a + 1);
    } else if (touchDeltaX.current > SWIPE_THRESHOLD_PX && active > 0) {
      setActive((a) => a - 1);
    }
    touchStartX.current = null;
    touchDeltaX.current = 0;
  };

  return (
    <div>
      <div className="sticky top-0 z-20 -mx-4 mb-3 border-b border-line bg-[var(--bg-0)]/95 px-4 backdrop-blur">
        <div className="segment w-full">
          {tabs.map((t, i) => (
            <button key={t.id} data-active={active === i} onClick={() => setActive(i)} className="flex-1">
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div
        className="overflow-hidden"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <div
          className="flex transition-transform duration-200 ease-out"
          style={{
            width: `${tabs.length * 100}%`,
            transform: `translateX(-${(active * 100) / tabs.length}%)`,
          }}
        >
          {tabs.map((t) => (
            <div key={t.id} className="shrink-0 space-y-4" style={{ width: `${100 / tabs.length}%` }}>
              {t.content}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
