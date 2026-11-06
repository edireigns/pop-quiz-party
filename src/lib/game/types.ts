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

export const GAME_MODES = ["hangman", "emoji", "mlt", "wwi", "blitz", "mixed"] as const;
/** The host's choice for the whole game. */
export type GameMode = (typeof GAME_MODES)[number];
/** What a single round plays. "mlt" = Most Likely To, "wwi" = Who Wrote It? */
export const ROUND_MODES = ["hangman", "emoji", "mlt", "wwi", "blitz"] as const;
export type RoundMode = (typeof ROUND_MODES)[number];

/** Most Likely To question packs ("custom" = the host's own questions). */
export const PACK_IDS = ["college", "friends", "chaos", "future", "habits", "custom"] as const;
export type PackId = (typeof PACK_IDS)[number];
export type BuiltInPackId = Exclude<PackId, "custom">;
export const VOTE_TIMER_OPTIONS = [15, 20, 30] as const;

/** Who Wrote It? question packs ("custom" = the host's own questions). */
export const WWI_PACK_IDS = ["hypotheticals", "college", "friends", "chaos", "habits", "custom"] as const;
export type WwiPackId = (typeof WWI_PACK_IDS)[number];
export type BuiltInWwiPackId = Exclude<WwiPackId, "custom">;
export const WRITE_TIMER_OPTIONS = [30, 45, 60] as const;
export const GUESS_TIMER_OPTIONS = [10, 15, 20] as const;
export const ANSWERS_SHOWN_OPTIONS = [1, 3, 5] as const;

/** Category Blitz categories ("hostPrompts" = the host's own prompts). */
export const BLITZ_CATEGORY_IDS = ["tv", "movies", "music", "food", "memes", "college", "places", "animals", "hostPrompts"] as const;
export type BlitzCategoryId = (typeof BLITZ_CATEGORY_IDS)[number];
export type BuiltInBlitzCategoryId = Exclude<BlitzCategoryId, "hostPrompts">;
export const BLITZ_TIMER_OPTIONS = [30, 45, 60] as const;

/** One Category Blitz prompt: answers are [canonical, ...alternates] groups. */
export interface BlitzPromptEntry {
  letter: string;
  difficulty: Difficulty;
  content: ContentLevel;
  answers: string[][];
}

export const ROUND_OPTIONS = [5, 10, 15, 20] as const;
export const TIMER_OPTIONS = [45, 60, 90] as const;
export const DARE_EVERY_OPTIONS = [2, 3, 5] as const;

