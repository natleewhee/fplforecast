/* Small pieces shared by the player tokens (Pitch, LivePitch, LiveSquadPitch,
 * Scenarios), so they look the same everywhere. */

export const POSITION_DOT: Record<string, string> = {
  GKP: "var(--gkp)",
  DEF: "var(--def)",
  MID: "var(--mid)",
  FWD: "var(--fwd)",
};

/** The armband badge on a shirt's top-right corner: "C" for the captain, "V"
 * for the vice, or a faded "C" for a captain who isn't wearing the armband
 * (the armband has passed to the vice). */
export function ArmbandBadge({ role, pop = true }: { role: "captain" | "vice" | "faded"; pop?: boolean }) {
  const letter = role === "vice" ? "V" : "C";
  const look = role === "captain" ? " armband-captain" : role === "vice" ? " armband-vice" : " opacity-50";
  return (
    <span className={`armband${pop ? " fx-pop" : ""} absolute -right-1 -top-1 h-4 w-4 text-[9px]${look}`}>{letter}</span>
  );
}
