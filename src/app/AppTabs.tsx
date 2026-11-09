"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode, type TouchEvent } from "react";
import { flushSync } from "react-dom";

type Tab = { id: string; label: string; content: ReactNode };

const SWIPE_THRESHOLD_PX = 60;

/** Four-tab swipeable shell: a persistent tab bar (works on desktop too,
 * where swipe isn't a thing) plus horizontal touch-drag between tabs on
 * mobile. Renders all panes at once (translated off-screen, not unmounted)
 * so each tab's own state/polling isn't reset by switching tabs. */
export default function AppTabs({ tabs, deadline }: { tabs: Tab[]; deadline?: string | null }) {
  const [active, setActive] = useState(0);
  const touchStartX = useRef<number | null>(null);
  const activeRef = useRef(0);
  const vtRun = useRef(0);
  useEffect(() => {
    activeRef.current = active;
  });

  // Switching tabs slides the content pane with the browser's own view transitions (no library).
  // Browsers without them, and people who ask for reduced motion, get the plain switch.
  const go = useCallback((next: number | ((a: number) => number)) => {
    const to = typeof next === "function" ? next(activeRef.current) : next;
    if (to === activeRef.current) return;
    const doc = document as Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } };
    let reduce = false;
    try {
      reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {}
    if (!doc.startViewTransition || reduce) {
      setActive(to);
      return;
    }
    const root = document.documentElement;
    root.dataset.vtDir = to > activeRef.current ? "fwd" : "back";
    // a quick second tap starts a new transition; only the latest one may clear the direction
    const run = ++vtRun.current;
    const clear = () => {
      if (run === vtRun.current) delete root.dataset.vtDir;
    };
    try {
      doc.startViewTransition(() => flushSync(() => setActive(to))).finished.then(clear, clear);
    } catch {
      clear();
      setActive(to);
    }
  }, []);
  const touchDeltaX = useRef(0);

  // Which tab opens: ?tab=<id> if given, else the planning view (Squad) while the
  // deadline is still ahead and the live view once it has passed. It also flips
  // to Live by itself when the deadline passes while the page is open. Decided
  // after mount, since "now" differs between the server render and the browser.
  useEffect(() => {
    const idx = (id: string | null) => tabs.findIndex((t) => t.id === id);
    const deadlineMs = deadline ? Date.parse(deadline) : NaN;
    const fromQuery = idx(new URLSearchParams(window.location.search).get("tab"));
    const before = Number.isFinite(deadlineMs) && Date.now() < deadlineMs;
    const start = fromQuery >= 0 ? fromQuery : idx(before ? "squad" : "live");
    const startTimer = setTimeout(() => {
      if (start >= 0) setActive(start);
    }, 0);
    const wait = deadlineMs - Date.now();
    const flipTimer =
      before && wait <= 2 ** 31 - 1
        ? setTimeout(() => {
            setActive((a) => (tabs[a]?.id === "squad" && idx("live") >= 0 ? idx("live") : a));
          }, wait)
        : undefined;
    return () => {
      clearTimeout(startTimer);
      clearTimeout(flipTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per page load
  }, []);

  // Other parts of the page can ask for a tab by id (see goToTab in duelClient).
  useEffect(() => {
    const onGoto = (e: Event) => {
      const i = tabs.findIndex((t) => t.id === (e as CustomEvent<string>).detail);
      if (i >= 0) go(i);
    };
    window.addEventListener("gaffer:goto-tab", onGoto);
    return () => window.removeEventListener("gaffer:goto-tab", onGoto);
  }, [tabs, go]);

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
      go((a) => a + 1);
    } else if (touchDeltaX.current > SWIPE_THRESHOLD_PX && active > 0) {
      go((a) => a - 1);
    }
    touchStartX.current = null;
    touchDeltaX.current = 0;
  };

  return (
    <div>
      <div className="sticky top-0 z-20 -mx-4 mb-3 border-b border-line bg-[var(--bg-0)]/95 px-4 backdrop-blur">
        <div className="segment w-full">
          {tabs.map((t, i) => (
            <button key={t.id} data-active={active === i} onClick={() => go(i)} className="flex-1">
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
          className="tab-swipe flex"
          style={{
            width: `${tabs.length * 100}%`,
            transform: `translateX(-${(active * 100) / tabs.length}%)`,
          }}
        >
          {tabs.map((t, i) => (
            <div
              key={t.id}
              className="shrink-0 space-y-4"
              // only the open tab is captured for the slide, not every tab side by side
              style={{ width: `${100 / tabs.length}%`, viewTransitionName: active === i ? "tabpane" : "none" }}
            >
              {t.content}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
