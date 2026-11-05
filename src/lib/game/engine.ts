// Pure, deterministic game engine. Every function mutates the given state in
// place (callers clone/persist) and takes a Ctx for time + randomness so the
// whole game can be unit-tested and replayed.
import { WORD_BANK } from "@/data/words";
import { CLUE_BANK } from "@/data/clues";
import { startersFor } from "@/data/dares";
import { isBlocked } from "@/lib/moderation";
import { REACTION_EMOJIS } from "@/data/categories";
export { REACTION_EMOJIS };
import { answerLetters, clueKey, hostHintText, isCorrectAnswer, MAX_HOST_HINTS, normalizeAnswer } from "./answers";
import {
  applyDelta,
  DARE_AUTOSPIN_MS,
  EMOJI,
  emojiPoints,
  FREEZE_MS,
  LOSER_PICK_MS,
  MAX_PLAYERS,
  POINTS,
  POWERUPS_PER_GAME,
  rankMap,
  solveBonus,
  STARTING_LIVES,
} from "./scoring";
import { isSolved, letterSet, normalizeGuess, wordKey } from "./text";
import {
  type BuiltInCategoryId,
  CATEGORY_IDS,
  type CategoryId,
  type ClueEntry,
  GAME_MODES,
  type GameMode,
  type InsideClue,
  type RoundMode,
  type Ctx,
  DARE_EVERY_OPTIONS,
  GameError,
  type GameState,
  type Player,
  type PlayerProgress,
  type PowerUp,
  ROUND_OPTIONS,
  type Round,
  type Settings,
  TIMER_OPTIONS,
  type WordEntry,
  type WordSource,
} from "./types";

export const BUILTIN_CATEGORIES: BuiltInCategoryId[] = ["tv", "genz", "movies", "music", "memes", "food", "college", "mixed"];

export const DEFAULT_SETTINGS: Settings = {
  mode: "hangman",
  rounds: 10,
  timerSec: 60,
  categories: [...BUILTIN_CATEGORIES],
  difficulty: "mixed",
  content: "clean",
  friendWords: false,
  dareWheel: false,
  dareEvery: 3,
};

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
export function pick<T>(arr: readonly T[], random: () => number): T {
  if (arr.length === 0) throw new Error("pick from empty array");
  return arr[Math.floor(random() * arr.length) % arr.length];
}

