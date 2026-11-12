"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type TouchEvent } from "react";
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
  const rootRef = useRef<HTMLDivElement | null>(null);
  const tabButtons = useRef<(HTMLButtonElement | null)[]>([]);
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
    // A short tab opened from deep down a tall one would land at its bottom: start at the top of the new tab
    // (just under the sticky tab bar) instead. Done with the swap, so the slide does not scroll.
    const toTop = () => {
      const top = (rootRef.current?.getBoundingClientRect().top ?? 0) + window.scrollY;
      if (window.scrollY > top) window.scrollTo(0, top);
    };
    if (!doc.startViewTransition || reduce) {
      toTop();
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
      doc.startViewTransition(() => { flushSync(() => setActive(to)); toTop(); }).finished.then(clear, clear);
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
      if (i >= 0) {
        go(i);
        // keyboard and screen-reader users land on the tab they were sent to
        requestAnimationFrame(() => tabButtons.current[i]?.focus({ preventScroll: true }));
      }
    };
    window.addEventListener("gaffer:goto-tab", onGoto);
    return () => window.removeEventListener("gaffer:goto-tab", onGoto);
  }, [tabs, go]);

  // Left/Right wrap round the bar, Home/End jump to the ends; focus follows the tab that opens.
  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.metaKey || e.ctrlKey) return; // leave Alt+Left (browser Back) and friends alone
    const n = tabs.length;
    // Start from the tab the key was pressed on, not activeRef: a switch commits inside the view
    // transition a frame later, so quick repeat presses would otherwise all read the old tab.
    const from = tabButtons.current.indexOf(e.target as HTMLButtonElement);
    const cur = from >= 0 ? from : activeRef.current;
    const to =
      e.key === "ArrowRight" ? (cur + 1) % n
      : e.key === "ArrowLeft" ? (cur - 1 + n) % n
      : e.key === "Home" ? 0
      : e.key === "End" ? n - 1
      : -1;
    if (to < 0) return;
    e.preventDefault();
    go(to);
    tabButtons.current[to]?.focus({ preventScroll: true });
  };

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
    <div ref={rootRef}>
      <div className="sticky top-0 z-20 -mx-4 mb-3 border-b border-line bg-[var(--bg-0)]/95 px-4 backdrop-blur">
        {/* A real tablist: one Tab stop for the bar, arrow keys move between tabs (WAI-ARIA tabs pattern, automatic activation). */}
        <div className="segment w-full" role="tablist" aria-label="Sections" onKeyDown={onTabKey}>
          {tabs.map((t, i) => (
            <button
              key={t.id}
              ref={(el) => { tabButtons.current[i] = el; }}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={active === i}
              aria-controls={`tabpanel-${t.id}`}
              tabIndex={active === i ? 0 : -1}
              data-active={active === i}
              onClick={() => go(i)}
              className="flex-1"
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div
        // clip only sideways (the swipe); a control at the very top of a pane keeps its full tap area
        className="overflow-x-clip"
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
              role="tabpanel"
              id={`tabpanel-${t.id}`}
              aria-labelledby={`tab-${t.id}`}
              className="shrink-0 space-y-4"
              // off-screen panes stay mounted but cannot be focused, tabbed into or read out
              inert={active !== i}
              // only the open tab is captured for the slide, not every tab side by side.
              // Panes that are off to the side take no height, so the page scrolls only as far as the open tab.
              style={{
                width: `${100 / tabs.length}%`,
                viewTransitionName: active === i ? "tabpane" : "none",
                ...(active === i ? {} : { height: 0, overflow: "clip" }),
              }}
            >
              {t.content}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