export interface Settings {
  /** Defaults to "hangman". Older saved rooms without it are upgraded on load. */
  mode: GameMode;
  /** Modes Mixed rotates through, in this order. Default ["hangman", "emoji"] (the original Mixed). */
  mixedModes: RoundMode[];
  /** Most Likely To voting timer (seconds). */
  voteSec: (typeof VOTE_TIMER_OPTIONS)[number];
  /** Most Likely To question packs in play. */
  packs: PackId[];
  /** Who Wrote It?: writing timer, guessing timer (per answer), answers shown per round, question packs. */
  writeSec: (typeof WRITE_TIMER_OPTIONS)[number];
  guessSec: (typeof GUESS_TIMER_OPTIONS)[number];
  answersShown: (typeof ANSWERS_SHOWN_OPTIONS)[number];
  wwiPacks: WwiPackId[];
  /** Category Blitz: round timer and categories. */
  blitzSec: (typeof BLITZ_TIMER_OPTIONS)[number];
  blitzCategories: BlitzCategoryId[];
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

export interface ClueEntry {
  clue: string; // emojis only
  answer: string;
  alternates: string[];
  difficulty: Difficulty;
  content: ContentLevel;
}

export interface QuestionEntry {
  /** The end of "Who is most likely to …?", e.g. "miss their own graduation". */
  text: string;
  content: ContentLevel;
}

export interface PlayerStats {
  hints: number;
  /** Most Likely To: rounds crowned (Crowd Favorite) and correct votes (Mind Reader). */
  crowns?: number;
  correctVotes?: number;
  /** Who Wrote It?: correct guesses (Mastermind), players fooled (Undercover Agent), times their answer was guessed (Open Book). */
  correctGuesses?: number;
  fooled?: number;
  timesGuessed?: number;
  /** Category Blitz: valid answers (Blitz Machine) and answers nobody else gave (Original Thinker). */
  validAnswers?: number;
  uniqueAnswers?: number;
  /** Correct Emoji Decode answers (Emoji Whisperer award). */
  emojiSolves: number;
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
  /** timestamps (ms) of recent Emoji Decode answers (own limiter, so fast Hangman guessing never blocks an answer) */
  answerTimes?: number[];
  /** timestamps (ms) of recent Most Likely To votes, for rate limiting */
  voteTimes?: number[];
  /** timestamps (ms) of recent Who Wrote It? answers/guesses, for rate limiting */
  wwiTimes?: number[];
  /** timestamps (ms) of recent Category Blitz answers, for rate limiting */
  blitzTimes?: number[];
}

/** "voted" is used by Most Likely To once a player's vote is locked. */
export type ProgressStatus = "playing" | "solved" | "out" | "voted";

export interface PlayerProgress {
  guessed: string[]; // every guessed letter (upper-case), in order
  wrong: string[];
  lives: number;
  hintUsed: boolean;
  revealed: string[]; // letters revealed by the Reveal power-up (Hangman)
  /** Emoji Decode: letter positions (0-based, letters/digits only) revealed privately by the Reveal power-up. */
  revealedPos?: number[];
  /** Most Likely To: Double Vote power-up armed for this round. */
  doubleVote?: boolean;
  /** Most Likely To: private Peek result (current leader(s) when peeked). */
  peek?: { leaderIds: string[]; votes: number } | null;
  /** Most Likely To: the player they voted for was removed, so they may vote again. */
  voteReset?: boolean;
  /** Most Likely To: after the round, whether this player's vote matched a crowned player. */
  voteResult?: "correct" | "wrong" | "missed" | null;
  /** Who Wrote It?: correct guesses this round, and players this player's answer fooled. */
  wwiCorrect?: number;
  wwiFooled?: number;
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
  /** "hangman" for rounds saved before Emoji Decode existed (filled in by upgradeState). */
  mode: RoundMode;
  number: number; // main round number; sudden death keeps the last main number
  kind: RoundKind;
  sdAttempt: number; // 0 for normal rounds
  /** Hangman/Emoji: a category. Most Likely To / Who Wrote It?: a question pack. */
  category: CategoryId | PackId | WwiPackId | BlitzCategoryId | "friend";
  answer: string;
  hint: string;
  /** Emoji Decode only: the emoji clue (public) and accepted alternates (SECRET until the round ends). */
  clue: string | null;
  alternates: string[];
  /** Emoji Decode only: hints the host has dropped, in order (public). */
  hostHints: string[];
  /** Most Likely To only: the question (public), who can be voted for, and the votes. */
  question?: string | null;
  candidates?: string[];
  /** SECRET voter → vote. Never leaves the server, and is wiped once the round is scored. */
  votes?: Record<string, { targetId: string; weight: number }>;
  /** Vote totals per candidate, set when the round ends (public then). */
  totals?: Record<string, number> | null;
  crowned?: string[];
  /** Who Wrote It? only. */
  wwi?: WwiRound;
  /** Category Blitz only. */
  blitz?: BlitzRound;
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

export type WwiStage = "writing" | "review" | "guessing" | "answerReveal";
export type WwiResult = "correct" | "wrong" | "missed" | "author";

/** One shown (or about-to-be-shown) answer. authorId is SECRET until that answer's reveal. */
export interface WwiShownAnswer {
  answerId: string;
  text: string;
  authorId: string;
  /**
   * Each guesser's own choices, already shuffled: the author plus up to 3 other
   * players (never the guesser themselves).
   */
  orders: Record<string, string[]>;
  /** SECRET guesser → picked player ids (2 with Double Guess). Dropped once the author is revealed. */
  guesses: Record<string, string[]>;
  /** Eliminate Two: the wrong names removed from that guesser's buttons. */
  eliminated: Record<string, string[]>;
  doubleGuess: Record<string, boolean>;
  /** Power-ups spent on this answer (refunded if the host skips it). */
  used: Record<string, PowerUp[]>;
}

/** Public record of a revealed answer. */
export interface WwiRevealed {
  answerId: string;
  text: string;
  authorId: string;
  correct: number;
  wrong: number;
  guessers: number;
}

export interface WwiRound {
  stage: WwiStage;
  /** SECRET author → their answer. Unshown answers are wiped when the round ends. */
  answers: Record<string, { id: string; text: string }>;
  /** SECRET: answer ids still to show, in order. */
  queue: string[];
  current: WwiShownAnswer | null;
  /** How many answers this round will show (for "Answer 2 of 3"). */
  total: number;
  revealed: WwiRevealed[];
  /** Answer ids the host removed (never shown). */
  removed: string[];
  /** Each player's private result for the answer just revealed. */
  lastResults: Record<string, WwiResult>;
  noAnswers: boolean;
}

export interface Submission {
  id: string;
  playerId: string;
  answer: string;
  hint: string;
  /** Optional emoji clue so the word can be used in Emoji Decode rounds. */
  clue?: string;
  status: "pending" | "used" | "removed";
}

export interface InsideJoke {
  id: string;
  answer: string;
  hint: string;
}

export interface InsideClue {
  id: string;
  clue: string;
  answer: string;
  alternates: string[];
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
  /** Categories for word rounds, question packs for Most Likely To rounds. */
  kind?: "category" | "pack";
  options: (CategoryId | PackId | WwiPackId | BlitzCategoryId)[];
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
  mode: RoundMode;
  number: number;
  kind: RoundKind;
  answer: string;
  category: CategoryId | PackId | WwiPackId | BlitzCategoryId | "friend";
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
  /** Host-written emoji clues for the Inside Jokes category in Emoji Decode rounds. */
  insideClues: InsideClue[];
  /** Emoji clues already shown this game (answers are tracked in usedKeys across both modes). */
  usedClues: string[];
  /** Settings the current/last game was started with (awards use these, so changing settings after a game doesn't rewrite it). */
  startedSettings: Settings | null;
  customDares: CustomDare[];
  /** Most Likely To: the host's own questions, players' submitted questions, and questions already asked. */
  customQuestions: { id: string; text: string }[];
  questionSubs: { id: string; playerId: string; text: string; status: "pending" | "used" | "removed" }[];
  usedQuestions: string[];
  /** SECRET: round numbers that will use a player-submitted question. */
  questionRoundPlan: number[];
  /** Set when a Most Likely To- or Who Wrote It?-only game can't start the next round. */
  hold: "needPlayers" | null;
  /** How many players the held mode needs (3 for Most Likely To, 4 for Who Wrote It?). */
  holdMin?: number | null;
  /** Who Wrote It?: the host's questions, players' questions, questions asked, friend-question round plan,
   * how many times each player's answers have been shown, and who has written at least one answer. */
  customPrompts: { id: string; text: string }[];
  promptSubs: { id: string; playerId: string; text: string; status: "pending" | "used" | "removed" }[];
  usedPrompts: string[];
  wwiRoundPlan: number[];
  wwiShownCount: Record<string, number>;
  wwiWriters: string[];
  /** Category Blitz: the host's own prompts and prompts already used. */
  customBlitz: CustomBlitzPrompt[];
  usedBlitz: string[];
  nextCategory: CategoryId | PackId | WwiPackId | BlitzCategoryId | null;
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

// ---------------------------------------------------------------------------
// Category Blitz
// ---------------------------------------------------------------------------
export interface CustomBlitzPrompt {
  id: string;
  /** Free text, e.g. "Things in a fridge". */
  category: string;
  letter: string;
  /** Optional accepted answers ([canonical, ...alternates]); empty → the host reviews the common answers. */
  answers: string[][];
}

/** One submitted answer. `key` is SECRET until the reveal: "a:<n>" accepted answer n, "u:<norm>" unrecognized, "x" invalid. */
export interface BlitzSub {
  text: string;
  norm: string;
  key: string;
  at: number;
}

export interface BlitzReviewItem {
  id: string;
  key: string;
  text: string;
  count: number;
  verdict: "ok" | "no" | null;
}

export interface BlitzPlayerResult {
  valid: number;
  unique: number;
  points: number;
}

export interface BlitzRound {
  stage: "play" | "review";
  categoryLabel: string;
  letter: string;
  promptKey: string;
  /** SECRET: accepted answers. Dropped when the round ends. */
  answers: string[][];
  /** SECRET (other players): each player's submitted answers. Dropped when the round ends. */
  subs: Record<string, BlitzSub[]>;
  /** Extra Time power-up: extra ms per player. */
  extra: Record<string, number>;
  /** Get a Suggestion: private to that player. */
  suggestions: Record<string, string>;
  review: BlitzReviewItem[];
  /** Public after the reveal. */
  results: {
    players: Record<string, BlitzPlayerResult>;
    popular: { text: string; count: number }[];
    uniques: { text: string; playerId: string }[];
  } | null;
}
