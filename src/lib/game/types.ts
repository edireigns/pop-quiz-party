// Core game types. The full GameState lives ONLY on the server.
// Clients receive projections built in views.ts.

export const CATEGORY_IDS = [
  "tv",
  "genz",
  "movies",
  "music",
  "memes",
  "food",
  "college",
  "mixed",
  "inside",
] as const;
export type CategoryId = (typeof CATEGORY_IDS)[number];
export type BuiltInCategoryId = Exclude<CategoryId, "inside">;

export type Difficulty = "easy" | "medium" | "hard";
export type DifficultySetting = Difficulty | "mixed";
export type ContentLevel = "clean" | "pg13";

export const ROUND_OPTIONS = [5, 10, 15, 20] as const;
export const TIMER_OPTIONS = [45, 60, 90] as const;
export const DARE_EVERY_OPTIONS = [2, 3, 5] as const;

export interface Settings {
  rounds: (typeof ROUND_OPTIONS)[number];
  timerSec: (typeof TIMER_OPTIONS)[number];
  categories: CategoryId[];
  difficulty: DifficultySetting;
  content: ContentLevel;
  friendWords: boolean;
  dareWheel: boolean;
  dareEvery: (typeof DARE_EVERY_OPTIONS)[number];
}

export interface WordEntry {
  answer: string;
  hint: string;
  difficulty: Difficulty;
  content: ContentLevel;
}

export interface PlayerStats {
  hints: number;
  livesLost: number;
  bestSolveMs: number | null;
  solves: number;
  worstRank: number | null;
  stumped: number; // players who failed this player's friend word
}

export interface Player {
  id: string;
  nickname: string;
  tokenHash: string;
  score: number;
  joinedAt: number;
  removed: boolean;
  powerupsLeft: number;
  stats: PlayerStats;
  /** timestamps (ms) of recent reactions, for rate limiting */
  reactionTimes: number[];
  /** timestamps (ms) of recent guesses, for rate limiting */
  guessTimes: number[];
}

export type ProgressStatus = "playing" | "solved" | "out";

export interface PlayerProgress {
  guessed: string[]; // every guessed letter (upper-case), in order
  wrong: string[];
  lives: number;
  hintUsed: boolean;
  revealed: string[]; // letters revealed by the Reveal power-up
  status: ProgressStatus;
  solvedAt: number | null;
  solveMs: number | null;
  frozenUntil: number;
  frozenOnce: boolean;
  points: number; // net points actually applied this round
  powerupsUsed: PowerUp[];
}

export type RoundKind = "normal" | "final" | "suddenDeath";
export type WordSource = "builtin" | "inside" | "friend";

export interface Round {
  id: string;
  number: number; // main round number; sudden death keeps the last main number
  kind: RoundKind;
  sdAttempt: number; // 0 for normal rounds
  category: CategoryId | "friend";
  answer: string;
  hint: string;
  source: WordSource;
  authorId: string | null;
  startedAt: number;
  durationMs: number;
  deadline: number;
  pausedRemainingMs: number | null;
  participants: string[];
  progress: Record<string, PlayerProgress>;
  multiplier: number;
  endedAt: number | null;
  endReason: "timer" | "allDone" | "skipped" | "sdWinner" | "ended" | null;
  authorBonus: number;
  stumpedCount: number;
  sdWinnerId: string | null;
}

export type PowerUp = "freeze" | "reveal" | "extraLife";

export interface Submission {
  id: string;
  playerId: string;
  answer: string;
  hint: string;
  status: "pending" | "used" | "removed";
}

export interface InsideJoke {
  id: string;
  answer: string;
  hint: string;
}

export interface CustomDare {
  id: string;
  text: string;
}

export interface Reaction {
  id: number;
  emoji: string;
  playerId: string;
  at: number;
}

export interface LoserPickState {
  playerId: string;
  options: CategoryId[];
  deadline: number;
}

export interface DareState {
  playerId: string;
  options: string[];
  resultIndex: number | null;
  spinId: number;
  status: "waiting" | "spun" | "passed";
  autoSpinAt: number;
  afterRound: number;
}

export interface RoundRecordEntry {
  points: number;
  solved: boolean;
  solveMs: number | null;
  wrong: number;
  hint: boolean;
  rankAfter: number;
  satOut?: boolean;
}

export interface RoundRecord {
  number: number;
  kind: RoundKind;
  answer: string;
  category: CategoryId | "friend";
  source: WordSource;
  authorId: string | null;
  results: Record<string, RoundRecordEntry>;
}

export type Phase = "lobby" | "round" | "reveal" | "dare" | "loserPick" | "ended";

export interface GameState {
  v: 1;
  roomId: string;
  code: string;
  createdAt: number;
  settings: Settings;
  phase: Phase;
  paused: boolean;
  players: Player[];
  round: Round | null;
  roundsPlayed: number;
  /** SECRET: round numbers that will use friend-written words */
  friendRoundPlan: number[];
  usedKeys: string[];
  usedDares: string[];
  submissions: Submission[];
  insideJokes: InsideJoke[];
  customDares: CustomDare[];
  nextCategory: CategoryId | null;
  loserPick: LoserPickState | null;
  dare: DareState | null;
  lastDareRound: number;
  suddenDeath: { playerIds: string[]; attempt: number } | null;
  winnerId: string | null;
  reactions: Reaction[];
  reactionSeq: number;
  history: RoundRecord[];
  endedAt: number | null;
  gameNumber: number;
  seq: number;
}

export interface Ctx {
  now: number;
  random: () => number;
  id: () => string;
}

export class GameError extends Error {
  status: number;
  code: string;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
