// Client-safe category metadata (no words here — the word bank stays on the server).
import type { BuiltInCategoryId } from "@/lib/game/types";

export const CATEGORY_LABELS: Record<BuiltInCategoryId | "inside" | "friend", string> = {
  tv: "TV Shows",
  genz: "Gen Z Phrases",
  movies: "Movies",
  music: "Music Artists",
  memes: "Memes & Internet Culture",
  food: "Food",
  college: "College Life",
  mixed: "Mixed",
  inside: "Inside Jokes",
  friend: "Friend-Written Word",
};

export const CATEGORY_EMOJI: Record<BuiltInCategoryId | "inside" | "friend", string> = {
  tv: "📺",
  genz: "💅",
  movies: "🎬",
  music: "🎤",
  memes: "🐸",
  food: "🍕",
  college: "🎓",
  mixed: "🎲",
  inside: "🤫",
  friend: "🤝",
};

export const REACTION_EMOJIS = ["😂", "🔥", "😱", "👏", "💀", "🎉", "😭", "🤯"] as const;

// Most Likely To question packs.
import type { PackId, WwiPackId } from "@/lib/game/types";

export const PACK_LABELS: Record<PackId, string> = {
  college: "College Life",
  friends: "Friend Group",
  chaos: "Chaos",
  future: "Future Predictions",
  habits: "Funny Habits",
  custom: "Host's Questions",
};

export const PACK_EMOJI: Record<PackId, string> = {
  college: "🎓",
  friends: "👯",
  chaos: "🌪️",
  future: "🔮",
  habits: "🙃",
  custom: "✍️",
};

/** Who Wrote It? packs share labels with the Most Likely To packs where the names match. */
export const WWI_PACK_LABELS: Record<WwiPackId, string> = {
  hypotheticals: "Hypotheticals",
  college: "College Life",
  friends: "Friend Group",
  chaos: "Chaos",
  habits: "Funny Habits",
  custom: "Host's Questions",
};
export const WWI_PACK_EMOJI: Record<WwiPackId, string> = {
  hypotheticals: "🤔",
  college: "🎓",
  friends: "👯",
  chaos: "🌪️",
  habits: "🙃",
  custom: "✍️",
};

/** Label for a word category, a question pack, or "friend". */
export function labelFor(id: string): string {
  return (
    (CATEGORY_LABELS as Record<string, string>)[id] ??
    (PACK_LABELS as Record<string, string>)[id] ??
    (WWI_PACK_LABELS as Record<string, string>)[id] ??
    id
  );
}
export function emojiFor(id: string): string {
  return (
    (CATEGORY_EMOJI as Record<string, string>)[id] ??
    (PACK_EMOJI as Record<string, string>)[id] ??
    (WWI_PACK_EMOJI as Record<string, string>)[id] ??
    "🎲"
  );
}
