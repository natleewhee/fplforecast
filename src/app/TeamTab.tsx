"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { sgDayTime } from "@/lib/time";
import { initialTeamMode, type TeamMode } from "@/lib/teamMode";
import { markTeamSwitch } from "@/lib/teamSwitch";

/** Live and Squad in one tab: the same fifteen players, now (live points) or next (the
 * forecast), with a switch between them. Both halves stay mounted so live polling and each
 * pitch keep their state; the hidden one takes no layout, so its 3D pitch is released. */
export default function TeamTab({
  now,
  next,
  deadline,
  nextGameweek,
}: {
  now: ReactNode;
  next: ReactNode;
  deadline: string | null | undefined;
  nextGameweek: number;
}) {
  // the server render shows the plan; the browser picks the right half after mount
  const [mode, setMode] = useState<TeamMode>("next");
  const chosen = useRef(false);
  const modeRef = useRef<TeamMode>("next");
  const halves = useRef<Record<TeamMode, HTMLDivElement | null>>({ now: null, next: null });

  /** Change half with motion: the new half slides in from the side it sits on (Now left, Next
   * right) and its 3D pitch, created as it appears, sweeps its camera in. */
  const switchTo = (m: TeamMode) => {
    if (m === modeRef.current) return;
    modeRef.current = m;
    markTeamSwitch();
    setMode(m);
    let reduce = false;
    try {
      reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {}
    if (reduce) return;
    requestAnimationFrame(() => {
      const el = halves.current[m];
      const dx = m === "next" ? 26 : -26;
      el?.animate?.(
        [
          { transform: `translateX(${dx}px)`, opacity: 0 },
          { transform: "none", opacity: 1 },
        ],
        { duration: 280, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
      );
    });
  };

  useEffect(() => {
    const start = initialTeamMode(window.location.search, deadline, Date.now());
    const startTimer = setTimeout(() => {
      modeRef.current = start;
      setMode(start);
    }, 0);
    // flip to the live view by itself when the deadline passes, unless the viewer chose a half
    const deadlineMs = deadline ? Date.parse(deadline) : NaN;
    const wait = deadlineMs - Date.now();
    const flipTimer =
      start === "next" && Number.isFinite(wait) && wait > 0 && wait <= 2 ** 31 - 1
        ? setTimeout(() => {
            if (!chosen.current) switchTo("now");
          }, wait)
        : undefined;
    // other parts of the page can ask for a half (goToTab("live") / goToTab("squad"))
    const onGoto = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (id === "live" || id === "squad") {
        chosen.current = true; // a half asked for by name is a choice too: the deadline flip leaves it
        switchTo(id === "live" ? "now" : "next");
      }
    };
    window.addEventListener("gaffer:goto-tab", onGoto);
    return () => {
      clearTimeout(startTimer);
      clearTimeout(flipTimer);
      window.removeEventListener("gaffer:goto-tab", onGoto);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per page load
  }, []);

  const pick = (m: TeamMode) => {
    chosen.current = true;
    switchTo(m);
  };
  const deadlineText = deadline ? sgDayTime(deadline) : null;

  return (
    <div className="space-y-4">
      <div role="group" aria-label="Now or next gameweek" className="segment team-mode relative w-full" data-testid="team-mode">
        {/* the highlight slides between the two buttons */}
        <span aria-hidden="true" className="team-mode-thumb" data-at={mode} />
        <button
          type="button"
          aria-pressed={mode === "now"}
          data-active={mode === "now"}
          onClick={() => pick("now")}
          className="flex flex-1 flex-col items-start justify-center text-left"
        >
          <span className="block text-sm font-bold">Now</span>
          <span className="block text-xs opacity-80">Live points</span>
        </button>
        <button
          type="button"
          aria-pressed={mode === "next"}
          data-active={mode === "next"}
          onClick={() => pick("next")}
          className="flex flex-1 flex-col items-start justify-center text-left"
        >
          <span className="block text-sm font-bold">Next</span>
          <span className="block text-xs opacity-80">
            GW{nextGameweek}
            {deadlineText ? ` · deadline ${deadlineText}` : ""}
          </span>
        </button>
      </div>
      <div ref={(el) => { halves.current.now = el; }} hidden={mode !== "now"} className="space-y-4" data-team-half="now">
        {now}
      </div>
      <div ref={(el) => { halves.current.next = el; }} hidden={mode !== "next"} className="space-y-4" data-team-half="next">
        {next}
      </div>
    </div>
  );
}
