/* Template-based match-day commentary for the "what just happened" feed. No
 * AI: a handful of lines per event, picked by a hash of the item's key so a
 * given event always reads the same, and `{n}` is the player's name. */

type Kind = "goalAgain" | "goal" | "assist" | "penSaved" | "penMissed" | "ownGoal" | "red" | "yellow" | "cleanSheet" | "defcon" | "bonus";

const LINES: Record<Kind, string[]> = {
  goalAgain: ["{n} again! Absolutely clinical.", "{n} makes it two. Take a bow.", "Another one for {n}! Somebody stop him."],
  goal: ["{n}! Cool as you like.", "{n} finds the net!", "Goal! {n} does what {n} does.", "{n} with the finish. Lovely stuff."],
  assist: ["{n} sets it up on a plate.", "Lovely ball from {n}.", "{n} with the assist, vision on show."],
  penSaved: ["{n} saves the penalty! Heroics!", "Not today: {n} keeps it out from the spot."],
  penMissed: ["{n} misses from the spot. Ouch.", "Penalty wasted by {n}. Hands on heads."],
  ownGoal: ["Oh no. {n} puts it in his own net.", "{n} turns it into his own goal. Brutal."],
  red: ["Red card for {n}! That's a long walk.", "{n} is sent off. Disaster."],
  yellow: ["{n} goes into the book.", "Yellow for {n}. Naughty."],
  cleanSheet: ["Clean sheet banked for {n}.", "{n} and co. shut up shop."],
  defcon: ["{n} putting in the defensive work.", "{n} racks up the dirty-work points."],
  bonus: ["Bonus lands for {n}.", "The bonus points go to {n}."],
};

const MATCH: [RegExp, Kind][] = [
  [/^scored again$/, "goalAgain"],
  [/^scored$/, "goal"],
  [/^assist$/, "assist"],
  [/^saved a penalty$/, "penSaved"],
  [/^missed a penalty$/, "penMissed"],
  [/^own goal$/, "ownGoal"],
  [/^red card$/, "red"],
  [/^yellow card$/, "yellow"],
  [/^clean sheet$/, "cleanSheet"],
  [/^defensive contribution$/, "defcon"],
  [/^bonus \+/, "bonus"],
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** One line of commentary for the most newsworthy thing in `what`; falls
 * back to the plain list if nothing matches. The first match wins because
 * `what` is already ordered by importance. */
export function commentate(name: string, what: string[], delta: number, key: string): string {
  for (const w of what) {
    const hit = MATCH.find(([re]) => re.test(w));
    if (!hit) continue;
    const options = LINES[hit[1]];
    const line = options[hash(key) % options.length].replaceAll("{n}", name);
    const sign = delta > 0 ? ` +${delta.toFixed(0)}.` : delta < 0 ? ` −${Math.abs(delta).toFixed(0)}.` : "";
    return what.length > 1 ? `${line}${sign} (also: ${what.filter((x) => x !== w).join(", ")})` : `${line}${sign}`;
  }
  return `${name} · ${what.join(", ")}`;
}
