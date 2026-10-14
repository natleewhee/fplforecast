/* Post-gameweek recap: what happened, what the badges are, and what-ifs.
 * Pure over FPL's public data (picks, live points, bootstrap, history,
 * transfers) so it is unit-testable without the network. Uses *actual*
 * points only. */

export type RecapPick = { element: number; position: number; multiplier: number; is_captain: boolean };
export type RecapInputs = {
  gameweek: number;
  picks: { picks: RecapPick[]; active_chip?: string | null };
  /** element id -> raw points that gameweek (no captain multiplier) */
  rawPoints: Record<number, number>;
  /** element id -> minutes played that gameweek */
  minutes: Record<number, number>;
  players: Record<number, { name: string; ownedPct: number }>;
  history: { event: number; points: number; overall_rank: number; event_transfers_cost: number; points_on_bench: number }[];
  transfers: { event: number; element_in: number; element_out: number }[];
  averageScore: number | null;
};

export type Achievement = { id: string; emoji: string; title: string; detail: string; good: boolean };
export type Regret = { id: string; text: string; points: number };
export type Recap = {
  gameweek: number;
  points: number;
  hit: number;
  averageScore: number | null;
  rank: number | null;
  rankBefore: number | null;
  captain: { name: string; raw: number; multiplier: number } | null;
  best: { name: string; points: number } | null;
  worst: { name: string; points: number } | null;
  benchPoints: number;
  chip: string | null;
  achievements: Achievement[];
  regrets: Regret[];
};

export const DIFFERENTIAL_MAX_OWNED = 10;
export const DIFFERENTIAL_MIN_POINTS = 9;
export const BENCH_REGRET_POINTS = 10;

export function buildRecap(i: RecapInputs): Recap {
  const raw = (id: number) => i.rawPoints[id] ?? 0;
  const name = (id: number) => i.players[id]?.name ?? `#${id}`;
  const chip = i.picks.active_chip ?? null;
  const bboost = chip === "bboost";

  const starters = i.picks.picks.filter((p) => p.position <= 11);
  const bench = i.picks.picks.filter((p) => p.position > 11);
  const played = starters.filter((p) => (i.minutes[p.element] ?? 0) > 0);

  const row = i.history.find((h) => h.event === i.gameweek);
  const prev = i.history.find((h) => h.event === i.gameweek - 1);
  const hit = row?.event_transfers_cost ?? 0;
  const benchPoints = bench.reduce((s, p) => s + raw(p.element), 0);

  const byRaw = [...played].sort((a, b) => raw(b.element) - raw(a.element));
  const best = byRaw[0] ? { name: name(byRaw[0].element), points: raw(byRaw[0].element) } : null;
  const worstPick = byRaw.length ? byRaw[byRaw.length - 1] : null;
  const worst = worstPick ? { name: name(worstPick.element), points: raw(worstPick.element) } : null;

  const capPick = i.picks.picks.find((p) => p.is_captain);
  const captain = capPick
    ? { name: name(capPick.element), raw: raw(capPick.element), multiplier: Math.max(capPick.multiplier, 1) }
    : null;

  const moves = i.transfers.filter((t) => t.event === i.gameweek);
  const inPts = moves.reduce((s, t) => s + raw(t.element_in), 0);
  const outPts = moves.reduce((s, t) => s + raw(t.element_out), 0);

  const achievements: Achievement[] = [];
  for (const p of played) {
    const info = i.players[p.element];
    if (info && info.ownedPct < DIFFERENTIAL_MAX_OWNED && raw(p.element) >= DIFFERENTIAL_MIN_POINTS) {
      achievements.push({
        id: `differential-${p.element}`,
        emoji: "🎯",
        title: "Differential hit",
        detail: `${info.name} (${info.ownedPct.toFixed(1)}% owned) returned ${raw(p.element)}`,
        good: true,
      });
    }
  }
  if (capPick && captain && best && captain.raw >= 10 && captain.raw >= best.points) {
    achievements.push({
      id: "captain-masterclass",
      emoji: "👑",
      title: "Captain masterclass",
      detail: `${captain.name} top-scored your XI with ${captain.raw} (×${captain.multiplier})`,
      good: true,
    });
  }
  if (captain && captain.raw <= 2) {
    achievements.push({
      id: "captain-blank",
      emoji: "🫠",
      title: "Captain blank",
      detail: `${captain.name} gave you ${captain.raw}`,
      good: false,
    });
  }
  if (!bboost && benchPoints >= BENCH_REGRET_POINTS) {
    achievements.push({
      id: "bench-regret",
      emoji: "🪑",
      title: "Bench regret",
      detail: `${benchPoints} points rotted on your bench`,
      good: false,
    });
  }
  if (hit > 0 && moves.length) {
    const gain = inPts - outPts;
    achievements.push(
      gain > hit
        ? { id: "hit-paid", emoji: "💸", title: "Hit paid off", detail: `+${gain} from the swaps for a −${hit} hit`, good: true }
        : { id: "hit-failed", emoji: "🧾", title: "Hit didn't pay", detail: `${gain >= 0 ? "+" : ""}${gain} from the swaps for a −${hit} hit`, good: false },
    );
  }
  if (row && i.averageScore != null && row.points >= i.averageScore + 20) {
    achievements.push({
      id: "big-week",
      emoji: "🔥",
      title: "Big week",
      detail: `${row.points} vs an average of ${i.averageScore}`,
      good: true,
    });
  }

  const regrets: Regret[] = [];
  if (capPick && captain && byRaw[0] && byRaw[0].element !== capPick.element) {
    const gain = (raw(byRaw[0].element) - captain.raw) * captain.multiplier;
    if (gain > 0) {
      regrets.push({
        id: "captain",
        text: `If you'd captained ${name(byRaw[0].element)} instead of ${captain.name}`,
        points: gain,
      });
    }
  }
  if (!bboost && benchPoints > 0) {
    regrets.push({ id: "bench-boost", text: "If you'd played your Bench Boost", points: benchPoints });
  }
  for (const t of moves) {
    const gain = raw(t.element_out) - raw(t.element_in);
    if (gain > 0) {
      regrets.push({
        id: `keep-${t.element_out}`,
        text: `If you'd kept ${name(t.element_out)} instead of buying ${name(t.element_in)}`,
        points: gain,
      });
    }
  }
  regrets.sort((a, b) => b.points - a.points);

  return {
    gameweek: i.gameweek,
    points: row?.points ?? 0,
    hit,
    averageScore: i.averageScore,
    rank: row?.overall_rank ?? null,
    rankBefore: prev?.overall_rank ?? null,
    captain,
    best,
    worst,
    benchPoints,
    chip,
    achievements,
    regrets,
  };
}