export function shuffle<T>(arr: readonly T[], random: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function activePlayers(s: GameState): Player[] {
  return s.players.filter((p) => !p.removed);
}

export function getPlayer(s: GameState, id: string): Player {
  const p = s.players.find((x) => x.id === id);
  if (!p || p.removed) throw new GameError("not_in_game", "You're not in this game.", 403);
  return p;
}

function assertPhase(s: GameState, ...phases: GameState["phase"][]) {
  if (!phases.includes(s.phase)) throw new GameError("wrong_phase", "That can't be done right now.", 409);
}

function bump(s: GameState) {
  s.seq += 1;
}

/** Letters the player can see: correct guesses plus power-up reveals. */
export function knownLetters(r: Round, pr: PlayerProgress): Set<string> {
  const letters = letterSet(r.answer);
  const known = new Set<string>();
  for (const g of pr.guessed) if (letters.has(g)) known.add(g);
  for (const g of pr.revealed) known.add(g);
  return known;
}

/** Answers are tracked by two keys so Mixed mode never repeats an answer across Hangman and Emoji Decode. */
function answerKeys(answer: string): string[] {
  return [wordKey(answer), `n:${normalizeAnswer(answer)}`];
}
function isUsedAnswer(used: Set<string>, answer: string): boolean {
  return answerKeys(answer).some((k) => used.has(k));
}
function markUsed(s: GameState, answer: string, clue: string | null) {
  s.usedKeys.push(...answerKeys(answer));
  if (clue) s.usedClues.push(clueKey(clue));
}

/** Which kind of round number `n` is. Mixed alternates, starting with Hangman. */
export function roundModeFor(s: GameState, n: number): RoundMode {
  const mode = s.settings.mode ?? "hangman";
  if (mode === "mixed") return n % 2 === 1 ? "hangman" : "emoji";
  return mode;
}

/** Sudden Death uses the game's mode; Mixed uses Hangman. */
export function suddenDeathMode(s: GameState): RoundMode {
  return s.settings.mode === "emoji" ? "emoji" : "hangman";
}

/**
 * Fill in fields added after a room was saved (e.g. rooms created before Emoji
 * Decode existed). Purely additive: existing data is never changed.
 */
export function upgradeState(s: GameState): GameState {
  const any = s as unknown as Record<string, unknown>;
  if (!(s.settings as Partial<Settings>).mode) s.settings.mode = "hangman";
  if (!Array.isArray(any.insideClues)) s.insideClues = [];
  if (!Array.isArray(any.usedClues)) s.usedClues = [];
  if (any.startedSettings === undefined) s.startedSettings = null;
  for (const p of s.players) if (typeof p.stats.emojiSolves !== "number") p.stats.emojiSolves = 0;
  if (s.round) {
    const r = s.round as Partial<Round> & Round;
    if (!r.mode) r.mode = "hangman";
    if (r.clue === undefined) r.clue = null;
    if (!Array.isArray(r.alternates)) r.alternates = [];
    if (!Array.isArray(r.hostHints)) r.hostHints = [];
  }
  for (const h of s.history) if (!h.mode) h.mode = "hangman";
  return s;
}

export function remainingMs(r: Round, now: number): number {
  if (r.pausedRemainingMs != null) return r.pausedRemainingMs;
  return Math.max(0, r.deadline - now);
}

function addScore(s: GameState, playerId: string, delta: number, pr?: PlayerProgress) {
  const p = s.players.find((x) => x.id === playerId);
  if (!p) return 0;
  const { score, applied } = applyDelta(p.score, delta);
  p.score = score;
  if (pr) pr.points += applied;
  return applied;
}

// ---------------------------------------------------------------------------
// creation & setup
// ---------------------------------------------------------------------------
export function createGame(opts: { roomId: string; code: string; now: number; settings?: Partial<Settings> }): GameState {
  return {
    v: 1,
    roomId: opts.roomId,
    code: opts.code,
    createdAt: opts.now,
    settings: { ...DEFAULT_SETTINGS, ...opts.settings },
    phase: "lobby",
    paused: false,
    players: [],
    round: null,
    roundsPlayed: 0,
    friendRoundPlan: [],
    usedKeys: [],
    usedDares: [],
    submissions: [],
    insideJokes: [],
    insideClues: [],
    usedClues: [],
    startedSettings: null,
    customDares: [],
    nextCategory: null,
    loserPick: null,
    dare: null,
    lastDareRound: 0,
    suddenDeath: null,
    winnerId: null,
    reactions: [],
    reactionSeq: 0,
    history: [],
    endedAt: null,
    gameNumber: 1,
    seq: 1,
  };
}

/** Validate and apply a (partial) settings patch. Lobby only. */
export function updateSettings(s: GameState, patch: Partial<Settings>) {
  // Lobby, or the game-over screen so the host can change things before Play Again.
  assertPhase(s, "lobby", "ended");
  const next: Settings = { ...s.settings };
  if (patch.mode !== undefined) {
    if (!GAME_MODES.includes(patch.mode as GameMode)) throw new GameError("bad_settings", "Game mode must be Hangman, Emoji Decode or Mixed.");
    next.mode = patch.mode;
  }
  if (patch.rounds !== undefined) {
    if (!ROUND_OPTIONS.includes(patch.rounds)) throw new GameError("bad_settings", "Rounds must be 5, 10, 15 or 20.");
    next.rounds = patch.rounds;
  }
  if (patch.timerSec !== undefined) {
    if (!TIMER_OPTIONS.includes(patch.timerSec)) throw new GameError("bad_settings", "Timer must be 45, 60 or 90 seconds.");
    next.timerSec = patch.timerSec;
  }
  if (patch.categories !== undefined) {
    if (!Array.isArray(patch.categories)) throw new GameError("bad_settings", "Pick at least one category.");
    const cats = [...new Set(patch.categories)].filter((c): c is CategoryId => CATEGORY_IDS.includes(c as CategoryId));
    if (cats.length === 0) throw new GameError("bad_settings", "Pick at least one category.");
    next.categories = cats;
  }
  if (patch.difficulty !== undefined) {
    if (!["easy", "medium", "hard", "mixed"].includes(patch.difficulty)) throw new GameError("bad_settings", "Bad difficulty.");
    next.difficulty = patch.difficulty;
  }
  if (patch.content !== undefined) {
    if (!["clean", "pg13"].includes(patch.content)) throw new GameError("bad_settings", "Bad content level.");
    next.content = patch.content;
  }
  if (patch.friendWords !== undefined) next.friendWords = Boolean(patch.friendWords);
  if (patch.dareWheel !== undefined) next.dareWheel = Boolean(patch.dareWheel);
  if (patch.dareEvery !== undefined) {
    if (!DARE_EVERY_OPTIONS.includes(patch.dareEvery)) throw new GameError("bad_settings", "Dare wheel: every 2, 3 or 5 rounds.");
    next.dareEvery = patch.dareEvery;
  }
  s.settings = next;
  bump(s);
}

// ---------------------------------------------------------------------------
// players
// ---------------------------------------------------------------------------
export function nicknameTaken(s: GameState, nickname: string): boolean {
  const key = nickname.toLowerCase();
  return activePlayers(s).some((p) => p.nickname.toLowerCase() === key);
}

export function addPlayer(s: GameState, opts: { nickname: string; tokenHash: string }, ctx: Ctx): Player {
  if (s.phase === "ended") throw new GameError("game_ended", "This game has already ended.", 410);
  if (activePlayers(s).length >= MAX_PLAYERS) throw new GameError("room_full", "This room is full (30 players max).", 409);
  if (nicknameTaken(s, opts.nickname)) throw new GameError("nickname_taken", "That nickname is taken in this room.", 409);
  const p: Player = {
    id: ctx.id(),
    nickname: opts.nickname,
    tokenHash: opts.tokenHash,
    score: 0,
    joinedAt: ctx.now,
    removed: false,
    powerupsLeft: POWERUPS_PER_GAME,
    stats: { hints: 0, emojiSolves: 0, livesLost: 0, bestSolveMs: null, solves: 0, worstRank: null, stumped: 0 },
    reactionTimes: [],
    guessTimes: [],
  };
  s.players.push(p);
  bump(s);
  return p;
}

export function removePlayer(s: GameState, playerId: string, ctx: Ctx) {
  const p = getPlayer(s, playerId);
  p.removed = true;
  for (const sub of s.submissions) if (sub.playerId === playerId && sub.status === "pending") sub.status = "removed";
  if (s.phase === "round" && s.round) {
    const r = s.round;
    r.participants = r.participants.filter((id) => id !== playerId);
    delete r.progress[playerId];
    if (s.suddenDeath) s.suddenDeath.playerIds = s.suddenDeath.playerIds.filter((id) => id !== playerId);
    checkRoundComplete(s, ctx);
  } else if (s.suddenDeath) {
    s.suddenDeath.playerIds = s.suddenDeath.playerIds.filter((id) => id !== playerId);
  }
  if (s.phase === "loserPick" && s.loserPick?.playerId === playerId) {
    resolveLoserPick(s, null, ctx);
  }
  if (s.phase === "dare" && s.dare?.playerId === playerId && s.dare.status === "waiting") {
    s.dare.status = "passed";
  }
  bump(s);
}

// ---------------------------------------------------------------------------
// prep content (host)
// ---------------------------------------------------------------------------
export function addInsideJoke(s: GameState, answer: string, hint: string, ctx: Ctx) {
  if (s.insideJokes.length >= 100) throw new GameError("too_many", "Inside Jokes is full (100 max).");
  if (s.insideJokes.some((j) => wordKey(j.answer) === wordKey(answer)))
    throw new GameError("duplicate", "That inside joke is already on the list.");
  s.insideJokes.push({ id: ctx.id(), answer, hint });
  bump(s);
}

function dropInsideCategoryIfEmpty(s: GameState) {
  if (s.insideJokes.length === 0 && s.insideClues.length === 0 && s.settings.categories.includes("inside")) {
    const cats = s.settings.categories.filter((c) => c !== "inside");
    s.settings.categories = cats.length ? cats : [...BUILTIN_CATEGORIES];
  }
}

export function removeInsideJoke(s: GameState, id: string) {
  s.insideJokes = s.insideJokes.filter((j) => j.id !== id);
  dropInsideCategoryIfEmpty(s);
  bump(s);
}

/** Host-written emoji clue for the Inside Jokes category (Emoji Decode rounds). */
export function addInsideClue(s: GameState, clue: string, answer: string, alternates: string[], ctx: Ctx) {
  if (s.insideClues.length >= 100) throw new GameError("too_many", "Inside Jokes clues are full (100 max).");
  if (s.insideClues.some((j) => normalizeAnswer(j.answer) === normalizeAnswer(answer) || clueKey(j.clue) === clueKey(clue)))
    throw new GameError("duplicate", "That emoji clue or answer is already on the list.");
  s.insideClues.push({ id: ctx.id(), clue, answer, alternates });
  bump(s);
}

export function removeInsideClue(s: GameState, id: string) {
  s.insideClues = s.insideClues.filter((j) => j.id !== id);
  dropInsideCategoryIfEmpty(s);
  bump(s);
}

export function addCustomDare(s: GameState, text: string, ctx: Ctx) {
  if (s.customDares.length >= 50) throw new GameError("too_many", "Custom dares are full (50 max).");
  s.customDares.push({ id: ctx.id(), text });
  bump(s);
}

export function removeCustomDare(s: GameState, id: string) {
  s.customDares = s.customDares.filter((d) => d.id !== id);
  bump(s);
}

export function submitWord(s: GameState, playerId: string, answer: string, hint: string, ctx: Ctx, clue?: string) {
  assertPhase(s, "lobby");
  if (!s.settings.friendWords) throw new GameError("friend_words_off", "Friend-written words are turned off.", 409);
  if (s.settings.mode === "emoji" && !clue)
    throw new GameError("clue_required", "Add an emoji clue for your word — this game is Emoji Decode.");
  getPlayer(s, playerId);
  const existing = s.submissions.find((x) => x.playerId === playerId && x.status === "pending");
  if (existing) {
    existing.answer = answer;
    existing.hint = hint;
    if (clue) existing.clue = clue;
    else delete existing.clue;
  } else {
    if (s.submissions.some((x) => x.playerId === playerId && x.status === "removed"))
      throw new GameError("submission_removed", "The host removed your word. You can't submit another this game.", 409);
    s.submissions.push({ id: ctx.id(), playerId, answer, hint, status: "pending", ...(clue ? { clue } : {}) });
  }
  bump(s);
}

export function removeSubmission(s: GameState, id: string) {
  assertPhase(s, "lobby");
  const sub = s.submissions.find((x) => x.id === id);
  if (!sub) throw new GameError("not_found", "Submission not found.", 404);
  sub.status = "removed";
  bump(s);
}

// ---------------------------------------------------------------------------
// word selection
// ---------------------------------------------------------------------------
function builtinPool(s: GameState, cat: BuiltInCategoryId, strictDifficulty: boolean): WordEntry[] {
  const used = new Set(s.usedKeys);
  return WORD_BANK[cat].filter(
    (e) =>
      (s.settings.content === "pg13" || e.content === "clean") &&
      (!strictDifficulty || s.settings.difficulty === "mixed" || e.difficulty === s.settings.difficulty) &&
      !isUsedAnswer(used, e.answer),
  );
}

function insidePool(s: GameState) {
  const used = new Set(s.usedKeys);
  return s.insideJokes.filter((j) => !isUsedAnswer(used, j.answer) && !isBlocked(j.answer, s.settings.content));
}

function cluePool(s: GameState, cat: BuiltInCategoryId, strictDifficulty: boolean): ClueEntry[] {
  const used = new Set(s.usedKeys);
  const usedClues = new Set(s.usedClues);
  return CLUE_BANK[cat].filter(
    (e) =>
      (s.settings.content === "pg13" || e.content === "clean") &&
      (!strictDifficulty || s.settings.difficulty === "mixed" || e.difficulty === s.settings.difficulty) &&
      !isUsedAnswer(used, e.answer) &&
      !usedClues.has(clueKey(e.clue)),
  );
}

function insideCluePool(s: GameState): InsideClue[] {
  const used = new Set(s.usedKeys);
  const usedClues = new Set(s.usedClues);
  return s.insideClues.filter(
    (j) => !isUsedAnswer(used, j.answer) && !usedClues.has(clueKey(j.clue)) && !isBlocked(j.answer, s.settings.content),
  );
}

/** Categories that still have unused content for the given round mode (default: the next round's). */
export function availableCategories(s: GameState, mode: RoundMode = roundModeFor(s, s.roundsPlayed + 1)): CategoryId[] {
  return s.settings.categories.filter((c) => {
    if (mode === "emoji") return c === "inside" ? insideCluePool(s).length > 0 : cluePool(s, c, false).length > 0;
    return c === "inside" ? insidePool(s).length > 0 : builtinPool(s, c, false).length > 0;
  });
}

export function chooseWord(
  s: GameState,
  category: CategoryId,
  ctx: Ctx,
): { answer: string; hint: string; category: CategoryId; source: WordSource } {
  if (category === "inside") {
    const pool = insidePool(s);
    if (pool.length) {
      const j = pick(pool, ctx.random);
      return { answer: j.answer, hint: j.hint, category: "inside", source: "inside" };
    }
  } else {
    let pool = builtinPool(s, category, true);
    if (!pool.length) pool = builtinPool(s, category, false);
    if (pool.length) {
      const e = pick(pool, ctx.random);
      return { answer: e.answer, hint: e.hint, category, source: "builtin" };
    }
  }
  // Fallbacks: another selected category, then any built-in category.
  const others = availableCategories(s, "hangman").filter((c) => c !== category);
  if (others.length) return chooseWord(s, pick(others, ctx.random), ctx);
  const anyBuiltin = BUILTIN_CATEGORIES.filter((c) => builtinPool(s, c, false).length > 0);
  if (anyBuiltin.length) {
    const c = pick(anyBuiltin, ctx.random);
    const e = pick(builtinPool(s, c, false), ctx.random);
    return { answer: e.answer, hint: e.hint, category: c, source: "builtin" };
  }
  // Everything used (huge game): allow repeats again.
  s.usedKeys = [];
  return chooseWord(s, category === "inside" ? "mixed" : category, ctx);
}

export function chooseClue(
  s: GameState,
  category: CategoryId,
  ctx: Ctx,
): { clue: string; answer: string; alternates: string[]; category: CategoryId; source: WordSource } {
  if (category === "inside") {
    const pool = insideCluePool(s);
    if (pool.length) {
      const j = pick(pool, ctx.random);
      return { clue: j.clue, answer: j.answer, alternates: j.alternates, category: "inside", source: "inside" };
    }
  } else {
    let pool = cluePool(s, category, true);
    if (!pool.length) pool = cluePool(s, category, false);
    if (pool.length) {
      const e = pick(pool, ctx.random);
      return { clue: e.clue, answer: e.answer, alternates: e.alternates, category, source: "builtin" };
    }
  }
  const others = availableCategories(s, "emoji").filter((c) => c !== category);
  if (others.length) return chooseClue(s, pick(others, ctx.random), ctx);
  const anyBuiltin = BUILTIN_CATEGORIES.filter((c) => cluePool(s, c, false).length > 0);
  if (anyBuiltin.length) {
    const c = pick(anyBuiltin, ctx.random);
    const e = pick(cluePool(s, c, false), ctx.random);
    return { clue: e.clue, answer: e.answer, alternates: e.alternates, category: c, source: "builtin" };
  }
  s.usedKeys = [];
  s.usedClues = [];
  return chooseClue(s, category === "inside" ? "mixed" : category, ctx);
}

function friendWordAvailable(s: GameState, roundNumber: number, mode: RoundMode = roundModeFor(s, roundNumber)) {
  if (!s.settings.friendWords || !s.friendRoundPlan.includes(roundNumber)) return null;
  if (activePlayers(s).length < 2) return null;
  const pending = s.submissions.filter(
    (x) =>
      x.status === "pending" &&
      (mode === "hangman" || !!x.clue) && // Emoji Decode rounds need a clue
      s.players.some((p) => p.id === x.playerId && !p.removed),
  );
  return pending.length ? pending : null;
}

// ---------------------------------------------------------------------------
// game flow
// ---------------------------------------------------------------------------
export function startGame(s: GameState, ctx: Ctx) {
  assertPhase(s, "lobby");
  if (activePlayers(s).length < 1) throw new GameError("no_players", "Wait for at least one player to join.", 409);
  s.history = [];
  s.roundsPlayed = 0;
  s.winnerId = null;
  s.suddenDeath = null;
  s.lastDareRound = 0;
  s.friendRoundPlan = [];
  s.startedSettings = { ...s.settings, categories: [...s.settings.categories] };
  if (s.settings.friendWords) {
    const pending = s.submissions.filter(
      (x) => x.status === "pending" && !getRemoved(s, x.playerId) && (s.settings.mode !== "emoji" || !!x.clue),
    );
    const count = Math.min(pending.length, Math.round(s.settings.rounds / 3));
    const rounds = Array.from({ length: s.settings.rounds }, (_, i) => i + 1);
    s.friendRoundPlan = shuffle(rounds, ctx.random).slice(0, count).sort((a, b) => a - b);
  }
  startRound(s, ctx);
}

function getRemoved(s: GameState, id: string) {
  return s.players.find((p) => p.id === id)?.removed ?? true;
}

function newProgress(lives: number): PlayerProgress {
  return {
    guessed: [],
    wrong: [],
    lives,
    hintUsed: false,
    revealed: [],
    status: "playing",
    solvedAt: null,
    solveMs: null,
    frozenUntil: 0,
    frozenOnce: false,
    points: 0,
    powerupsUsed: [],
  };
}

export function startRound(s: GameState, ctx: Ctx, category?: CategoryId | null) {
  const n = s.roundsPlayed + 1;
  const kind = n >= s.settings.rounds ? "final" : "normal";
  const mode = roundModeFor(s, n);
  const active = activePlayers(s);

  let answer: string, hint: string, cat: CategoryId | "friend", source: WordSource;
  let clue: string | null = null;
  let alternates: string[] = [];
  let authorId: string | null = null;
  const friendPool = friendWordAvailable(s, n, mode);
  if (friendPool) {
    const sub = pick(friendPool, ctx.random);
    sub.status = "used";
    answer = sub.answer;
    hint = sub.hint;
    if (mode === "emoji") clue = sub.clue ?? null;
    cat = "friend";
    source = "friend";
    authorId = sub.playerId;
  } else {
    const available = availableCategories(s, mode);
    const want = category ?? s.nextCategory ?? (available.length ? pick(available, ctx.random) : pick(s.settings.categories, ctx.random));
    if (mode === "emoji") {
      const c = chooseClue(s, want, ctx);
      ({ answer, clue, alternates } = c);
      hint = "";
      cat = c.category;
      source = c.source;
    } else {
      const w = chooseWord(s, want, ctx);
      answer = w.answer;
      hint = w.hint;
      cat = w.category;
      source = w.source;
    }
  }
  markUsed(s, answer, clue);

  const participants = active.map((p) => p.id).filter((id) => id !== authorId);
  const durationMs = s.settings.timerSec * 1000;
  const progress: Record<string, PlayerProgress> = {};
  for (const id of participants) progress[id] = newProgress(mode === "emoji" ? EMOJI.attempts : STARTING_LIVES);

  s.roundsPlayed = n;
  s.round = {
    id: ctx.id(),
    mode,
    number: n,
    kind,
    sdAttempt: 0,
    category: cat,
    answer,
    hint,
    clue,
    alternates,
    hostHints: [],
    source,
    authorId,
    startedAt: ctx.now,
    durationMs,
    deadline: ctx.now + durationMs,
    pausedRemainingMs: null,
    participants,
    progress,
    multiplier: kind === "final" ? 2 : 1,
    endedAt: null,
    endReason: null,
    authorBonus: 0,
    stumpedCount: 0,
    sdWinnerId: null,
  };
  s.phase = "round";
  s.paused = false;
  s.nextCategory = null;
  s.loserPick = null;
  s.dare = null;
  bump(s);
}

function startSuddenDeath(s: GameState, ctx: Ctx) {
  const sd = s.suddenDeath!;
  sd.playerIds = sd.playerIds.filter((id) => !getRemoved(s, id));
  if (sd.playerIds.length < 2) {
    s.winnerId = sd.playerIds[0] ?? null;
    finishGame(s, ctx);
    return;
  }
  const mode = suddenDeathMode(s);
  const available = availableCategories(s, mode).filter((c) => c !== "inside");
  const cat = available.length ? pick(available, ctx.random) : pick(BUILTIN_CATEGORIES, ctx.random);
  const w =
    mode === "emoji"
      ? chooseClue(s, cat, ctx)
      : { ...chooseWord(s, cat, ctx), clue: null as string | null, alternates: [] as string[] };
  markUsed(s, w.answer, w.clue);
  const durationMs = s.settings.timerSec * 1000;
  const progress: Record<string, PlayerProgress> = {};
  for (const id of sd.playerIds) progress[id] = newProgress(1); // one wrong guess/answer eliminates
  s.round = {
    id: ctx.id(),
    mode,
    number: s.roundsPlayed,
    kind: "suddenDeath",
    sdAttempt: sd.attempt,
    category: w.category,
    answer: w.answer,
    hint: "hint" in w ? w.hint : "",
    clue: w.clue,
    alternates: w.alternates,
    hostHints: [],
    source: w.source,
    authorId: null,
    startedAt: ctx.now,
    durationMs,
    deadline: ctx.now + durationMs,
    pausedRemainingMs: null,
    participants: [...sd.playerIds],
    progress,
    multiplier: 1,
    endedAt: null,
    endReason: null,
    authorBonus: 0,
    stumpedCount: 0,
    sdWinnerId: null,
  };
  s.phase = "round";
  s.paused = false;
  bump(s);
}

function currentProgress(s: GameState, playerId: string): { r: Round; pr: PlayerProgress } {
  assertPhase(s, "round");
  const r = s.round!;
  getPlayer(s, playerId);
  if (s.paused) throw new GameError("paused", "The game is paused.", 409);
  if (r.authorId === playerId) throw new GameError("sitting_out", "Your word is being played — sit back and enjoy.", 409);
  const pr = r.progress[playerId];
  if (!pr) throw new GameError("not_playing", "You'll join from the next round.", 409);
  if (pr.status !== "playing") throw new GameError("finished", "You're done for this round.", 409);
  return { r, pr };
}

function rateLimit(times: number[], now: number, windowMs: number, max: number, minGapMs = 0): number[] {
  const recent = times.filter((t) => now - t < windowMs);
  if (recent.length >= max || (minGapMs && recent.length && now - recent[recent.length - 1] < minGapMs))
    throw new GameError("rate_limited", "Whoa, slow down!", 429);
  recent.push(now);
  return recent;
}

function markSolved(s: GameState, r: Round, playerId: string, pr: PlayerProgress, ctx: Ctx) {
  pr.status = "solved";
  pr.solvedAt = ctx.now;
  const rem = remainingMs(r, ctx.now);
  pr.solveMs = r.durationMs - rem;
  if (r.kind === "suddenDeath") {
    r.sdWinnerId = playerId;
    s.winnerId = playerId;
    endRound(s, ctx, "sdWinner");
    return;
  }
  const base = r.mode === "emoji" ? emojiPoints(rem, r.durationMs, r.hostHints.length) : solveBonus(pr.lives, rem, r.durationMs);
  addScore(s, playerId, base * r.multiplier, pr);
}

export function guess(s: GameState, playerId: string, rawLetter: unknown, ctx: Ctx) {
  const letter = normalizeGuess(rawLetter);
  if (!letter) throw new GameError("bad_letter", "Guess a single letter A–Z.");
  const { r, pr } = currentProgress(s, playerId);
  if (r.mode === "emoji") throw new GameError("wrong_mode", "This is an Emoji Decode round — type the answer.", 409);
  if (pr.frozenUntil > ctx.now) throw new GameError("frozen", "Your keyboard is frozen! ❄️", 409);
  const p = getPlayer(s, playerId);
  p.guessTimes = rateLimit(p.guessTimes, ctx.now, 1000, 12);
  if (pr.guessed.includes(letter) || pr.revealed.includes(letter))
    throw new GameError("already_guessed", `You already tried ${letter}.`, 409);
  pr.guessed.push(letter);
  const letters = letterSet(r.answer);
  if (letters.has(letter)) {
    if (r.kind !== "suddenDeath") addScore(s, playerId, POINTS.correctLetter * r.multiplier, pr);
    if (isSolved(r.answer, knownLetters(r, pr))) markSolved(s, r, playerId, pr, ctx);
  } else {
    pr.wrong.push(letter);
    pr.lives -= 1;
    if (pr.lives <= 0) {
      pr.lives = 0;
      pr.status = "out";
    }
  }
  bump(s);
  if (s.phase === "round") checkRoundComplete(s, ctx);
  return { correct: letters.has(letter) };
}

export function takeHint(s: GameState, playerId: string, ctx: Ctx) {
  const { r, pr } = currentProgress(s, playerId);
  if (r.mode === "emoji") throw new GameError("wrong_mode", "In Emoji Decode the host drops the hints.", 409);
  if (r.kind === "suddenDeath") throw new GameError("no_hints", "No hints in Sudden Death!", 409);
  if (pr.hintUsed) return r.hint;
  pr.hintUsed = true;
  addScore(s, playerId, -POINTS.hintPenalty, pr);
  bump(s);
  void ctx;
  return r.hint;
}

export function activatePowerup(s: GameState, playerId: string, type: PowerUp, targetId: string | null, ctx: Ctx) {
  const { r, pr } = currentProgress(s, playerId);
  if (r.kind === "suddenDeath") throw new GameError("no_powerups", "No power-ups in Sudden Death!", 409);
  if (pr.frozenUntil > ctx.now) throw new GameError("frozen", "You're frozen! ❄️", 409);
  const p = getPlayer(s, playerId);
  if (p.powerupsLeft <= 0) throw new GameError("no_powerups_left", "You've used both power-ups this game.", 409);

  if (type === "freeze") {
    if (!targetId || targetId === playerId) throw new GameError("bad_target", "Pick a rival to freeze.");
    const tp = r.progress[targetId];
    if (!tp || tp.status !== "playing") throw new GameError("bad_target", "That player isn't solving right now.", 409);
    if (tp.frozenOnce) throw new GameError("already_frozen", "That player was already frozen this round.", 409);
    tp.frozenOnce = true;
    tp.frozenUntil = ctx.now + FREEZE_MS;
  } else if (type === "reveal" && r.mode === "emoji") {
    // Privately reveal one letter of the answer (never the first letter once that hint is out).
    const letters = answerLetters(r.answer);
    const taken = new Set(pr.revealedPos ?? []);
    const options = letters.map((_, i) => i).filter((i) => !taken.has(i) && !(i === 0 && r.hostHints.length > 0));
    if (options.length === 0) throw new GameError("nothing_to_reveal", "Nothing left to reveal.", 409);
    pr.revealedPos = [...(pr.revealedPos ?? []), pick(options, ctx.random)];
  } else if (type === "extraLife" && r.mode === "emoji") {
    if (pr.lives >= EMOJI.maxAttempts) throw new GameError("max_lives", `You can't have more than ${EMOJI.maxAttempts} attempts!`, 409);
    pr.lives += 1;
  } else if (type === "reveal") {
    const known = knownLetters(r, pr);
    const hidden = [...letterSet(r.answer)].filter((l) => !known.has(l));
    if (hidden.length === 0) throw new GameError("nothing_to_reveal", "Nothing left to reveal.", 409);
    const l = pick(hidden.sort(), ctx.random);
    pr.revealed.push(l);
    if (isSolved(r.answer, knownLetters(r, pr))) markSolved(s, r, playerId, pr, ctx);
  } else if (type === "extraLife") {
    if (pr.lives >= 9) throw new GameError("max_lives", "You can't hold more balloons!", 409);
    pr.lives += 1;
  } else {
    throw new GameError("bad_powerup", "Unknown power-up.");
  }
  p.powerupsLeft -= 1;
  pr.powerupsUsed.push(type);
  bump(s);
  if (s.phase === "round") checkRoundComplete(s, ctx);
}

/** Emoji Decode: submit a typed answer. Up to 3 attempts (1 in Sudden Death). */
export function submitAnswer(s: GameState, playerId: string, raw: unknown, ctx: Ctx) {
  if (typeof raw !== "string") throw new GameError("bad_answer", "Type an answer.");
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text || text.length > 60) throw new GameError("bad_answer", "Type an answer (up to 60 characters).");
  const { r, pr } = currentProgress(s, playerId);
  if (r.mode !== "emoji") throw new GameError("wrong_mode", "This is a Hangman round — guess letters.", 409);
  if (pr.frozenUntil > ctx.now) throw new GameError("frozen", "Your answer box is frozen! ❄️", 409);
  const p = getPlayer(s, playerId);
  p.guessTimes = rateLimit(p.guessTimes, ctx.now, 5000, 5, 400);
  const norm = normalizeAnswer(text);
  if (!norm) throw new GameError("bad_answer", "Type an answer with letters or numbers.");
  if (pr.wrong.some((w) => normalizeAnswer(w) === norm)) throw new GameError("already_guessed", "You already tried that one.", 409);
  pr.guessed.push(text);
  const correct = isCorrectAnswer(text, r.answer, r.alternates);
  if (correct) {
    markSolved(s, r, playerId, pr, ctx);
  } else {
    pr.wrong.push(text);
    pr.lives -= 1;
    if (pr.lives <= 0) {
      pr.lives = 0;
      pr.status = "out";
    }
  }
  bump(s);
  if (s.phase === "round") checkRoundComplete(s, ctx);
  return { correct, attemptsLeft: pr.lives };
}

