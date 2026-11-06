// Pure, deterministic game engine. Every function mutates the given state in
// place (callers clone/persist) and takes a Ctx for time + randomness so the
// whole game can be unit-tested and replayed.
import { WORD_BANK } from "@/data/words";
import { CLUE_BANK } from "@/data/clues";
import { QUESTION_BANK, questionText } from "@/data/questions";
import { PROMPT_BANK } from "@/data/prompts";
import { BLITZ_BANK } from "@/data/blitz";
import { matchBlitzAnswer, startsWithLetter } from "./blitzMatch";
import { startersFor } from "@/data/dares";
import { isBlocked, validateWwiAnswer } from "@/lib/moderation";
import { REACTION_EMOJIS } from "@/data/categories";
export { REACTION_EMOJIS };
import { answerLetters, clueKey, hostHintText, isCorrectAnswer, MAX_HOST_HINTS, normalizeAnswer } from "./answers";
import {
  applyDelta,
  DARE_AUTOSPIN_MS,
  EMOJI,
  emojiPoints,
  MLT,
  WWI,
  BLITZ,
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
  type BuiltInPackId,
  type BuiltInWwiPackId,
  type BuiltInBlitzCategoryId,
  type BlitzCategoryId,
  BLITZ_CATEGORY_IDS,
  BLITZ_TIMER_OPTIONS,
  ANSWERS_SHOWN_OPTIONS,
  GUESS_TIMER_OPTIONS,
  WRITE_TIMER_OPTIONS,
  WWI_PACK_IDS,
  type WwiPackId,
  PACK_IDS,
  type PackId,
  ROUND_MODES,
  VOTE_TIMER_OPTIONS,
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
  type WwiResult,
  type BlitzRound,
  type BlitzPromptEntry,
  type WwiRound,
  type WordSource,
} from "./types";

export const BUILTIN_CATEGORIES: BuiltInCategoryId[] = ["tv", "genz", "movies", "music", "memes", "food", "college", "mixed"];

export const BUILTIN_PACKS: BuiltInPackId[] = ["college", "friends", "chaos", "future", "habits"];
export const BUILTIN_WWI_PACKS: BuiltInWwiPackId[] = ["hypotheticals", "college", "friends", "chaos", "habits"];
export const BUILTIN_BLITZ_CATEGORIES: BuiltInBlitzCategoryId[] = ["tv", "movies", "music", "food", "memes", "college", "places", "animals"];
export const DEFAULT_MIXED_MODES: RoundMode[] = ["hangman", "emoji"];
export const MLT_SUDDEN_DEATH_QUESTION = "Who deserves the crown tonight?";

