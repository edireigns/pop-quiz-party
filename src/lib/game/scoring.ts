// Scoring rules — single source of truth.

export const POINTS = {
  correctLetter: 10,
  solve: 50,
  perLifeLeft: 10,
  speedMax: 30,
  hintPenalty: 20,
  authorPerFail: 15,
} as const;

export const STARTING_LIVES = 6;
export const POWERUPS_PER_GAME = 2;
export const FREEZE_MS = 5000;
export const LOSER_PICK_MS = 15000;
export const DARE_AUTOSPIN_MS = 15000;
export const MAX_PLAYERS = 30;

/** Speed bonus: linear from +30 (instant) to 0 (buzzer), rounded. */
export function speedBonus(remainingMs: number, durationMs: number): number {
  if (durationMs <= 0) return 0;
  const f = Math.min(1, Math.max(0, remainingMs / durationMs));
  return Math.round(POINTS.speedMax * f);
}

/** Points for solving the word (before the round multiplier). */
export function solveBonus(livesLeft: number, remainingMs: number, durationMs: number): number {
  return POINTS.solve + Math.max(0, livesLeft) * POINTS.perLifeLeft + speedBonus(remainingMs, durationMs);
}

/**
 * Apply a delta to a score, never letting it go below 0.
 * Returns the new score and the delta actually applied.
 */
export function applyDelta(score: number, delta: number): { score: number; applied: number } {
  const next = Math.max(0, score + delta);
  return { score: next, applied: next - score };
}

/** Competition ranking (1, 1, 3) by score, descending. */
export function rankMap(entries: { id: string; score: number }[]): Map<string, number> {
  const sorted = [...entries].sort((a, b) => b.score - a.score);
  const out = new Map<string, number>();
  let prevScore: number | null = null;
  let prevRank = 0;
  sorted.forEach((e, i) => {
    const rank = prevScore === e.score ? prevRank : i + 1;
    out.set(e.id, rank);
    prevScore = e.score;
    prevRank = rank;
  });
  return out;
}

// ---------------------------------------------------------------------------
// Emoji Decode
// ---------------------------------------------------------------------------
export const EMOJI = {
  correct: 100,
  speedMax: 100,
  /** Taken off the maximum for each host hint revealed before the player answered. */
  hintPenalty: 25,
  attempts: 3,
  /** Cap when stacking Extra Life power-ups. */
  maxAttempts: 5,
} as const;

/**
 * Points for a correct Emoji Decode answer (before the round multiplier):
 * 100 + speed bonus (up to 100, linear by time left) − 25 per host hint already
 * revealed, never below 0. Wrong or missing answers score 0.
 */
export function emojiPoints(remainingMs: number, durationMs: number, hintsBefore: number): number {
  const f = durationMs > 0 ? Math.min(1, Math.max(0, remainingMs / durationMs)) : 0;
  const speed = Math.round(EMOJI.speedMax * f);
  return Math.max(0, EMOJI.correct + speed - EMOJI.hintPenalty * Math.max(0, hintsBefore));
}