/** Emoji Decode: the host reveals the next hint to everyone (max 2). */
export function dropHint(s: GameState, ctx: Ctx) {
  assertPhase(s, "round");
  const r = s.round!;
  if (r.mode !== "emoji") throw new GameError("wrong_mode", "Hints can only be dropped in Emoji Decode rounds.", 409);
  if (r.hostHints.length >= MAX_HOST_HINTS) throw new GameError("no_more_hints", "Both hints are already out.", 409);
  r.hostHints.push(hostHintText(r.answer, r.hostHints.length));
  bump(s);
  void ctx;
}

export function checkRoundComplete(s: GameState, ctx: Ctx) {
  if (s.phase !== "round" || !s.round) return;
  const r = s.round;
  const stillPlaying = r.participants.some((id) => r.progress[id]?.status === "playing");
  if (!stillPlaying) endRound(s, ctx, "allDone");
}

export function endRound(s: GameState, ctx: Ctx, reason: NonNullable<Round["endReason"]>) {
  const r = s.round;
  if (!r || s.phase !== "round") return;
  if (r.pausedRemainingMs != null) r.pausedRemainingMs = null;
  s.paused = false;
  r.endedAt = ctx.now;
  r.endReason = reason;

  if (reason === "skipped") {
    for (const id of r.participants) {
      const pr = r.progress[id];
      const p = s.players.find((x) => x.id === id);
      if (!pr || !p) continue;
      p.score = Math.max(0, p.score - pr.points);
      pr.points = 0;
      p.powerupsLeft += pr.powerupsUsed.length;
    }
    if (r.kind === "suddenDeath") s.winnerId = null;
    s.phase = "reveal";
    bump(s);
    return;
  }

  if (r.kind !== "suddenDeath") {
    const failed = r.participants.filter((id) => r.progress[id] && r.progress[id].status !== "solved").length;
    r.stumpedCount = failed;
    if (r.source === "friend" && r.authorId && !getRemoved(s, r.authorId)) {
      r.authorBonus = addScore(s, r.authorId, POINTS.authorPerFail * failed * r.multiplier);
      const author = s.players.find((p) => p.id === r.authorId)!;
      author.stats.stumped += failed;
    }
  }

  for (const id of r.participants) {
    const pr = r.progress[id];
    const p = s.players.find((x) => x.id === id);
    if (!pr || !p) continue;
    if (pr.hintUsed) p.stats.hints += 1;
    p.stats.livesLost += pr.wrong.length;
    if (pr.status === "solved" && r.mode === "emoji" && r.kind !== "suddenDeath") p.stats.emojiSolves += 1;
    if (pr.status === "solved" && pr.solveMs != null) {
      p.stats.solves += 1;
      p.stats.bestSolveMs = p.stats.bestSolveMs == null ? pr.solveMs : Math.min(p.stats.bestSolveMs, pr.solveMs);
    }
  }

  if (r.kind !== "suddenDeath") {
    const active = activePlayers(s);
    const ranks = rankMap(active.map((p) => ({ id: p.id, score: p.score })));
    const results: Record<string, import("./types").RoundRecordEntry> = {};
    for (const p of active) {
      const rank = ranks.get(p.id)!;
      p.stats.worstRank = p.stats.worstRank == null ? rank : Math.max(p.stats.worstRank, rank);
      const pr = r.progress[p.id];
      results[p.id] = {
        points: pr ? pr.points : p.id === r.authorId ? r.authorBonus : 0,
        solved: pr?.status === "solved",
        solveMs: pr?.solveMs ?? null,
        wrong: pr?.wrong.length ?? 0,
        hint: pr?.hintUsed ?? false,
        rankAfter: rank,
        satOut: !pr,
      };
    }
    s.history.push({
      mode: r.mode,
      number: r.number,
      kind: r.kind,
      answer: r.answer,
      category: r.category,
      source: r.source,
      authorId: r.authorId,
      results,
    });
  }

  s.phase = "reveal";
  bump(s);
}