export const DEFAULT_SETTINGS: Settings = {
  mode: "hangman",
  mixedModes: [...DEFAULT_MIXED_MODES],
  voteSec: 20,
  packs: [...BUILTIN_PACKS],
  writeSec: 45,
  guessSec: 15,
  answersShown: 3,
  wwiPacks: [...BUILTIN_WWI_PACKS],
  blitzSec: 30,
  blitzCategories: [...BUILTIN_BLITZ_CATEGORIES],
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

function mixedList(s: GameState): RoundMode[] {
  const list = (s.settings.mixedModes ?? DEFAULT_MIXED_MODES).filter((m) => ROUND_MODES.includes(m));
  return list.length >= 2 ? list : [...DEFAULT_MIXED_MODES];
}

/** True if the game's rounds can include Most Likely To. */
export function includesMlt(s: GameState): boolean {
  return s.settings.mode === "mlt" || (s.settings.mode === "mixed" && mixedList(s).includes("mlt"));
}

/** True if the game's rounds can include Who Wrote It?. */
export function includesWwi(s: GameState): boolean {
  return s.settings.mode === "wwi" || (s.settings.mode === "mixed" && mixedList(s).includes("wwi"));
}

/** True if the game's rounds can include Category Blitz. */
export function includesBlitz(s: GameState): boolean {
  return s.settings.mode === "blitz" || (s.settings.mode === "mixed" && mixedList(s).includes("blitz"));
}

/** Players a round of this mode needs (Most Likely To 3, Who Wrote It? 4). */
export function minPlayersFor(mode: RoundMode): number {
  return mode === "mlt" ? MLT.minPlayers : mode === "wwi" ? WWI.minPlayers : 1;
}

/**
 * Which kind of round number `n` is. Mixed rotates through the chosen modes in
 * order (default Hangman, Emoji Decode — the original Mixed). Most Likely To
 * (3+) and Who Wrote It? (4+) rounds are skipped in Mixed when too few players
 * are active.
 */
export function roundModeFor(s: GameState, n: number): RoundMode {
  const mode = s.settings.mode ?? "hangman";
  if (mode !== "mixed") return mode;
  const list = mixedList(s);
  const m = list[(n - 1) % list.length];
  const count = activePlayers(s).length;
  if (count < minPlayersFor(m)) {
    for (let k = 1; k < list.length; k++) {
      const alt = list[(n - 1 + k) % list.length];
      if (count >= minPlayersFor(alt)) return alt;
    }
    return "hangman";
  }
  return m;
}

/**
 * Sudden Death: games with word rounds keep Hangman (or Emoji Decode when that's
 * the only word mode). Games without word rounds (Most Likely To and/or Who
 * Wrote It?) have the other players vote on the tied players.
 */
export function suddenDeathMode(s: GameState): RoundMode {
  if (s.settings.mode === "emoji") return "emoji";
  if (s.settings.mode === "mlt" || s.settings.mode === "wwi") return "mlt";
  if (s.settings.mode === "blitz") return "blitz";
  if (s.settings.mode === "mixed") {
    const list = mixedList(s);
    if (list.includes("hangman")) return "hangman";
    if (list.includes("emoji")) return "emoji";
    if (list.includes("blitz")) return "blitz";
    return "mlt";
  }
  return "hangman";
}

/**
 * Fill in fields added after a room was saved (e.g. rooms created before Emoji
 * Decode existed). Purely additive: existing data is never changed.
 */
export function upgradeState(s: GameState): GameState {
  const any = s as unknown as Record<string, unknown>;
  if (!(s.settings as Partial<Settings>).mode) s.settings.mode = "hangman";
  if (!Array.isArray((s.settings as Partial<Settings>).mixedModes)) s.settings.mixedModes = [...DEFAULT_MIXED_MODES];
  if (!(s.settings as Partial<Settings>).voteSec) s.settings.voteSec = 20;
  if (!Array.isArray((s.settings as Partial<Settings>).packs)) s.settings.packs = [...BUILTIN_PACKS];
  if (!(s.settings as Partial<Settings>).writeSec) s.settings.writeSec = 45;
  if (!(s.settings as Partial<Settings>).guessSec) s.settings.guessSec = 15;
  if (!(s.settings as Partial<Settings>).answersShown) s.settings.answersShown = 3;
  if (!Array.isArray((s.settings as Partial<Settings>).wwiPacks)) s.settings.wwiPacks = [...BUILTIN_WWI_PACKS];
  if (!Array.isArray(any.customPrompts)) s.customPrompts = [];
  if (!Array.isArray(any.promptSubs)) s.promptSubs = [];
  if (!Array.isArray(any.usedPrompts)) s.usedPrompts = [];
  if (!Array.isArray(any.wwiRoundPlan)) s.wwiRoundPlan = [];
  if (!any.wwiShownCount || typeof any.wwiShownCount !== "object") s.wwiShownCount = {};
  if (!Array.isArray(any.wwiWriters)) s.wwiWriters = [];
  if (any.holdMin === undefined) s.holdMin = null;
  if (!(s.settings as Partial<Settings>).blitzSec) s.settings.blitzSec = 30;
  if (!Array.isArray((s.settings as Partial<Settings>).blitzCategories)) s.settings.blitzCategories = [...BUILTIN_BLITZ_CATEGORIES];
  if (!Array.isArray(any.customBlitz)) s.customBlitz = [];
  if (!Array.isArray(any.usedBlitz)) s.usedBlitz = [];
  if (!Array.isArray(any.customQuestions)) s.customQuestions = [];
  if (!Array.isArray(any.questionSubs)) s.questionSubs = [];
  if (!Array.isArray(any.usedQuestions)) s.usedQuestions = [];
  if (!Array.isArray(any.questionRoundPlan)) s.questionRoundPlan = [];
  if (any.hold === undefined) s.hold = null;
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
    settings: {
      ...DEFAULT_SETTINGS,
      mixedModes: [...DEFAULT_SETTINGS.mixedModes],
      packs: [...DEFAULT_SETTINGS.packs],
      wwiPacks: [...DEFAULT_SETTINGS.wwiPacks],
      blitzCategories: [...DEFAULT_SETTINGS.blitzCategories],
      categories: [...DEFAULT_SETTINGS.categories],
      ...opts.settings,
    },
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
    customQuestions: [],
    questionSubs: [],
    usedQuestions: [],
    questionRoundPlan: [],
    hold: null,
    holdMin: null,
    customPrompts: [],
    promptSubs: [],
    usedPrompts: [],
    wwiRoundPlan: [],
    wwiShownCount: {},
    wwiWriters: [],
    customBlitz: [],
    usedBlitz: [],
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
    if (!GAME_MODES.includes(patch.mode as GameMode))
      throw new GameError("bad_settings", "Game mode must be Hangman, Emoji Decode, Most Likely To, Who Wrote It?, Category Blitz or Mixed.");
    next.mode = patch.mode;
  }
  if (patch.mixedModes !== undefined) {
    if (!Array.isArray(patch.mixedModes)) throw new GameError("bad_settings", "Pick the modes Mixed should include.");
    const list = ROUND_MODES.filter((m) => (patch.mixedModes as string[]).includes(m)); // canonical order, no duplicates
    if (list.length < 2) throw new GameError("bad_settings", "Mixed needs at least two game modes.");
    next.mixedModes = list;
  }
  if (patch.voteSec !== undefined) {
    if (!VOTE_TIMER_OPTIONS.includes(patch.voteSec)) throw new GameError("bad_settings", "Voting timer must be 15, 20 or 30 seconds.");
    next.voteSec = patch.voteSec;
  }
  if (patch.packs !== undefined) {
    if (!Array.isArray(patch.packs)) throw new GameError("bad_settings", "Pick at least one question pack.");
    const packs = [...new Set(patch.packs)].filter((p): p is PackId => PACK_IDS.includes(p as PackId));
    if (packs.length === 0) throw new GameError("bad_settings", "Pick at least one question pack.");
    next.packs = packs;
  }
  if (patch.writeSec !== undefined) {
    if (!WRITE_TIMER_OPTIONS.includes(patch.writeSec)) throw new GameError("bad_settings", "Writing timer must be 30, 45 or 60 seconds.");
    next.writeSec = patch.writeSec;
  }
  if (patch.guessSec !== undefined) {
    if (!GUESS_TIMER_OPTIONS.includes(patch.guessSec)) throw new GameError("bad_settings", "Guessing timer must be 10, 15 or 20 seconds.");
    next.guessSec = patch.guessSec;
  }
  if (patch.answersShown !== undefined) {
    if (!ANSWERS_SHOWN_OPTIONS.includes(patch.answersShown)) throw new GameError("bad_settings", "Answers shown per round must be 1, 3 or 5.");
    next.answersShown = patch.answersShown;
  }
  if (patch.wwiPacks !== undefined) {
    if (!Array.isArray(patch.wwiPacks)) throw new GameError("bad_settings", "Pick at least one Who Wrote It? question pack.");
    const packs = [...new Set(patch.wwiPacks)].filter((p): p is WwiPackId => WWI_PACK_IDS.includes(p as WwiPackId));
    if (packs.length === 0) throw new GameError("bad_settings", "Pick at least one Who Wrote It? question pack.");
    next.wwiPacks = packs;
  }
  if (patch.blitzSec !== undefined) {
    if (!BLITZ_TIMER_OPTIONS.includes(patch.blitzSec)) throw new GameError("bad_settings", "Category Blitz timer must be 30, 45 or 60 seconds.");
    next.blitzSec = patch.blitzSec;
  }
  if (patch.blitzCategories !== undefined) {
    if (!Array.isArray(patch.blitzCategories)) throw new GameError("bad_settings", "Pick at least one Category Blitz category.");
    const cats = [...new Set(patch.blitzCategories)].filter((c): c is BlitzCategoryId => BLITZ_CATEGORY_IDS.includes(c as BlitzCategoryId));
    if (cats.length === 0) throw new GameError("bad_settings", "Pick at least one Category Blitz category.");
    next.blitzCategories = cats;
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
    stats: { hints: 0, emojiSolves: 0, crowns: 0, correctVotes: 0, livesLost: 0, bestSolveMs: null, solves: 0, worstRank: null, stumped: 0 },
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
  for (const q of s.questionSubs) if (q.playerId === playerId && q.status === "pending") q.status = "removed";
  for (const q of s.promptSubs) if (q.playerId === playerId && q.status === "pending") q.status = "removed";
  if (s.phase === "round" && s.round) {
    const r = s.round;
    r.participants = r.participants.filter((id) => id !== playerId);
    delete r.progress[playerId];
    if (r.mode === "mlt") {
      // Their own vote no longer counts, they stop being an option, and anyone who
      // voted for them gets their vote back so they can vote again while time remains.
      const votes = r.votes ?? {};
      delete votes[playerId];
      r.candidates = (r.candidates ?? []).filter((id) => id !== playerId);
      for (const [voter, v] of Object.entries(votes)) {
        if (v.targetId !== playerId) continue;
        delete votes[voter];
        const vp = r.progress[voter];
        if (vp && vp.status === "voted") {
          vp.status = "playing";
          vp.solvedAt = null;
          vp.voteReset = true;
        }
      }
      if (r.kind === "suddenDeath" && r.candidates.length === 1) {
        r.sdWinnerId = r.candidates[0];
        s.winnerId = r.candidates[0];
        r.crowned = [r.candidates[0]];
        endRound(s, ctx, "sdWinner");
      }
    }
    if (r.mode === "wwi" && r.wwi) wwiDropPlayer(s, r.wwi, playerId, ctx);
    if (r.mode === "blitz" && r.blitz) delete r.blitz.subs[playerId]; // their answers no longer affect anyone's uniqueness
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

export function questionKey(text: string): string {
  return text.toLowerCase().replace(/^who is most likely to /, "").replace(/[^a-z0-9]/g, "");
}

/** Host-written Most Likely To question (the "Host's Questions" pack). */
export function addCustomQuestion(s: GameState, text: string, ctx: Ctx) {
  if (s.customQuestions.length >= 100) throw new GameError("too_many", "Custom questions are full (100 max).");
  if (s.customQuestions.some((q) => questionKey(q.text) === questionKey(text)))
    throw new GameError("duplicate", "That question is already on the list.");
  s.customQuestions.push({ id: ctx.id(), text });
  if (!s.settings.packs.includes("custom")) s.settings.packs = [...s.settings.packs, "custom"];
  bump(s);
}

export function removeCustomQuestion(s: GameState, id: string) {
  s.customQuestions = s.customQuestions.filter((q) => q.id !== id);
  if (s.customQuestions.length === 0 && s.settings.packs.includes("custom")) {
    const packs = s.settings.packs.filter((p) => p !== "custom");
    s.settings.packs = packs.length ? packs : [...BUILTIN_PACKS];
  }
  bump(s);
}

/** A player's friend-written question (one each; never shown with their name). */
export function submitQuestion(s: GameState, playerId: string, text: string, ctx: Ctx) {
  assertPhase(s, "lobby");
  if (!s.settings.friendWords) throw new GameError("friend_words_off", "Friend-written rounds are turned off.", 409);
  if (!includesMlt(s)) throw new GameError("wrong_mode", "Questions are only used in Most Likely To rounds.", 409);
  getPlayer(s, playerId);
  const existing = s.questionSubs.find((q) => q.playerId === playerId && q.status === "pending");
  if (existing) existing.text = text;
  else {
    if (s.questionSubs.some((q) => q.playerId === playerId && q.status === "removed"))
      throw new GameError("submission_removed", "The host removed your question. You can't submit another this game.", 409);
    s.questionSubs.push({ id: ctx.id(), playerId, text, status: "pending" });
  }
  bump(s);
}

export function removeQuestionSub(s: GameState, id: string) {
  assertPhase(s, "lobby");
  const q = s.questionSubs.find((x) => x.id === id);
  if (!q) throw new GameError("not_found", "Question not found.", 404);
  q.status = "removed";
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

function questionPool(s: GameState, pack: PackId): { text: string }[] {
  const used = new Set(s.usedQuestions);
  if (pack === "custom")
    return s.customQuestions.filter((q) => !used.has(questionKey(q.text)) && !isBlocked(q.text, s.settings.content));
  return QUESTION_BANK[pack]
    .filter((e) => (s.settings.content === "pg13" || e.content === "clean") && !used.has(questionKey(questionText(e))))
    .map((e) => ({ text: questionText(e) }));
}

/** Question packs that still have unused questions. */
export function availablePacks(s: GameState): PackId[] {
  return (s.settings.packs ?? BUILTIN_PACKS).filter((p) => questionPool(s, p).length > 0);
}

/** Loser Picks options for a round of this mode. */
export function availableChoices(s: GameState, mode: RoundMode): (CategoryId | PackId | WwiPackId | BlitzCategoryId)[] {
  if (mode === "blitz") return availableBlitzCategories(s);
  return mode === "mlt" ? availablePacks(s) : mode === "wwi" ? availableWwiPacks(s) : availableCategories(s, mode);
}

export function chooseQuestion(s: GameState, pack: PackId, ctx: Ctx): { text: string; pack: PackId } {
  const pool = questionPool(s, pack);
  if (pool.length) return { text: pick(pool, ctx.random).text, pack };
  const others = availablePacks(s).filter((p) => p !== pack);
  if (others.length) return chooseQuestion(s, pick(others, ctx.random), ctx);
  const anyBuiltin = BUILTIN_PACKS.filter((p) => questionPool(s, p).length > 0);
  if (anyBuiltin.length) return chooseQuestion(s, pick(anyBuiltin, ctx.random), ctx);
  s.usedQuestions = [];
  return chooseQuestion(s, pack === "custom" ? "friends" : pack, ctx);
}

function friendQuestionAvailable(s: GameState, roundNumber: number) {
  if (!s.settings.friendWords || !s.questionRoundPlan.includes(roundNumber)) return null;
  const pending = s.questionSubs.filter((q) => q.status === "pending" && !getRemoved(s, q.playerId) && !isBlocked(q.text, s.settings.content));
  return pending.length ? pending : null;
}

function friendWordAvailable(s: GameState, roundNumber: number, mode: RoundMode = roundModeFor(s, roundNumber)) {
  if (mode === "mlt" || mode === "wwi") return null; // question modes use friend-written questions instead
  if (mode === "blitz") return null; // friend-written submissions don't apply to Category Blitz
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
  if (s.settings.mode === "mlt" && activePlayers(s).length < MLT.minPlayers)
    throw new GameError("need_players", "Most Likely To needs at least 3 players. Wait for more friends to join.", 409);
  if (s.settings.mode === "wwi" && activePlayers(s).length < WWI.minPlayers)
    throw new GameError("need_players", "Who Wrote It? needs at least 4 players. Wait for more friends to join.", 409);
  s.hold = null;
  s.holdMin = null;
  s.questionRoundPlan = [];
  s.wwiRoundPlan = [];
  s.wwiShownCount = {};
  // Everyone here at the start can appear as a "who wrote it" choice; late joiners only after writing an answer.
  s.wwiWriters = activePlayers(s).map((p) => p.id);
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
    // About a third of the Most Likely To rounds use a player-submitted question.
    const mltRounds = rounds.filter((n) => roundModeFor(s, n) === "mlt");
    const pendingQs = s.questionSubs.filter((q) => q.status === "pending" && !getRemoved(s, q.playerId));
    const qCount = Math.min(pendingQs.length, Math.round(mltRounds.length / 3));
    s.questionRoundPlan = shuffle(mltRounds, ctx.random).slice(0, qCount).sort((a, b) => a - b);
    // Same for Who Wrote It? rounds.
    const wwiRounds = rounds.filter((n) => roundModeFor(s, n) === "wwi");
    if (wwiRounds.length) {
      const pendingPs = s.promptSubs.filter((q) => q.status === "pending" && !getRemoved(s, q.playerId));
      const pCount = Math.min(pendingPs.length, Math.round(wwiRounds.length / 3));
      s.wwiRoundPlan = shuffle(wwiRounds, ctx.random).slice(0, pCount).sort((a, b) => a - b);
    }
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

export function startRound(s: GameState, ctx: Ctx, choice?: CategoryId | PackId | WwiPackId | BlitzCategoryId | null) {
  const n = s.roundsPlayed + 1;
  const kind = n >= s.settings.rounds ? "final" : "normal";
  const mode = roundModeFor(s, n);
  const active = activePlayers(s);
  if (mode === "mlt") return startMltRound(s, ctx, n, kind, (choice as PackId | null | undefined) ?? (s.nextCategory as PackId | null));
  if (mode === "wwi") return startWwiRound(s, ctx, n, kind, (choice as WwiPackId | null | undefined) ?? (s.nextCategory as WwiPackId | null));
  if (mode === "blitz") return startBlitzRound(s, ctx, n, kind, (choice as BlitzCategoryId | null | undefined) ?? (s.nextCategory as BlitzCategoryId | null));
  const category = choice as CategoryId | null | undefined;

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
    const validChoice = (c: unknown): c is CategoryId => typeof c === "string" && (s.settings.categories as string[]).includes(c);
    const want =
      (validChoice(category) ? category : null) ??
      (validChoice(s.nextCategory) ? s.nextCategory : null) ??
      (available.length ? pick(available, ctx.random) : pick(s.settings.categories, ctx.random));
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
  s.hold = null;
  bump(s);
}

/** Most Likely To round. Everyone active votes, and everyone active is an option. */
function startMltRound(s: GameState, ctx: Ctx, n: number, kind: "normal" | "final", pack: PackId | null) {
  const active = activePlayers(s);
  if (active.length < MLT.minPlayers) {
    // Most Likely To-only game: hold and tell the host (Mixed skips these rounds instead).
    s.hold = "needPlayers";
    s.holdMin = MLT.minPlayers;
    if (s.phase === "loserPick" || s.phase === "dare") s.phase = "reveal";
    s.loserPick = null;
    s.dare = null;
    bump(s);
    return;
  }
  let question: string;
  let category: PackId | "friend";
  let source: WordSource = "builtin";
  const friendQs = friendQuestionAvailable(s, n);
  if (friendQs) {
    const sub = pick(friendQs, ctx.random);
    sub.status = "used";
    question = sub.text;
    category = "friend";
    source = "friend";
  } else {
    const packs = availablePacks(s);
    const want = pack && (s.settings.packs as string[]).includes(pack) ? pack : packs.length ? pick(packs, ctx.random) : pick(s.settings.packs, ctx.random);
    const q = chooseQuestion(s, want, ctx);
    question = q.text;
    category = q.pack;
    source = q.pack === "custom" ? "inside" : "builtin";
  }
  s.usedQuestions.push(questionKey(question));
  const ids = active.map((p) => p.id);
  const durationMs = (s.settings.voteSec ?? 20) * 1000;
  const progress: Record<string, PlayerProgress> = {};
  for (const id of ids) progress[id] = newProgress(0);
  s.roundsPlayed = n;
  s.round = {
    id: ctx.id(),
    mode: "mlt",
    number: n,
    kind,
    sdAttempt: 0,
    category,
    answer: "",
    hint: "",
    clue: null,
    alternates: [],
    hostHints: [],
    question,
    candidates: [...ids],
    votes: {},
    totals: null,
    crowned: [],
    source,
    authorId: null, // friend-written questions stay anonymous and earn no author points
    startedAt: ctx.now,
    durationMs,
    deadline: ctx.now + durationMs,
    pausedRemainingMs: null,
    participants: ids,
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
  s.hold = null;
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
  if (mode === "mlt") return startMltSuddenDeath(s, ctx);
  if (mode === "blitz") return startBlitzSuddenDeath(s, ctx);
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

/** Most Likely To-only tiebreak: the non-tied players vote on the tied players. */
function startMltSuddenDeath(s: GameState, ctx: Ctx) {
  const sd = s.suddenDeath!;
  const tied = sd.playerIds;
  const voters = activePlayers(s)
    .map((p) => p.id)
    .filter((id) => !tied.includes(id));
  if (voters.length === 0) {
    // Nobody left to vote: pick the winner at random.
    s.winnerId = pick(tied, ctx.random);
    finishGame(s, ctx);
    return;
  }
  const durationMs = (s.settings.voteSec ?? 20) * 1000;
  const progress: Record<string, PlayerProgress> = {};
  for (const id of voters) progress[id] = newProgress(0);
  s.round = {
    id: ctx.id(),
    mode: "mlt",
    number: s.roundsPlayed,
    kind: "suddenDeath",
    sdAttempt: sd.attempt,
    category: "friends",
    answer: "",
    hint: "",
    clue: null,
    alternates: [],
    hostHints: [],
    question: MLT_SUDDEN_DEATH_QUESTION,
    candidates: [...tied],
    votes: {},
    totals: null,
    crowned: [],
    source: "builtin",
    authorId: null,
    startedAt: ctx.now,
    durationMs,
    deadline: ctx.now + durationMs,
    pausedRemainingMs: null,
    participants: voters,
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
  if (pr.status === "voted") throw new GameError("vote_locked", "Your vote is locked.", 409);
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
  if (r.mode === "mlt") throw new GameError("wrong_mode", "This is a Most Likely To round — vote for a player.", 409);
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
  if (r.mode === "mlt") throw new GameError("wrong_mode", "There are no hints in Most Likely To.", 409);
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

  if (r.mode === "mlt") {
    mltPowerup(s, r, pr, playerId, type, targetId, ctx);
  } else if (r.mode === "blitz") {
    blitzPowerup(s, r, playerId, type, targetId, ctx);
  } else if (r.mode === "wwi") {
    wwiPowerup(s, r, playerId, type, targetId, ctx);
  } else if (type === "freeze") {
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

/** Current vote leaders (weighted), for the Peek power-up. Never exposes who voted for whom. */
function currentLeaders(r: Round): { leaderIds: string[]; votes: number } {
  const totals: Record<string, number> = {};
  for (const v of Object.values(r.votes ?? {})) totals[v.targetId] = (totals[v.targetId] ?? 0) + v.weight;
  const max = Math.max(0, ...Object.values(totals));
  return { leaderIds: max > 0 ? Object.keys(totals).filter((id) => totals[id] === max) : [], votes: max };
}

/** Most Likely To power-ups: Freeze a rival's voting screen, Peek at the leader, Double Vote. */
function mltPowerup(s: GameState, r: Round, pr: PlayerProgress, playerId: string, type: PowerUp, targetId: string | null, ctx: Ctx) {
  if (type === "freeze") {
    if (!targetId || targetId === playerId) throw new GameError("bad_target", "Pick a rival to freeze.");
    const tp = r.progress[targetId];
    if (!tp || tp.status !== "playing") throw new GameError("bad_target", "That player has already voted.", 409);
    if (tp.frozenOnce) throw new GameError("already_frozen", "That player was already frozen this round.", 409);
    if (remainingMs(r, ctx.now) <= MLT.freezeCutoffMs) throw new GameError("too_late", "Too late — no freezes in the final 5 seconds.", 409);
    tp.frozenOnce = true;
    tp.frozenUntil = ctx.now + FREEZE_MS;
  } else if (type === "reveal") {
    pr.peek = currentLeaders(r); // private to this player
  } else if (type === "extraLife") {
    if (pr.doubleVote) throw new GameError("already_double", "Double Vote is already on.", 409);
    pr.doubleVote = true;
  } else {
    throw new GameError("bad_powerup", "Unknown power-up.");
  }
  void s;
}

/** Most Likely To: lock in a vote. One per player per round; you can vote for yourself. */
export function castVote(s: GameState, playerId: string, targetId: unknown, ctx: Ctx) {
  const { r, pr } = currentProgress(s, playerId);
  if (r.mode !== "mlt") throw new GameError("wrong_mode", "There's no vote this round.", 409);
  if (pr.frozenUntil > ctx.now) throw new GameError("frozen", "Your voting screen is frozen! ❄️", 409);
  const p = getPlayer(s, playerId);
  p.voteTimes = rateLimit(p.voteTimes ?? [], ctx.now, 5000, 5, 300);
  if (typeof targetId !== "string" || !(r.candidates ?? []).includes(targetId) || getRemoved(s, targetId))
    throw new GameError("bad_vote", "That player isn't an option this round.");
  r.votes ??= {};
  r.votes[playerId] = { targetId, weight: pr.doubleVote ? 2 : 1 };
  pr.status = "voted";
  pr.solvedAt = ctx.now;
  pr.voteReset = false;
  bump(s);
  checkRoundComplete(s, ctx);
  return { locked: true };
}

/** Score a finished Most Likely To round, then forget who voted for whom. */
function scoreVotes(s: GameState, r: Round, ctx: Ctx) {
  const cands = (r.candidates ?? []).filter((id) => !getRemoved(s, id));
  const totals: Record<string, number> = {};
  for (const c of cands) totals[c] = 0;
  for (const [voter, v] of Object.entries(r.votes ?? {})) {
    if (getRemoved(s, voter) || !r.progress[voter]) continue;
    if (v.targetId in totals) totals[v.targetId] += v.weight;
  }
  const max = Math.max(0, ...Object.values(totals));
  const top = max > 0 ? cands.filter((c) => totals[c] === max) : [];
  r.totals = totals;
  if (r.kind === "suddenDeath") {
    // A tie (or no votes) is settled at random.
    const pool = top.length ? top : cands;
    const winner = pool.length ? pick(pool, ctx.random) : null;
    r.crowned = winner ? [winner] : [];
    r.sdWinnerId = winner;
    s.winnerId = winner;
  } else {
    r.crowned = top; // everyone tied for the most votes is crowned; no votes → nobody
    for (const voter of r.participants) {
      const pr = r.progress[voter];
      if (!pr) continue;
      const v = r.votes?.[voter];
      pr.voteResult = !v ? "missed" : top.includes(v.targetId) ? "correct" : "wrong";
      if (pr.voteResult === "correct") {
        addScore(s, voter, MLT.correctVote * r.multiplier, pr);
        const pl = s.players.find((x) => x.id === voter);
        if (pl) pl.stats.correctVotes = (pl.stats.correctVotes ?? 0) + 1;
      }
    }
    for (const c of top) {
      addScore(s, c, MLT.crowned * r.multiplier, r.progress[c]);
      const pl = s.players.find((x) => x.id === c);
      if (pl) pl.stats.crowns = (pl.stats.crowns ?? 0) + 1;
    }
  }
  r.votes = {}; // privacy: the voter → vote mapping is never kept after scoring
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
  p.answerTimes = rateLimit(p.answerTimes ?? [], ctx.now, 5000, 5, 400);
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
  if (r.mode === "wwi") return wwiCheckStage(s, ctx);
  if (r.mode === "blitz") return blitzCheck(s, ctx);
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

  if (r.mode === "wwi" && r.wwi) {
    wwiFinish(s, r.wwi);
    // A question skipped before any author was revealed: no points, nothing recorded.
    if (reason === "skipped" && r.wwi.revealed.length === 0) {
      s.phase = "reveal";
      bump(s);
      return;
    }
  } else if (reason === "skipped") {
    if (r.mode === "blitz" && r.blitz) wipeBlitz(r.blitz);
    for (const id of r.participants) {
      const pr = r.progress[id];
      const p = s.players.find((x) => x.id === id);
      if (!pr || !p) continue;
      p.score = Math.max(0, p.score - pr.points);
      pr.points = 0;
      p.powerupsLeft += pr.powerupsUsed.length;
    }
    if (r.kind === "suddenDeath") s.winnerId = null;
    if (r.mode === "mlt") {
      // Skipped before the reveal: votes are discarded unseen, nobody is crowned.
      r.votes = {};
      r.totals = null;
      r.crowned = [];
    }
    s.phase = "reveal";
    bump(s);
    return;
  }

  if (r.mode === "mlt") scoreVotes(s, r, ctx);
  if (r.mode === "blitz" && r.blitz) {
    if (r.kind !== "suddenDeath") scoreBlitz(s, r, r.blitz);
    wipeBlitz(r.blitz);
  }

  if (r.kind !== "suddenDeath" && r.mode !== "mlt" && r.mode !== "wwi" && r.mode !== "blitz") {
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
        solved:
          r.mode === "mlt"
            ? pr?.voteResult === "correct"
            : r.mode === "wwi"
              ? (pr?.wwiCorrect ?? 0) > 0
              : r.mode === "blitz"
                ? (r.blitz?.results?.players[p.id]?.valid ?? 0) > 0
                : pr?.status === "solved",
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
      answer: r.mode === "mlt" || r.mode === "wwi" || r.mode === "blitz" ? (r.question ?? "") : r.answer,
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
    if (s.round.mode === "wwi" && s.round.wwi) wwiAdvance(s, ctx);
    else if (s.round.mode === "blitz" && s.round.blitz && s.round.kind !== "suddenDeath") blitzAdvance(s, ctx);
    else endRound(s, ctx, "timer");
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
    case "round": {
      // Who Wrote It?: Next moves on from the review pause or an author reveal right away.
      const w = s.round?.mode === "wwi" ? s.round.wwi : undefined;
      if (w && !s.paused && (w.stage === "review" || w.stage === "answerReveal")) return wwiNextAnswer(s, ctx);
      if (s.round?.mode === "blitz" && s.round.blitz?.stage === "review") return finishBlitzReview(s, ctx);
      throw new GameError("round_running", "The round is still running. Use Skip to end it early.", 409);
    }
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
  if (activePlayers(s).length < minPlayersFor(mode)) return startRound(s, ctx); // holds and tells the host
  const options = availableChoices(s, mode);
  const friendRound =
    mode === "mlt" ? !!friendQuestionAvailable(s, n) : mode === "wwi" ? !!friendPromptAvailable(s, n) : !!friendWordAvailable(s, n, mode);
  if (!friendRound && options.length >= 2 && r && r.kind !== "suddenDeath" && r.endReason !== "skipped") {
    const candidates = r.participants
      .filter((id) => !getRemoved(s, id) && r.progress[id])
      .map((id) => ({ id, pts: r.progress[id].points }));
    if (candidates.length) {
      const low = Math.min(...candidates.map((c) => c.pts));
      const losers = candidates.filter((c) => c.pts === low);
      const loser = pick(losers, ctx.random);
      s.loserPick = { playerId: loser.id, kind: mode === "mlt" || mode === "wwi" ? "pack" : "category", options, deadline: ctx.now + LOSER_PICK_MS };
      s.phase = "loserPick";
      s.dare = null;
      bump(s);
      return;
    }
  }
  startRound(s, ctx);
}

export function resolveLoserPick(s: GameState, category: CategoryId | PackId | WwiPackId | BlitzCategoryId | null, ctx: Ctx) {
  assertPhase(s, "loserPick");
  const lp = s.loserPick!;
  const cat = category ?? pick(lp.options, ctx.random);
  startRound(s, ctx, cat);
}

export function pickCategory(s: GameState, playerId: string, category: unknown, ctx: Ctx) {
  assertPhase(s, "loserPick");
  const lp = s.loserPick!;
  if (lp.playerId !== playerId) throw new GameError("not_picker", "It's not your pick.", 403);
  if (!lp.options.includes(category as CategoryId)) throw new GameError("bad_category", "Pick one of the listed options.");
  resolveLoserPick(s, category as CategoryId | PackId | WwiPackId | BlitzCategoryId, ctx);
}

// ---------------------------------------------------------------------------
// Who Wrote It?
//
// Each round: everyone writes one anonymous answer to a question, the server
// picks a few (favoring players shown least), and for each one the others
// guess who wrote it. SECRET until that answer's reveal: who wrote what, and
// who guessed whom. Guesses are dropped as soon as the author is revealed and
// answers that were never shown are dropped when the round ends.
// ---------------------------------------------------------------------------
export function promptKey(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Host-written Who Wrote It? question (the "Host's Questions" pack). */
export function addCustomPrompt(s: GameState, text: string, ctx: Ctx) {
  if (s.customPrompts.length >= 100) throw new GameError("too_many", "Custom questions are full (100 max).");
  if (s.customPrompts.some((q) => promptKey(q.text) === promptKey(text)))
    throw new GameError("duplicate", "That question is already on the list.");
  s.customPrompts.push({ id: ctx.id(), text });
  if (!s.settings.wwiPacks.includes("custom")) s.settings.wwiPacks = [...s.settings.wwiPacks, "custom"];
  bump(s);
}

export function removeCustomPrompt(s: GameState, id: string) {
  s.customPrompts = s.customPrompts.filter((q) => q.id !== id);
  if (s.customPrompts.length === 0 && s.settings.wwiPacks.includes("custom")) {
    const packs = s.settings.wwiPacks.filter((p) => p !== "custom");
    s.settings.wwiPacks = packs.length ? packs : [...BUILTIN_WWI_PACKS];
  }
  bump(s);
}

/** A player's friend-written Who Wrote It? question (one each; never shown with their name; no author points). */
export function submitPrompt(s: GameState, playerId: string, text: string, ctx: Ctx) {
  assertPhase(s, "lobby");
  if (!s.settings.friendWords) throw new GameError("friend_words_off", "Friend-written rounds are turned off.", 409);
  if (!includesWwi(s)) throw new GameError("wrong_mode", "Questions are only used in Who Wrote It? rounds.", 409);
  getPlayer(s, playerId);
  const existing = s.promptSubs.find((q) => q.playerId === playerId && q.status === "pending");
  if (existing) existing.text = text;
  else {
    if (s.promptSubs.some((q) => q.playerId === playerId && q.status === "removed"))
      throw new GameError("submission_removed", "The host removed your question. You can't submit another this game.", 409);
    s.promptSubs.push({ id: ctx.id(), playerId, text, status: "pending" });
  }
  bump(s);
}

export function removePromptSub(s: GameState, id: string) {
  assertPhase(s, "lobby");
  const q = s.promptSubs.find((x) => x.id === id);
  if (!q) throw new GameError("not_found", "Question not found.", 404);
  q.status = "removed";
  bump(s);
}

function promptPool(s: GameState, pack: WwiPackId): string[] {
  const used = new Set(s.usedPrompts);
  if (pack === "custom")
    return s.customPrompts.map((q) => q.text).filter((t) => !used.has(promptKey(t)) && !isBlocked(t, s.settings.content));
  return (PROMPT_BANK[pack] ?? [])
    .filter((e) => (s.settings.content === "pg13" || e.content === "clean") && !used.has(promptKey(e.text)))
    .map((e) => e.text);
}

/** Who Wrote It? packs that still have unused questions. */
export function availableWwiPacks(s: GameState): WwiPackId[] {
  return (s.settings.wwiPacks ?? BUILTIN_WWI_PACKS).filter((p) => promptPool(s, p).length > 0);
}

export function chooseWwiPrompt(s: GameState, pack: WwiPackId, ctx: Ctx): { text: string; pack: WwiPackId } {
  const pool = promptPool(s, pack);
  if (pool.length) return { text: pick(pool, ctx.random), pack };
  const others = availableWwiPacks(s).filter((p) => p !== pack);
  if (others.length) return chooseWwiPrompt(s, pick(others, ctx.random), ctx);
  const anyBuiltin = BUILTIN_WWI_PACKS.filter((p) => promptPool(s, p).length > 0);
  if (anyBuiltin.length) return chooseWwiPrompt(s, pick(anyBuiltin, ctx.random), ctx);
  s.usedPrompts = []; // every question used (huge game): allow repeats again
  return chooseWwiPrompt(s, pack === "custom" ? "hypotheticals" : pack, ctx);
}

function friendPromptAvailable(s: GameState, roundNumber: number) {
  if (!s.settings.friendWords || !s.wwiRoundPlan.includes(roundNumber)) return null;
  const pending = s.promptSubs.filter((q) => q.status === "pending" && !getRemoved(s, q.playerId) && !isBlocked(q.text, s.settings.content));
  return pending.length ? pending : null;
}

function startWwiRound(s: GameState, ctx: Ctx, n: number, kind: "normal" | "final", pack: WwiPackId | null) {
  const active = activePlayers(s);
  if (active.length < WWI.minPlayers) {
    // Who Wrote It?-only game: hold and tell the host (Mixed skips these rounds instead).
    s.hold = "needPlayers";
    s.holdMin = WWI.minPlayers;
    if (s.phase === "loserPick" || s.phase === "dare") s.phase = "reveal";
    s.loserPick = null;
    s.dare = null;
    bump(s);
    return;
  }
  let question: string;
  let category: WwiPackId | "friend";
  let source: WordSource = "builtin";
  const friendPs = friendPromptAvailable(s, n);
  if (friendPs) {
    const sub = pick(friendPs, ctx.random);
    sub.status = "used";
    question = sub.text;
    category = "friend";
    source = "friend";
  } else {
    const packs = availableWwiPacks(s);
    const want =
      pack && (s.settings.wwiPacks as string[]).includes(pack) ? pack : packs.length ? pick(packs, ctx.random) : pick(s.settings.wwiPacks, ctx.random);
    const q = chooseWwiPrompt(s, want, ctx);
    question = q.text;
    category = q.pack;
    source = q.pack === "custom" ? "inside" : "builtin";
  }
  s.usedPrompts.push(promptKey(question));
  const ids = active.map((p) => p.id);
  const durationMs = (s.settings.writeSec ?? 45) * 1000;
  const progress: Record<string, PlayerProgress> = {};
  for (const id of ids) progress[id] = newProgress(0);
  s.roundsPlayed = n;
  s.round = {
    id: ctx.id(),
    mode: "wwi",
    number: n,
    kind,
    sdAttempt: 0,
    category,
    answer: "",
    hint: "",
    clue: null,
    alternates: [],
    hostHints: [],
    question,
    wwi: { stage: "writing", answers: {}, queue: [], current: null, total: 0, revealed: [], removed: [], lastResults: {}, noAnswers: false },
    source,
    authorId: null, // friend-written questions stay anonymous and earn no author points
    startedAt: ctx.now,
    durationMs,
    deadline: ctx.now + durationMs,
    pausedRemainingMs: null,
    participants: ids,
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
  s.hold = null;
  s.holdMin = null;
  bump(s);
}

/** Start a new stage timer (kept paused if the game is paused). */
function wwiStage(s: GameState, r: Round, stage: WwiRound["stage"], ms: number, ctx: Ctx) {
  r.wwi!.stage = stage;
  r.durationMs = ms;
  r.deadline = ctx.now + ms;
  r.pausedRemainingMs = s.paused ? ms : null;
}

function wwiAuthorOf(w: WwiRound, answerId: string): string | null {
  for (const [authorId, a] of Object.entries(w.answers)) if (a.id === answerId) return authorId;
  return null;
}

/** Players who can guess on an answer: everyone in the round except its author. */
function wwiGuessers(s: GameState, r: Round, authorId: string): string[] {
  return r.participants.filter((id) => id !== authorId && r.progress[id] && !getRemoved(s, id));
}

/** How many answers this round will show, after removals. */
function wwiRecount(s: GameState, w: WwiRound) {
  w.total = Math.min(s.settings.answersShown ?? 3, w.revealed.length + (w.current ? 1 : 0) + w.queue.length);
}

/** Writing is over: pick the answers to show, favoring players whose answers have been shown least. */
function wwiCloseWriting(s: GameState, ctx: Ctx) {
  const r = s.round!;
  const w = r.wwi!;
  const authors = Object.keys(w.answers).filter((id) => !getRemoved(s, id));
  if (authors.length === 0) {
    w.noAnswers = true;
    endRound(s, ctx, "timer"); // nobody wrote anything: no points, the host moves on
    return;
  }
  // Shuffle first so ties (and submission order) never decide who goes first; the sort is stable.
  const order = shuffle(authors, ctx.random).sort((a, b) => (s.wwiShownCount[a] ?? 0) - (s.wwiShownCount[b] ?? 0));
  w.queue = order.map((id) => w.answers[id].id);
  wwiRecount(s, w);
  wwiStage(s, r, "review", WWI.reviewMs, ctx);
  bump(s);
}

/** Put the next selected answer on screen, or end the round when all have been shown. */
function wwiNextAnswer(s: GameState, ctx: Ctx) {
  const r = s.round!;
  const w = r.wwi!;
  w.current = null;
  w.lastResults = {};
  w.queue = w.queue.filter((id) => {
    const a = wwiAuthorOf(w, id);
    return !!a && !getRemoved(s, a);
  });
  wwiRecount(s, w);
  if (w.revealed.length >= w.total || w.queue.length === 0) {
    endRound(s, ctx, "allDone");
    return;
  }
  const answerId = w.queue.shift()!;
  const authorId = wwiAuthorOf(w, answerId)!;
  // Choices: the author plus 3 others who have written an answer (or were here from the start).
  const joinOrder = new Map(s.players.map((p, i) => [p.id, i]));
  const canonical = (ids: string[]) => [...ids].sort((a, b) => joinOrder.get(a)! - joinOrder.get(b)!);
  const decoys = shuffle(canonical(s.wwiWriters.filter((id) => id !== authorId && !getRemoved(s, id))), ctx.random);
  const orders: Record<string, string[]> = {};
  for (const g of wwiGuessers(s, r, authorId)) {
    const mine = [authorId, ...decoys.filter((d) => d !== g).slice(0, 3)];
    orders[g] = shuffle(canonical(mine), ctx.random);
  }
  w.current = { answerId, text: w.answers[authorId].text, authorId, orders, guesses: {}, eliminated: {}, doubleGuess: {}, used: {} };
  s.wwiShownCount[authorId] = (s.wwiShownCount[authorId] ?? 0) + 1;
  for (const id of r.participants) {
    const pr = r.progress[id];
    if (pr) {
      pr.frozenUntil = 0;
      pr.frozenOnce = false;
    }
  }
  wwiStage(s, r, "guessing", (s.settings.guessSec ?? 15) * 1000, ctx);
  bump(s);
}

/** Reveal the author of the answer on screen and score it. */
function wwiRevealCurrent(s: GameState, ctx: Ctx) {
  const r = s.round!;
  const w = r.wwi!;
  const cur = w.current!;
  const authorId = cur.authorId;
  const guessers = wwiGuessers(s, r, authorId);
  const results: Record<string, WwiResult> = {};
  let correct = 0;
  let wrong = 0;
  for (const g of guessers) {
    const picks = cur.guesses[g] ?? [];
    if (picks.length === 0) {
      results[g] = "missed";
    } else if (picks.includes(authorId)) {
      results[g] = "correct";
      correct += 1;
      const pr = r.progress[g];
      addScore(s, g, WWI.correctGuess * r.multiplier, pr);
      pr.wwiCorrect = (pr.wwiCorrect ?? 0) + 1;
      const pl = s.players.find((x) => x.id === g)!;
      pl.stats.correctGuesses = (pl.stats.correctGuesses ?? 0) + 1;
    } else {
      results[g] = "wrong";
      wrong += 1;
    }
  }
  const author = s.players.find((x) => x.id === authorId);
  if (author && !author.removed) {
    results[authorId] = "author";
    const ap = r.progress[authorId];
    if (wrong) addScore(s, authorId, WWI.foolPoints * wrong * r.multiplier, ap);
    if (ap) ap.wwiFooled = (ap.wwiFooled ?? 0) + wrong;
    author.stats.fooled = (author.stats.fooled ?? 0) + wrong;
    author.stats.timesGuessed = (author.stats.timesGuessed ?? 0) + correct;
  }
  w.revealed.push({ answerId: cur.answerId, text: cur.text, authorId, correct, wrong, guessers: guessers.length });
  w.lastResults = results;
  w.current = null; // privacy: who guessed whom is never kept after the reveal
  wwiStage(s, r, "answerReveal", WWI.answerRevealMs, ctx);
  bump(s);
}

/** Give back power-ups spent on an answer that never got revealed. */
function wwiRefund(s: GameState, w: WwiRound) {
  const cur = w.current;
  if (!cur) return;
  for (const [id, used] of Object.entries(cur.used)) {
    const p = s.players.find((x) => x.id === id);
    if (p && used.length) p.powerupsLeft += used.length;
  }
}

/** Timer-driven stage changes. */
function wwiAdvance(s: GameState, ctx: Ctx) {
  const w = s.round!.wwi!;
  if (w.stage === "writing") wwiCloseWriting(s, ctx);
  else if (w.stage === "guessing" && w.current) wwiRevealCurrent(s, ctx);
  else wwiNextAnswer(s, ctx);
}

/** Early stage changes: everyone has written, or everyone who can guess has. */
function wwiCheckStage(s: GameState, ctx: Ctx) {
  const r = s.round!;
  const w = r.wwi;
  if (!w || s.paused) return;
  if (w.stage === "writing") {
    const writers = r.participants.filter((id) => r.progress[id] && !getRemoved(s, id));
    if (writers.length && writers.every((id) => w.answers[id])) wwiCloseWriting(s, ctx);
  } else if (w.stage === "guessing" && w.current) {
    const cur = w.current;
    const guessers = wwiGuessers(s, r, cur.authorId);
    if (guessers.every((g) => (cur.guesses[g]?.length ?? 0) >= (cur.doubleGuess[g] ? 2 : 1))) wwiRevealCurrent(s, ctx);
  }
}

/** Round over: drop everything secret that was never revealed. */
function wwiFinish(s: GameState, w: WwiRound) {
  wwiRefund(s, w);
  w.current = null;
  w.queue = [];
  w.answers = {};
}

/** A removed player can't write or guess, and their unrevealed answer leaves the selection. */
function wwiDropPlayer(s: GameState, w: WwiRound, playerId: string, ctx: Ctx) {
  const mine = w.answers[playerId];
  if (w.current) {
    delete w.current.orders[playerId];
    delete w.current.guesses[playerId];
  }
  if (!mine) return;
  w.queue = w.queue.filter((id) => id !== mine.id);
  if (w.current?.answerId === mine.id) {
    // Their answer is on screen: skip it (no points) and show a replacement if there is one.
    wwiRefund(s, w);
    w.removed.push(mine.id);
    w.current = null;
    wwiNextAnswer(s, ctx);
  } else {
    if (!w.revealed.some((x) => x.answerId === mine.id)) delete w.answers[playerId];
    wwiRecount(s, w);
  }
}

function wwiPlay(s: GameState, playerId: string) {
  assertPhase(s, "round");
  const r = s.round!;
  if (r.mode !== "wwi" || !r.wwi) throw new GameError("wrong_mode", "This isn't a Who Wrote It? round.", 409);
  const p = getPlayer(s, playerId);
  if (s.paused) throw new GameError("paused", "The game is paused.", 409);
  const pr = r.progress[playerId];
  if (!pr) throw new GameError("not_playing", "You'll join from the next question.", 409);
  return { r, w: r.wwi, p, pr };
}

/** Write your one anonymous answer. It locks once submitted. */
export function submitWwiAnswer(s: GameState, playerId: string, raw: unknown, ctx: Ctx) {
  const { w, p } = wwiPlay(s, playerId);
  if (w.stage !== "writing") throw new GameError("writing_closed", "Writing time is over.", 409);
  if (w.answers[playerId]) throw new GameError("answer_locked", "Your answer is locked in.", 409);
  const v = validateWwiAnswer(raw, s.settings.content);
  if (!v.ok) throw new GameError("invalid", v.error);
  p.wwiTimes = rateLimit(p.wwiTimes ?? [], ctx.now, 5000, 6, 250);
  w.answers[playerId] = { id: ctx.id(), text: v.value };
  if (!s.wwiWriters.includes(playerId)) s.wwiWriters.push(playerId);
  bump(s);
  checkRoundComplete(s, ctx);
  return { locked: true };
}

/** Guess who wrote the answer on screen. One pick (two with Double Guess); never echoed back or shown to others. */
export function wwiGuess(s: GameState, playerId: string, targetId: unknown, ctx: Ctx) {
  const { w, p, pr } = wwiPlay(s, playerId);
  const cur = w.current;
  if (w.stage !== "guessing" || !cur) throw new GameError("not_guessing", "Wait for the next answer.", 409);
  if (cur.authorId === playerId) throw new GameError("sitting_out", "That's your answer — keep a straight face 😏", 409);
  if (pr.frozenUntil > ctx.now) throw new GameError("frozen", "Your guess buttons are frozen! ❄️", 409);
  const limit = cur.doubleGuess[playerId] ? 2 : 1;
  const mine = cur.guesses[playerId] ?? [];
  if (mine.length >= limit) throw new GameError("guess_locked", "Your guess is locked in.", 409);
  const options = (cur.orders[playerId] ?? []).filter((id) => !(cur.eliminated[playerId] ?? []).includes(id) && !getRemoved(s, id));
  if (typeof targetId !== "string" || !options.includes(targetId)) throw new GameError("bad_guess", "Pick one of the names on your screen.");
  if (mine.includes(targetId)) throw new GameError("already_guessed", "You already picked them.", 409);
  p.wwiTimes = rateLimit(p.wwiTimes ?? [], ctx.now, 5000, 6, 250);
  cur.guesses[playerId] = [...mine, targetId];
  const locked = mine.length + 1 >= limit;
  bump(s);
  checkRoundComplete(s, ctx);
  return { locked };
}

/** Who Wrote It? power-ups: Freeze a rival's guess buttons, Eliminate Two wrong names, Double Guess. */
function wwiPowerup(s: GameState, r: Round, playerId: string, type: PowerUp, targetId: string | null, ctx: Ctx) {
  const w = r.wwi!;
  const cur = w.current;
  if (w.stage !== "guessing" || !cur) throw new GameError("not_guessing", "Power-ups work while an answer is on screen.", 409);
  if (cur.authorId === playerId) throw new GameError("sitting_out", "That's your answer — keep a straight face 😏", 409);
  const picked = (cur.guesses[playerId] ?? []).length > 0;
  if (type === "freeze") {
    if (!targetId || targetId === playerId) throw new GameError("bad_target", "Pick a rival to freeze.");
    const tp = r.progress[targetId];
    if (!tp || getRemoved(s, targetId)) throw new GameError("bad_target", "That player isn't in this question.", 409);
    if (tp.frozenOnce) throw new GameError("already_frozen", "That player was already frozen for this answer.", 409);
    if (remainingMs(r, ctx.now) <= WWI.freezeCutoffMs) throw new GameError("too_late", "Too late — no freezes in the final 5 seconds.", 409);
    // Anyone in the question can be frozen — even the author or someone who already guessed —
    // so a freeze never hints at who wrote the answer.
    tp.frozenOnce = true;
    tp.frozenUntil = ctx.now + FREEZE_MS;
  } else if (type === "reveal") {
    // Eliminate Two: remove two wrong names (always leaving at least two to pick from).
    if (picked) throw new GameError("already_guessed", "Use it before you guess.", 409);
    if (cur.eliminated[playerId]?.length) throw new GameError("already_used", "Already eliminated for this answer.", 409);
    if (cur.doubleGuess[playerId]) throw new GameError("one_boost", "One boost per answer — Double Guess is already on.", 409);
    const wrong = (cur.orders[playerId] ?? []).filter((id) => id !== cur.authorId);
    const n = Math.min(2, wrong.length - 1);
    if (n <= 0) throw new GameError("nothing_to_eliminate", "Not enough names to eliminate.", 409);
    cur.eliminated[playerId] = shuffle(wrong, ctx.random).slice(0, n);
  } else if (type === "extraLife") {
    // Double Guess: pick two names; it counts as correct if either is the author.
    if (picked) throw new GameError("already_guessed", "Use it before you guess.", 409);
    if (cur.doubleGuess[playerId]) throw new GameError("already_double", "Double Guess is already on.", 409);
    if (cur.eliminated[playerId]?.length) throw new GameError("one_boost", "One boost per answer — you already eliminated two.", 409);
    cur.doubleGuess[playerId] = true;
  } else {
    throw new GameError("bad_powerup", "Unknown power-up.");
  }
  (cur.used[playerId] ??= []).push(type);
}

function wwiHost(s: GameState) {
  assertPhase(s, "round");
  const r = s.round!;
  if (r.mode !== "wwi" || !r.wwi) throw new GameError("wrong_mode", "This isn't a Who Wrote It? round.", 409);
  return { r, w: r.wwi };
}

/** Host: skip the answer on screen before its author is revealed. No points; another answer replaces it if one is available. */
export function skipWwiAnswer(s: GameState, ctx: Ctx) {
  const { w } = wwiHost(s);
  if (w.stage !== "guessing" || !w.current) throw new GameError("not_guessing", "There's no answer on screen to skip.", 409);
  wwiRefund(s, w);
  w.removed.push(w.current.answerId);
  w.current = null;
  wwiNextAnswer(s, ctx);
}

/** Host: remove a selected answer before it appears on the TV. The next available answer takes its place. */
export function removeWwiAnswer(s: GameState, answerId: string, ctx: Ctx) {
  const { w } = wwiHost(s);
  if (w.current?.answerId === answerId) return skipWwiAnswer(s, ctx);
  const i = w.queue.indexOf(answerId);
  if (i < 0) throw new GameError("not_found", "That answer isn't waiting to be shown.", 404);
  w.queue.splice(i, 1);
  w.removed.push(answerId);
  const authorId = wwiAuthorOf(w, answerId);
  if (authorId) delete w.answers[authorId];
  wwiRecount(s, w);
  bump(s);
}

// ---------------------------------------------------------------------------
// Category Blitz
//
// The TV shows a category and a letter; players add as many answers as they
// can. SECRET until the reveal: the accepted answers and everyone's answers
// (other than your own). After the timer the host reviews the most common
// unrecognized answers, then every answer is scored and the secrets dropped.
// ---------------------------------------------------------------------------
interface BlitzPick {
  key: string;
  category: BlitzCategoryId;
  label: string;
  letter: string;
  answers: string[][];
}

const BLITZ_CATEGORY_NAMES: Record<BuiltInBlitzCategoryId, string> = {
  tv: "TV Shows",
  movies: "Movies",
  music: "Music Artists",
  food: "Food",
  memes: "Memes & Internet Culture",
  college: "College Life",
  places: "Places",
  animals: "Animals",
};

/** Host-written prompt ("Things in a fridge" + "B"); accepted answers are optional. */
export function addCustomBlitz(s: GameState, prompt: { category: string; letter: string; answers: string[][] }, ctx: Ctx) {
  if (s.customBlitz.length >= 100) throw new GameError("too_many", "Custom prompts are full (100 max).");
  const key = (c: string, l: string) => `${normalizeAnswer(c)}:${l}`;
  if (s.customBlitz.some((q) => key(q.category, q.letter) === key(prompt.category, prompt.letter)))
    throw new GameError("duplicate", "That prompt is already on the list.");
  s.customBlitz.push({ id: ctx.id(), ...prompt });
  if (!s.settings.blitzCategories.includes("hostPrompts")) s.settings.blitzCategories = [...s.settings.blitzCategories, "hostPrompts"];
  bump(s);
}

export function removeCustomBlitz(s: GameState, id: string) {
  s.customBlitz = s.customBlitz.filter((q) => q.id !== id);
  if (s.customBlitz.length === 0 && s.settings.blitzCategories.includes("hostPrompts")) {
    const cats = s.settings.blitzCategories.filter((c) => c !== "hostPrompts");
    s.settings.blitzCategories = cats.length ? cats : [...BUILTIN_BLITZ_CATEGORIES];
  }
  bump(s);
}

function blitzPool(s: GameState, cat: BlitzCategoryId, strictDifficulty = false): BlitzPick[] {
  const used = new Set(s.usedBlitz);
  if (cat === "hostPrompts")
    return s.customBlitz
      .filter((q) => !used.has(`c:${q.id}`) && !isBlocked(q.category, s.settings.content))
      .map((q) => ({ key: `c:${q.id}`, category: "hostPrompts", label: q.category, letter: q.letter, answers: q.answers }));
  return (BLITZ_BANK[cat] ?? [])
    .filter(
      (e: BlitzPromptEntry) =>
        (s.settings.content === "pg13" || e.content === "clean") &&
        (!strictDifficulty || s.settings.difficulty === "mixed" || e.difficulty === s.settings.difficulty) &&
        !used.has(`${cat}:${e.letter}`),
    )
    .map((e) => ({ key: `${cat}:${e.letter}`, category: cat, label: BLITZ_CATEGORY_NAMES[cat], letter: e.letter, answers: e.answers }));
}

/** Category Blitz categories that still have unused prompts. */
export function availableBlitzCategories(s: GameState): BlitzCategoryId[] {
  return (s.settings.blitzCategories ?? BUILTIN_BLITZ_CATEGORIES).filter((c) => blitzPool(s, c).length > 0);
}

export function chooseBlitzPrompt(s: GameState, cat: BlitzCategoryId, ctx: Ctx, builtInOnly = false): BlitzPick {
  if (!(builtInOnly && cat === "hostPrompts")) {
    let pool = blitzPool(s, cat, true);
    if (!pool.length) pool = blitzPool(s, cat);
    if (pool.length) return pick(pool, ctx.random);
  }
  const others = availableBlitzCategories(s).filter((c) => c !== cat && !(builtInOnly && c === "hostPrompts"));
  if (others.length) return chooseBlitzPrompt(s, pick(others, ctx.random), ctx, builtInOnly);
  const anyBuiltin = BUILTIN_BLITZ_CATEGORIES.filter((c) => blitzPool(s, c).length > 0);
  if (anyBuiltin.length) return chooseBlitzPrompt(s, pick(anyBuiltin, ctx.random), ctx, builtInOnly);
  s.usedBlitz = []; // every prompt used (huge game): allow repeats again
  return chooseBlitzPrompt(s, cat === "hostPrompts" ? "movies" : cat, ctx, builtInOnly);
}

function newBlitz(p: BlitzPick): BlitzRound {
  return {
    stage: "play",
    categoryLabel: p.label,
    letter: p.letter,
    promptKey: p.key,
    answers: p.answers.map((g) => [...g]),
    subs: {},
    extra: {},
    suggestions: {},
    review: [],
    results: null,
  };
}

function blitzRoundBase(s: GameState, ctx: Ctx, p: BlitzPick, participants: string[], lives: number) {
  s.usedBlitz.push(p.key);
  const durationMs = (s.settings.blitzSec ?? 30) * 1000;
  const progress: Record<string, PlayerProgress> = {};
  for (const id of participants) progress[id] = newProgress(lives);
  return {
    id: ctx.id(),
    mode: "blitz" as const,
    category: p.category,
    answer: "",
    hint: "",
    clue: null,
    alternates: [],
    hostHints: [],
    question: `${p.label} starting with ${p.letter}`,
    blitz: newBlitz(p),
    source: (p.category === "hostPrompts" ? "inside" : "builtin") as WordSource,
    authorId: null,
    startedAt: ctx.now,
    durationMs,
    deadline: ctx.now + durationMs,
    pausedRemainingMs: null,
    participants,
    progress,
    endedAt: null,
    endReason: null,
    authorBonus: 0,
    stumpedCount: 0,
    sdWinnerId: null,
  };
}

function startBlitzRound(s: GameState, ctx: Ctx, n: number, kind: "normal" | "final", cat: BlitzCategoryId | null) {
  const available = availableBlitzCategories(s);
  const want =
    cat && (s.settings.blitzCategories as string[]).includes(cat)
      ? cat
      : available.length
        ? pick(available, ctx.random)
        : pick(s.settings.blitzCategories, ctx.random);
  const p = chooseBlitzPrompt(s, want, ctx);
  s.roundsPlayed = n;
  s.round = { ...blitzRoundBase(s, ctx, p, activePlayers(s).map((x) => x.id), 0), number: n, kind, sdAttempt: 0, multiplier: kind === "final" ? 2 : 1 };
  s.phase = "round";
  s.paused = false;
  s.nextCategory = null;
  s.loserPick = null;
  s.dare = null;
  s.hold = null;
  s.holdMin = null;
  bump(s);
}

/** Category Blitz-only tiebreak: one built-in prompt; first valid answer wins, an invalid one is out. */
function startBlitzSuddenDeath(s: GameState, ctx: Ctx) {
  const sd = s.suddenDeath!;
  const cats = s.settings.blitzCategories.filter((c): c is BuiltInBlitzCategoryId => c !== "hostPrompts");
  const p = chooseBlitzPrompt(s, cats.length ? pick(cats, ctx.random) : pick(BUILTIN_BLITZ_CATEGORIES, ctx.random), ctx, true);
  s.round = { ...blitzRoundBase(s, ctx, p, [...sd.playerIds], 1), number: s.roundsPlayed, kind: "suddenDeath", sdAttempt: sd.attempt, multiplier: 1 };
  s.phase = "round";
  s.paused = false;
  bump(s);
}

/** A player's own deadline (Extra Time adds 5 seconds for them only). */
export function blitzDeadline(r: Round, playerId: string): number {
  return r.deadline + (r.blitz?.extra[playerId] ?? 0);
}

function blitzPlayEnd(r: Round): number {
  return r.deadline + Math.max(0, ...Object.values(r.blitz?.extra ?? {}));
}

function blitzPlay(s: GameState, playerId: string, ctx: Ctx) {
  assertPhase(s, "round");
  const r = s.round!;
  if (r.mode !== "blitz" || !r.blitz) throw new GameError("wrong_mode", "This isn't a Category Blitz round.", 409);
  const p = getPlayer(s, playerId);
  if (s.paused) throw new GameError("paused", "The game is paused.", 409);
  const pr = r.progress[playerId];
  if (!pr) throw new GameError("not_playing", "You'll join from the next round.", 409);
  if (pr.status !== "playing") throw new GameError("finished", "You're done for this round.", 409);
  if (r.blitz.stage !== "play" || ctx.now >= blitzDeadline(r, playerId)) throw new GameError("time_up", "Time's up!", 409);
  return { r, b: r.blitz, p, pr };
}

/** Add one answer. The reply never says whether it's valid. */
export function submitBlitzAnswer(s: GameState, playerId: string, raw: unknown, ctx: Ctx) {
  if (typeof raw !== "string") throw new GameError("bad_answer", "Type an answer.");
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text || [...text].length > 40) throw new GameError("bad_answer", "Type an answer (up to 40 characters).");
  if (!/^[\p{L}\p{N}\p{P}\p{Zs}\p{S}\p{M}]*$/u.test(text)) throw new GameError("bad_answer", "That answer has unsupported characters.");
  const { r, b, p, pr } = blitzPlay(s, playerId, ctx);
  if (pr.frozenUntil > ctx.now) throw new GameError("frozen", "Your answer box is frozen! ❄️", 409);
  if (isBlocked(text, s.settings.content)) throw new GameError("not_allowed", "That answer isn't allowed in this game.");
  const norm = normalizeAnswer(text);
  if (!norm) throw new GameError("bad_answer", "Type an answer with letters or numbers.");
  const list = (b.subs[playerId] ??= []);
  if (list.length >= BLITZ.maxAnswers) throw new GameError("max_answers", `That's ${BLITZ.maxAnswers} answers — the most for one round.`, 409);
  if (list.some((x) => x.norm === norm)) throw new GameError("duplicate", "You already added that.", 409);
  p.blitzTimes = rateLimit(p.blitzTimes ?? [], ctx.now, 4000, 8, 150);
  const idx = matchBlitzAnswer(text, b.letter, b.answers);
  const key = idx >= 0 ? `a:${idx}` : startsWithLetter(norm, b.letter) ? `u:${norm}` : "x";
  list.push({ text, norm, key, at: ctx.now });
  if (r.kind === "suddenDeath") {
    // First valid answer wins; anything else is out.
    if (key.startsWith("a:")) {
      markSolved(s, r, playerId, pr, ctx);
      return { added: true, count: list.length };
    }
    pr.status = "out";
  }
  bump(s);
  checkRoundComplete(s, ctx);
  return { added: true, count: list.length };
}

function blitzCheck(s: GameState, ctx: Ctx) {
  const r = s.round!;
  const b = r.blitz;
  if (!b) return;
  const inRound = r.participants.filter((id) => r.progress[id] && !getRemoved(s, id));
  if (r.kind === "suddenDeath") {
    if (!inRound.some((id) => r.progress[id].status === "playing")) endRound(s, ctx, "allDone");
    return;
  }
  // Everyone has hit the answer limit: no need to wait for the timer.
  if (b.stage === "play" && inRound.length && inRound.every((id) => (b.subs[id]?.length ?? 0) >= BLITZ.maxAnswers)) blitzClose(s, ctx);
}

function blitzAdvance(s: GameState, ctx: Ctx) {
  const r = s.round!;
  const b = r.blitz!;
  if (b.stage === "play") {
    if (ctx.now >= blitzPlayEnd(r)) blitzClose(s, ctx);
  } else {
    finishBlitzReview(s, ctx);
  }
}

/** Time's up: send the most common unrecognized answers to the host, or score right away. */
function blitzClose(s: GameState, ctx: Ctx) {
  const r = s.round!;
  const b = r.blitz!;
  const groups = new Map<string, { key: string; text: string; players: Set<string>; first: number }>();
  for (const id of r.participants) {
    if (getRemoved(s, id)) continue;
    for (const sub of b.subs[id] ?? []) {
      if (!sub.key.startsWith("u:")) continue;
      const g = groups.get(sub.key) ?? { key: sub.key, text: sub.text, players: new Set<string>(), first: sub.at };
      g.players.add(id);
      g.first = Math.min(g.first, sub.at);
      groups.set(sub.key, g);
    }
  }
  const top = [...groups.values()].sort((a, b) => b.players.size - a.players.size || a.first - b.first || a.key.localeCompare(b.key)).slice(0, BLITZ.reviewMax);
  if (!top.length) {
    endRound(s, ctx, "timer");
    return;
  }
  b.review = top.map((g) => ({ id: ctx.id(), key: g.key, text: g.text, count: g.players.size, verdict: null }));
  b.stage = "review";
  r.durationMs = BLITZ.reviewMs;
  r.deadline = ctx.now + BLITZ.reviewMs;
  r.pausedRemainingMs = s.paused ? BLITZ.reviewMs : null;
  bump(s);
}

/** Host: approve or reject an unrecognized answer (null = undecided). */
export function reviewBlitzAnswer(s: GameState, id: string, verdict: unknown) {
  assertPhase(s, "round");
  const b = s.round!.blitz;
  if (!b || b.stage !== "review") throw new GameError("not_reviewing", "There's nothing to review right now.", 409);
  const item = b.review.find((x) => x.id === id);
  if (!item) throw new GameError("not_found", "Answer not found.", 404);
  if (verdict !== "ok" && verdict !== "no" && verdict !== null) throw new GameError("bad_verdict", "Approve or reject.");
  item.verdict = verdict;
  bump(s);
}

/** Host taps Done (or the 20 seconds run out): anything left unreviewed earns nothing. */
export function finishBlitzReview(s: GameState, ctx: Ctx) {
  assertPhase(s, "round");
  const b = s.round!.blitz;
  if (!b || b.stage !== "review") throw new GameError("not_reviewing", "There's nothing to review right now.", 409);
  endRound(s, ctx, "timer");
}

/** +10 per valid answer, +30 more if nobody else gave it, capped at 300 (then doubled in the final). */
function scoreBlitz(s: GameState, r: Round, b: BlitzRound) {
  const approved = new Set(b.review.filter((x) => x.verdict === "ok").map((x) => x.key));
  const players = r.participants.filter((id) => r.progress[id] && !getRemoved(s, id));
  const valid: Record<string, Set<string>> = {};
  const count = new Map<string, number>();
  for (const id of players) {
    valid[id] = new Set((b.subs[id] ?? []).map((x) => x.key).filter((k) => k.startsWith("a:") || approved.has(k)));
    for (const k of valid[id]) count.set(k, (count.get(k) ?? 0) + 1);
  }
  const textOf = (k: string) => (k.startsWith("a:") ? b.answers[Number(k.slice(2))]?.[0] : b.review.find((x) => x.key === k)?.text) ?? "";
  const results: NonNullable<BlitzRound["results"]> = { players: {}, popular: [], uniques: [] };
  for (const id of players) {
    const keys = [...valid[id]];
    const unique = keys.filter((k) => count.get(k) === 1).length;
    const base = Math.min(BLITZ.roundCap, keys.length * BLITZ.valid + unique * BLITZ.uniqueBonus);
    const pr = r.progress[id];
    const applied = addScore(s, id, base * r.multiplier, pr);
    results.players[id] = { valid: keys.length, unique, points: applied };
    const pl = s.players.find((x) => x.id === id)!;
    pl.stats.validAnswers = (pl.stats.validAnswers ?? 0) + keys.length;
    pl.stats.uniqueAnswers = (pl.stats.uniqueAnswers ?? 0) + unique;
    for (const k of keys) if (count.get(k) === 1) results.uniques.push({ text: textOf(k), playerId: id });
  }
  const shown = (t: string) => !!t && !isBlocked(t, s.settings.content);
  results.popular = [...count.entries()]
    .filter(([k, n]) => n >= 2 && shown(textOf(k)))
    .sort((a, b) => b[1] - a[1] || textOf(a[0]).localeCompare(textOf(b[0])))
    .slice(0, 6)
    .map(([k, n]) => ({ text: textOf(k), count: n }));
  results.uniques = results.uniques.filter((u) => shown(u.text)).slice(0, 8);
  b.results = results;
}

/** Drop the secrets: accepted answers, everyone's answers, private suggestions, review texts. */
function wipeBlitz(b: BlitzRound) {
  b.answers = [];
  b.subs = {};
  b.suggestions = {};
  b.review = [];
}

/** Category Blitz power-ups: Freeze a rival's answer box, Get a Suggestion, Extra Time. */
function blitzPowerup(s: GameState, r: Round, playerId: string, type: PowerUp, targetId: string | null, ctx: Ctx) {
  const b = r.blitz!;
  if (b.stage !== "play" || ctx.now >= blitzDeadline(r, playerId)) throw new GameError("time_up", "Time's up!", 409);
  if (type === "freeze") {
    if (!targetId || targetId === playerId) throw new GameError("bad_target", "Pick a rival to freeze.");
    const tp = r.progress[targetId];
    if (!tp || getRemoved(s, targetId) || tp.status !== "playing") throw new GameError("bad_target", "That player isn't answering right now.", 409);
    if (tp.frozenOnce) throw new GameError("already_frozen", "That player was already frozen this round.", 409);
    if (remainingMs(r, ctx.now) <= BLITZ.freezeCutoffMs) throw new GameError("too_late", "Too late — no freezes in the final 5 seconds.", 409);
    tp.frozenOnce = true;
    tp.frozenUntil = ctx.now + FREEZE_MS;
  } else if (type === "reveal") {
    if (b.suggestions[playerId]) throw new GameError("already_suggested", "You already have a suggestion.", 409);
    const mine = new Set((b.subs[playerId] ?? []).map((x) => x.key));
    const options = b.answers.map((g, i) => ({ g, i })).filter(({ i }) => !mine.has(`a:${i}`));
    if (!options.length) throw new GameError("no_suggestion", "No suggestions for this prompt.", 409);
    b.suggestions[playerId] = pick(options, ctx.random).g[0]; // private to this player
  } else if (type === "extraLife") {
    if (b.extra[playerId]) throw new GameError("already_extended", "You already added extra time this round.", 409);
    b.extra[playerId] = BLITZ.extraTimeMs;
  } else {
    throw new GameError("bad_powerup", "Unknown power-up.");
  }
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
  s.hold = null;
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
    p.stats = { hints: 0, emojiSolves: 0, crowns: 0, correctVotes: 0, livesLost: 0, bestSolveMs: null, solves: 0, worstRank: null, stumped: 0 };
  }
  s.submissions = s.submissions.filter((x) => x.status === "pending");
  s.questionSubs = s.questionSubs.filter((x) => x.status === "pending");
  s.questionRoundPlan = [];
  s.promptSubs = s.promptSubs.filter((x) => x.status === "pending");
  s.wwiRoundPlan = [];
  s.wwiShownCount = {};
  s.wwiWriters = [];
  s.hold = null;
  s.holdMin = null;
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
