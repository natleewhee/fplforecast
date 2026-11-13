"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { sgDayTime } from "@/lib/time";
import { initialTeamMode, type TeamMode } from "@/lib/teamMode";

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

  useEffect(() => {
    const start = initialTeamMode(window.location.search, deadline, Date.now());
    const startTimer = setTimeout(() => setMode(start), 0);
    // flip to the live view by itself when the deadline passes, unless the viewer chose a half
    const deadlineMs = deadline ? Date.parse(deadline) : NaN;
    const wait = deadlineMs - Date.now();
    const flipTimer =
      start === "next" && Number.isFinite(wait) && wait > 0 && wait <= 2 ** 31 - 1
        ? setTimeout(() => {
            if (!chosen.current) setMode("now");
          }, wait)
        : undefined;
    // other parts of the page can ask for a half (goToTab("live") / goToTab("squad"))
    const onGoto = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (id === "live" || id === "squad") setMode(id === "live" ? "now" : "next");
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
    setMode(m);
  };
  const deadlineText = deadline ? sgDayTime(deadline) : null;

  return (
    <div className="space-y-4">
      <div role="group" aria-label="Now or next gameweek" className="segment w-full" data-testid="team-mode">
        <button
          type="button"
          aria-pressed={mode === "now"}
          data-active={mode === "now"}
          onClick={() => pick("now")}
          className="flex min-h-[52px] flex-1 flex-col items-start justify-center px-3 text-left"
        >
          <span className="block text-sm font-bold">Now</span>
          <span className="block text-xs opacity-80">Live points</span>
        </button>
        <button
          type="button"
          aria-pressed={mode === "next"}
          data-active={mode === "next"}
          onClick={() => pick("next")}
          className="flex min-h-[52px] flex-1 flex-col items-start justify-center px-3 text-left"
        >
          <span className="block text-sm font-bold">Next</span>
          <span className="block text-xs opacity-80">
            GW{nextGameweek}
            {deadlineText ? ` · deadline ${deadlineText}` : ""}
          </span>
        </button>
      </div>
      <div hidden={mode !== "now"} className="space-y-4" data-team-half="now">
        {now}
      </div>
      <div hidden={mode !== "next"} className="space-y-4" data-team-half="next">
        {next}
      </div>
    </div>
  );
}