export function skipWord(s: GameState, ctx: Ctx) {
  assertPhase(s, "round");
  endRound(s, ctx, "skipped");
}

export function pause(s: GameState, ctx: Ctx) {
  assertPhase(s, "round");
  if (s.paused) return;
  const r = s.round!;
  r.pausedRemainingMs = Math.max(0, r.deadline - ctx.now);
  s.paused = true;
  bump(s);
}

export function resume(s: GameState, ctx: Ctx) {
  assertPhase(s, "round");
  if (!s.paused) return;
  const r = s.round!;
  const rem = r.pausedRemainingMs ?? 0;
  const pausedFor = ctx.now - (r.deadline - rem);
  r.deadline = ctx.now + rem;
  r.pausedRemainingMs = null;
  // Freezes don't tick down while paused.
  for (const pr of Object.values(r.progress)) if (pr.frozenUntil > ctx.now - pausedFor) pr.frozenUntil += pausedFor;
  s.paused = false;
  bump(s);
}

/** Advance time-based transitions. Returns true if state changed. */
export function tick(s: GameState, ctx: Ctx): boolean {
  const before = s.seq;
  if (s.phase === "round" && s.round && !s.paused && ctx.now >= s.round.deadline) {
    endRound(s, ctx, "timer");
  } else if (s.phase === "loserPick" && s.loserPick && ctx.now >= s.loserPick.deadline) {
    resolveLoserPick(s, null, ctx);
  } else if (s.phase === "dare" && s.dare && s.dare.status === "waiting" && ctx.now >= s.dare.autoSpinAt) {
    doSpin(s, ctx);
  }
  return s.seq !== before;
}

