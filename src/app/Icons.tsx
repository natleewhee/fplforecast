import type { SVGProps } from "react";

/* Small line icons in currentColor, so headings and buttons match the app's
 * broadcast look instead of leaning on emoji (which differ per phone). */

const base = (p: SVGProps<SVGSVGElement>) => ({
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  width: 16,
  height: 16,
  "aria-hidden": true,
  ...p,
});

/** Two crossed blades: a head-to-head duel. */
export function SwordsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M4 4l9 9M4 4v4l9 9" />
      <path d="M20 4l-9 9M20 4v4l-9 9" />
      <path d="M7 17l-3 3M17 17l3 3" />
    </svg>
  );
}

/** A crystal ball on a stand: the regret machine. */
export function CrystalIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="10" r="6.5" />
      <path d="M8.5 7.5a4.5 4.5 0 0 1 3-1.8" />
      <path d="M7 20h10M8.5 16.5 7 20M15.5 16.5 17 20" />
    </svg>
  );
}

export function ChevronIcon({ open, ...props }: SVGProps<SVGSVGElement> & { open?: boolean }) {
  return (
    <svg {...base(props)} style={{ transform: open ? "rotate(90deg)" : undefined, transition: "transform .15s" }}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}
