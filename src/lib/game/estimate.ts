// Estimated game length shown in the lobby. Client-safe (no server imports).
import { WWI } from "./scoring";
import type { RoundMode, Settings } from "./types";

/** Rough seconds for one round of a mode, assuming timers run out. */
export function roundSeconds(s: Settings, mode: RoundMode): number {
  switch (mode) {
    case "hangman":
    case "emoji":
      return s.timerSec + 20; // play + reveal
    case "mlt":
      return (s.voteSec ?? 20) + 20; // vote + suspense reveal
    case "blitz":
      return (s.blitzSec ?? 30) + 20 + 15; // answering + host review + reveal
    case "wwi":
      return (
        (s.writeSec ?? 45) +
        WWI.reviewMs / 1000 +
        (s.answersShown ?? 3) * ((s.guessSec ?? 15) + WWI.answerRevealMs / 1000) +
        15
      );
  }
}

/** Estimated minutes for the whole game with these settings. */
export function estimateMinutes(s: Settings): number {
  const list: RoundMode[] = s.mode === "mixed" ? (s.mixedModes?.length ? s.mixedModes : ["hangman", "emoji"]) : [s.mode];
  let total = 0;
  for (let n = 1; n <= s.rounds; n++) total += roundSeconds(s, list[(n - 1) % list.length]);
  if (s.dareWheel) total += Math.floor(s.rounds / s.dareEvery) * 30;
  total += (s.rounds - 1) * 8; // Loser Picks and transitions
  return Math.max(1, Math.round(total / 60));
}