/** Host "Next" button. */
export function next(s: GameState, ctx: Ctx) {
  switch (s.phase) {
    case "lobby":
      return startGame(s, ctx);
    case "round":
      throw new GameError("round_running", "The round is still running. Use Skip to end it early.", 409);
    case "loserPick":
      return resolveLoserPick(s, null, ctx);
    case "dare":
      return proceedToNextRound(s, ctx);
    case "ended":
      throw new GameError("game_ended", "The game is over. Tap Play Again for a rematch.", 409);
    case "reveal": {
      const r = s.round!;
      if (r.kind === "suddenDeath") {
        if (s.winnerId) return finishGame(s, ctx);
        s.suddenDeath!.attempt += 1;
        return startSuddenDeath(s, ctx);
      }
      if (s.roundsPlayed >= s.settings.rounds) {
        const active = activePlayers(s);
        if (active.length === 0) return finishGame(s, ctx);
        const top = Math.max(...active.map((p) => p.score));
        const tied = active.filter((p) => p.score === top);
        if (tied.length > 1) {
          s.suddenDeath = { playerIds: tied.map((p) => p.id), attempt: 1 };
          return startSuddenDeath(s, ctx);
        }
        s.winnerId = tied[0].id;
        return finishGame(s, ctx);
      }
      if (
        s.settings.dareWheel &&
        s.roundsPlayed % s.settings.dareEvery === 0 &&
        s.lastDareRound !== s.roundsPlayed &&
        activePlayers(s).length > 0
      ) {
        return startDare(s, ctx);
      }
      return proceedToNextRound(s, ctx);
    }
  }
}

