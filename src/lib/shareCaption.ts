import { tier, type Recap } from "./recap.ts";

/* The words that go with the recap image on WhatsApp. They deliberately do
 * not restate the card (score, rank, captain, badges are all on the image):
 * they react to it, challenge the group, or ask a question. Style tags:
 * T trash talk, S self-deprecating, Q teaser question. */

export type CaptionType =
  | "bigWeek"
  | "aboveAverage"
  | "belowAverage"
  | "badWeek"
  | "captainBlank"
  | "benchRegret"
  | "hitPaid"
  | "hitFailed";

export const CAPTIONS: Record<CaptionType, string[]> = {
  bigWeek: [
    "Come at me. Let's see who in this chat can top that.",
    "Who's brave enough to post theirs after this?",
    "Enjoy it. It won't happen again.",
    "Screenshot this before the next deadline humbles me.",
    "Somebody in here is about to feel very average.",
    "Is it too early to start the victory lap?",
  ],
  aboveAverage: [
    "Quietly beating the lot of you. Your turn.",
    "Where do you all sit this week? Post it.",
    "Don't tell the model I got lucky.",
    "No fireworks, just a steady week.",
    "Some of you are going to have to catch up.",
    "Anyone else having a decent one, or is it just me?",
  ],
  belowAverage: [
    "Nothing to see here. Move along.",
    "Anyone else's week go like this?",
    "Somebody here did worse. Prove me wrong.",
    "Forgettable. Which is the kindest thing I can say.",
    "Post yours and let's find the real loser.",
    "I'll take that and pretend it didn't happen.",
  ],
  badWeek: [
    "Roast me. I deserve it.",
    "Who wants to feel better by posting something worse?",
    "Go on, enjoy this one.",
    "I'd like to speak to whoever picked my team.",
    "Whoever's beating me this week, don't gloat. Gloat quietly.",
    "Group therapy: post your worst gameweek ever.",
  ],
  captainBlank: [
    "The armband was a mistake. Of course it was.",
    "Who has the worst captain story this month?",
    "Don't pick him. You're welcome.",
    "Every time. Every single time.",
    "Did any of you actually trust your captain this week?",
    "If you captained him too, we need to talk.",
  ],
  benchRegret: [
    "Who else benched the wrong one?",
    "My bench has better form than my starters.",
    "Bench the wrong one and see how it feels.",
    "I really do have a gift for this.",
    "What's your worst bench call? Mine just got worse.",
    "Rotate your squad, they said. It'll be fine, they said.",
  ],
  hitPaid: [
    "Take the hit. Always take the hit.",
    "Who else is brave enough to gamble this week?",
    "Even I'm surprised that worked.",
    "Bold moves only. Some of you play too safe.",
    "Hits: worth it or reckless? Discuss.",
    "I'd like to thank my own bad judgement for being right once.",
  ],
  hitFailed: [
    "Free advice: don't do what I did.",
    "Was it just me who panicked?",
    "Learn from my mistake, or don't.",
    "I paid good points to make my team worse.",
    "What's the worst transfer you've regretted? Make me feel better.",
    "Any of you tempted to take a hit this week? Don't.",
  ],
};

/** Which pool fits the week. The worst story wins when there are several. */
export function captionType(r: Recap): CaptionType {
  const has = (id: string) => r.achievements.some((a) => a.id === id);
  if (has("captain-blank")) return "captainBlank";
  if (has("hit-failed")) return "hitFailed";
  if (has("bench-regret")) return "benchRegret";
  if (has("hit-paid")) return "hitPaid";
  switch (tier(r).id) {
    case "legend":
      return "bigWeek";
    case "rare":
      return "aboveAverage";
    case "common":
      return "belowAverage";
    case "bruised":
      return "badWeek";
  }
}

export type PickedCaption = { id: string; text: string };

/** One caption at random, skipping any used recently (by id) while others
 * remain, so the same line doesn't turn up week after week. */
export function pickCaption(
  r: Recap,
  recentIds: string[] = [],
  rand: () => number = Math.random,
): PickedCaption {
  const type = captionType(r);
  const pool = CAPTIONS[type].map((text, i) => ({ id: `${type}:${i}`, text }));
  const fresh = pool.filter((c) => !recentIds.includes(c.id));
  const from = fresh.length ? fresh : pool;
  return from[Math.min(Math.floor(rand() * from.length), from.length - 1)];
}
