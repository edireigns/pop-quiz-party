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