function proceedToNextRound(s: GameState, ctx: Ctx) {
  const n = s.roundsPlayed + 1;
  const r = s.round;
  const mode = roundModeFor(s, n);
  const options = availableCategories(s, mode);
  if (!friendWordAvailable(s, n, mode) && options.length >= 2 && r && r.kind !== "suddenDeath" && r.endReason !== "skipped") {
    const candidates = r.participants
      .filter((id) => !getRemoved(s, id) && r.progress[id])
      .map((id) => ({ id, pts: r.progress[id].points }));
    if (candidates.length) {
      const low = Math.min(...candidates.map((c) => c.pts));
      const losers = candidates.filter((c) => c.pts === low);
      const loser = pick(losers, ctx.random);
      s.loserPick = { playerId: loser.id, options, deadline: ctx.now + LOSER_PICK_MS };
      s.phase = "loserPick";
      s.dare = null;
      bump(s);
      return;
    }
  }
  startRound(s, ctx);
}

export function resolveLoserPick(s: GameState, category: CategoryId | null, ctx: Ctx) {
  assertPhase(s, "loserPick");
  const lp = s.loserPick!;
  const cat = category ?? pick(lp.options, ctx.random);
  startRound(s, ctx, cat);
}

export function pickCategory(s: GameState, playerId: string, category: unknown, ctx: Ctx) {
  assertPhase(s, "loserPick");
  const lp = s.loserPick!;
  if (lp.playerId !== playerId) throw new GameError("not_picker", "It's not your pick.", 403);
  if (!lp.options.includes(category as CategoryId)) throw new GameError("bad_category", "Pick one of the listed categories.");
  resolveLoserPick(s, category as CategoryId, ctx);
}

