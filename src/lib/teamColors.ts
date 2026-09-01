/** Primary kit colour per Premier League club, keyed by FPL `short_name`.
 * `ink` is the readable colour for a number laid over `primary`. Promoted /
 * unusual sides are approximated; anything unknown falls back to slate. */
export type Kit = { primary: string; ink: string };

const KITS: Record<string, Kit> = {
  ARS: { primary: "#EF0107", ink: "#ffffff" },
  AVL: { primary: "#670E36", ink: "#ffffff" },
  BOU: { primary: "#DA291C", ink: "#ffffff" },
  BRE: { primary: "#E30613", ink: "#ffffff" },
  BHA: { primary: "#0057B8", ink: "#ffffff" },
  BUR: { primary: "#6C1D45", ink: "#ffffff" },
  CHE: { primary: "#034694", ink: "#ffffff" },
  CRY: { primary: "#1B458F", ink: "#ffffff" },
  EVE: { primary: "#003399", ink: "#ffffff" },
  FUL: { primary: "#E9EBF0", ink: "#12151c" },
  LEE: { primary: "#FFCD00", ink: "#12151c" },
  LEI: { primary: "#003090", ink: "#ffffff" },
  LIV: { primary: "#C8102E", ink: "#ffffff" },
  MCI: { primary: "#6CABDD", ink: "#0b1b2a" },
  MUN: { primary: "#DA291C", ink: "#ffffff" },
  NEW: { primary: "#2B2B2B", ink: "#ffffff" },
  NFO: { primary: "#DD0000", ink: "#ffffff" },
  SUN: { primary: "#EB172B", ink: "#ffffff" },
  TOT: { primary: "#132257", ink: "#ffffff" },
  WHU: { primary: "#7A263A", ink: "#ffffff" },
  WOL: { primary: "#FDB913", ink: "#12151c" },
  // promoted / recent
  IPS: { primary: "#0044A9", ink: "#ffffff" },
  COV: { primary: "#1E9DE3", ink: "#08243a" },
  HUL: { primary: "#F5A12D", ink: "#2a1600" },
  SOU: { primary: "#D71920", ink: "#ffffff" },
  LUT: { primary: "#F78F1E", ink: "#2a1600" },
  SHU: { primary: "#EE2737", ink: "#ffffff" },
};

const FALLBACK: Kit = { primary: "#64748b", ink: "#ffffff" };

export function kitFor(shortName: string | undefined | null): Kit {
  if (!shortName) return FALLBACK;
  return KITS[shortName.toUpperCase()] ?? FALLBACK;
}

/** FDR 1 (easy) → 5 (hard) as a colour, for opponent chips. */
export function fdrColor(fdr: number | null | undefined): string {
  switch (fdr) {
    case 1:
      return "#22c55e";
    case 2:
      return "#4ade80";
    case 3:
      return "#94a3b8";
    case 4:
      return "#fb923c";
    case 5:
      return "#ef4444";
    default:
      return "#64748b";
  }
}