/** Playful one-liner for a regret, so the toy reads like banter. */
export function regretCopy(r: Regret): string {
  if (r.points >= 12) return `${r.text}: +${r.points}. Don't look at the replay.`;
  if (r.points >= 6) return `${r.text}: +${r.points}. Painful.`;
  return `${r.text}: +${r.points}. Could be worse.`;
}

export function rankMove(r: Pick<Recap, "rank" | "rankBefore">): string | null {
  if (r.rank == null || r.rankBefore == null) return null;
  const d = r.rankBefore - r.rank;
  if (d === 0) return "Rank unchanged";
  return `${d > 0 ? "▲" : "▼"} ${Math.abs(d).toLocaleString("en-GB")} places`;
}

/** The headline banter line: the most telling thing about the week. */
export function verdict(r: Recap): string {
  const has = (id: string) => r.achievements.some((a) => a.id === id);
  if (has("captain-blank") && has("bench-regret")) return "Captain blank. Bench cried.";
  if (has("captain-blank")) return "Your captain went missing.";
  if (has("hit-failed") && has("bench-regret")) return "Paid for a hit. Benched the points.";
  if (has("captain-masterclass") && has("big-week")) return "Captain delivered. Absolute scenes.";
  if (has("big-week")) return "Absolutely flying.";
  if (has("captain-masterclass")) return "Armband paid off. Take a bow.";
  if (has("hit-paid")) return "That hit was worth it.";
  if (has("hit-failed")) return "That hit cost you.";
  if (has("bench-regret")) return "The bench ate well.";
  if (r.averageScore != null && r.points < r.averageScore - 10) return "A week to forget.";
  if (r.averageScore != null && r.points >= r.averageScore) return "Quietly above the crowd.";
  return "Mid. Moving on.";
}

export type Tier = { id: "legend" | "rare" | "common" | "bruised"; label: string; color: string };

/** Card rarity from the gap to the average, like a trading card. */
export function tier(r: Pick<Recap, "points" | "averageScore">): Tier {
  const gap = r.averageScore == null ? 0 : r.points - r.averageScore;
  if (gap >= 20) return { id: "legend", label: "LEGENDARY", color: "#f4b740" };
  if (gap >= 0) return { id: "rare", label: "RARE", color: "#3ddc84" };
  if (gap >= -15) return { id: "common", label: "COMMON", color: "#9fb3a8" };
  return { id: "bruised", label: "BRUISED", color: "#ff6b6b" };
}