// ---------------------------------------------------------------------------
// dare wheel
// ---------------------------------------------------------------------------
function startDare(s: GameState, ctx: Ctx) {
  const active = activePlayers(s);
  const low = Math.min(...active.map((p) => p.score));
  const target = pick(active.filter((p) => p.score === low), ctx.random);
  const custom = s.customDares.map((d) => d.text).filter((t) => !isBlocked(t, s.settings.content));
  const all = [...startersFor(s.settings.content), ...custom];
  const fresh = all.filter((d) => !s.usedDares.includes(d));
  const pool = fresh.length >= 4 ? fresh : all;
  const options = shuffle(pool, ctx.random).slice(0, 8);
  s.dare = {
    playerId: target.id,
    options,
    resultIndex: null,
    spinId: 0,
    status: "waiting",
    autoSpinAt: ctx.now + DARE_AUTOSPIN_MS,
    afterRound: s.roundsPlayed,
  };
  s.lastDareRound = s.roundsPlayed;
  s.phase = "dare";
  bump(s);
}

function doSpin(s: GameState, ctx: Ctx) {
  const d = s.dare!;
  let idx = Math.floor(ctx.random() * d.options.length);
  if (d.resultIndex != null && d.options.length > 1 && idx === d.resultIndex) idx = (idx + 1) % d.options.length;
  d.resultIndex = idx;
  d.status = "spun";
  d.spinId += 1;
  s.usedDares.push(d.options[idx]);
  bump(s);
}

export function spinDare(s: GameState, playerId: string, ctx: Ctx) {
  assertPhase(s, "dare");
  const d = s.dare!;
  if (d.playerId !== playerId) throw new GameError("not_spinner", "It's not your spin.", 403);
  if (d.status !== "waiting") throw new GameError("already_spun", "The wheel already spun.", 409);
  doSpin(s, ctx);
}

export function passDare(s: GameState, playerId: string) {
  assertPhase(s, "dare");
  const d = s.dare!;
  if (d.playerId !== playerId) throw new GameError("not_spinner", "It's not your dare.", 403);
  d.status = "passed";
  bump(s);
}

export function respinDare(s: GameState, ctx: Ctx) {
  assertPhase(s, "dare");
  doSpin(s, ctx);
}

// ---------------------------------------------------------------------------
// end / replay / reactions
// ---------------------------------------------------------------------------
export function finishGame(s: GameState, ctx: Ctx) {
  if (!s.winnerId) {
    const active = activePlayers(s);
    if (active.length) {
      const top = Math.max(...active.map((p) => p.score));
      const tied = active.filter((p) => p.score === top);
      if (tied.length === 1) s.winnerId = tied[0].id;
    }
  }
  s.phase = "ended";
  s.paused = false;
  s.loserPick = null;
  s.dare = null;
  s.endedAt = ctx.now;
  bump(s);
}

export function endGame(s: GameState, ctx: Ctx) {
  if (s.phase === "ended") return;
  if (s.phase === "round") endRound(s, ctx, "ended");
  finishGame(s, ctx);
}

export function playAgain(s: GameState, ctx: Ctx) {
  assertPhase(s, "ended");
  for (const p of s.players) {
    p.score = 0;
    p.powerupsLeft = POWERUPS_PER_GAME;
    p.stats = { hints: 0, emojiSolves: 0, livesLost: 0, bestSolveMs: null, solves: 0, worstRank: null, stumped: 0 };
  }
  s.submissions = s.submissions.filter((x) => x.status === "pending");
  s.phase = "lobby";
  s.paused = false;
  s.round = null;
  s.roundsPlayed = 0;
  s.friendRoundPlan = [];
  s.history = [];
  s.suddenDeath = null;
  s.winnerId = null;
  s.loserPick = null;
  s.dare = null;
  s.lastDareRound = 0;
  s.nextCategory = null;
  s.endedAt = null;
  s.gameNumber += 1;
  void ctx;
  bump(s);
}

export function react(s: GameState, playerId: string, emoji: unknown, ctx: Ctx) {
  if (!REACTION_EMOJIS.includes(emoji as (typeof REACTION_EMOJIS)[number]))
    throw new GameError("bad_emoji", "Unknown reaction.");
  const p = getPlayer(s, playerId);
  p.reactionTimes = rateLimit(p.reactionTimes, ctx.now, 10_000, 8, 600);
  s.reactionSeq += 1;
  s.reactions.push({ id: s.reactionSeq, emoji: emoji as string, playerId, at: ctx.now });
  if (s.reactions.length > 30) s.reactions = s.reactions.slice(-30);
  bump(s);
}
