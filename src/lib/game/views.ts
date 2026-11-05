// Projections of the server-side GameState for each client role.
// SECURITY: the answer (and hint) may only appear here once the round has
// ended (round.endedAt != null). Unit tests enforce this.
import { emojiFor, labelFor } from "@/data/categories";
import { computeAwards, standings, type Award, type Standing } from "./awards";
import { knownLetters, remainingMs } from "./engine";
import { EMOJI, MLT, STARTING_LIVES, WWI } from "./scoring";
import { estimateMinutes } from "./estimate";
import { answerLetters } from "./answers";
import { maskAnswer, solvedFraction, type MaskCell } from "./text";
import type { CategoryId, GameMode, GameState, PackId, Phase, Round, RoundMode, Settings, WwiPackId, WwiResult, WwiStage } from "./types";

export interface TimerView {
  deadline: number;
  remainingMs: number;
  durationMs: number;
  paused: boolean;
}

export interface LeaderEntry extends Standing {
  roundPoints: number;
}

export interface RivalEntry {
  id: string;
  nickname: string;
  lives: number;
  pct: number;
  status: "playing" | "solved" | "out" | "waiting" | "voted";
  frozen: boolean;
}

export interface RevealView {
  mode: RoundMode;
  /** Word rounds: the answer. Most Likely To: the question. */
  answer: string;
  /**
   * Most Likely To: vote TOTALS per player, lowest first (for the suspense reveal),
   * and who was crowned. Never who voted for whom. Null when skipped.
   */
  totals: { id: string; nickname: string; votes: number }[] | null;
  crowned: { id: string; nickname: string }[];
  /** How many participants got it, out of how many played. */
  solvedCount: number;
  totalPlayers: number;
  /** Fastest correct player this round (null if nobody solved). */
  fastest: { id: string; nickname: string; ms: number } | null;
  skipped: boolean;
  isFriend: boolean;
  authorId: string | null;
  authorName: string | null;
  authorBonus: number;
  stumpedCount: number;
  sdWinnerId: string | null;
  /** Who Wrote It?: the answers revealed this round (never the ones that weren't shown). */
  wwi: { answers: WwiRevealedView[]; noAnswers: boolean } | null;
}

export interface WwiRevealedView {
  text: string;
  authorId: string;
  authorName: string;
  /** Totals only — never who guessed whom. */
  correct: number;
  wrong: number;
  guessers: number;
}

/**
 * Who Wrote It? round state shared by every screen. Deliberately has NO author
 * for the answer on screen, and no per-player submit/guess status — only totals.
 */
export interface WwiPublicView {
  stage: WwiStage;
  /** Writing: answers in, out of players writing. */
  submitted: number;
  writers: number;
  /** "Answer index of total". */
  index: number;
  total: number;
  /** Guessing: the answer on screen (without its author) and how many have guessed, out of how many can. */
  answer: string | null;
  guessed: number;
  guessers: number;
  /** Answer reveal: the answer just revealed, with its author. */
  revealed: WwiRevealedView | null;
  noAnswers: boolean;
}

export interface CategoryOption {
  id: CategoryId | PackId | WwiPackId;
  label: string;
  emoji: string;
}

export interface DareView {
  playerId: string;
  nickname: string;
  options: string[];
  resultIndex: number | null;
  spinId: number;
  status: "waiting" | "spun" | "passed";
  autoSpinAt: number;
}

export interface LoserPickView {
  playerId: string;
  nickname: string;
  /** "pack" when the next round is Most Likely To. */
  kind: "category" | "pack";
  options: CategoryOption[];
  deadline: number;
}

export interface FinalView {
  standings: Standing[];
  awards: Award[];
  winnerId: string | null;
}

interface BaseView {
  channel: string;
  serverNow: number;
  seq: number;
  code: string;
  phase: Phase;
  paused: boolean;
  /** The host's Game Mode for this game, and the modes Mixed rotates through. */
  mode: GameMode;
  mixedModes: RoundMode[];
  /** A Most Likely To-only game is waiting for at least 3 active players. */
  hold: "needPlayers" | null;
  /** How many players the held mode needs. */
  holdMin: number | null;
  gameNumber: number;
  roundsPlayed: number;
  totalRounds: number;
  content: Settings["content"];
  leaderboard: LeaderEntry[];
  round: null | {
    /** What this round plays. */
    mode: RoundMode;
    /** Emoji Decode: the emoji clue (shown to everyone) and the hints the host has dropped. */
    clue: string | null;
    hostHints: string[];
    /** Players finished (solved, out, or voted) / players in the round. */
    answered: { done: number; total: number };
    /** Most Likely To / Who Wrote It?: the question. Most Likely To: who can be voted for (public). */
    question: string | null;
    candidates: { id: string; nickname: string }[];
    wwi: WwiPublicView | null;
    number: number;
    kind: Round["kind"];
    sdAttempt: number;
    category: string;
    categoryEmoji: string;
    multiplier: number;
    timer: TimerView;
    ended: boolean;
  };
  reveal: RevealView | null;
  loserPick: LoserPickView | null;
  dare: DareView | null;
  suddenDeath: { playerIds: string[]; names: string[] } | null;
  final: FinalView | null;
}

export function categoryLabel(c: CategoryId | PackId | WwiPackId | "friend") {
  return labelFor(c);
}

export function categoryOption(id: CategoryId | PackId | WwiPackId): CategoryOption {
  return { id, label: labelFor(id), emoji: emojiFor(id) };
}

function nameOf(s: GameState, id: string | null) {
  return id ? (s.players.find((p) => p.id === id)?.nickname ?? "Someone") : null;
}

function revealedView(s: GameState, x: { text: string; authorId: string; correct: number; wrong: number; guessers: number }): WwiRevealedView {
  return { text: x.text, authorId: x.authorId, authorName: nameOf(s, x.authorId)!, correct: x.correct, wrong: x.wrong, guessers: x.guessers };
}

function wwiPublic(s: GameState, r: Round): WwiPublicView | null {
  const w = r.wwi;
  if (r.mode !== "wwi" || !w) return null;
  const inRound = r.participants.filter((id) => r.progress[id] && s.players.some((p) => p.id === id && !p.removed));
  const cur = !r.endedAt && w.stage === "guessing" ? w.current : null;
  const guessers = cur ? inRound.filter((id) => id !== cur.authorId) : [];
  const last = w.revealed[w.revealed.length - 1];
  return {
    stage: w.stage,
    submitted: inRound.filter((id) => w.answers[id]).length,
    writers: inRound.length,
    index: Math.min(w.total, w.revealed.length + (cur ? 1 : 0)) || (w.total ? 1 : 0),
    total: w.total,
    answer: cur ? cur.text : null,
    guessed: cur ? guessers.filter((id) => (cur.guesses[id]?.length ?? 0) > 0).length : 0,
    guessers: guessers.length,
    revealed: !r.endedAt && w.stage === "answerReveal" && last ? revealedView(s, last) : null,
    noAnswers: w.noAnswers,
  };
}

function revealStats(s: GameState, r: Round) {
  const played = r.participants.filter((id) => r.progress[id]);
  const solved = played.filter((id) => r.progress[id].status === "solved");
  let fastest: RevealView["fastest"] = null;
  for (const id of solved) {
    const ms = r.progress[id].solveMs;
    if (ms != null && (!fastest || ms < fastest.ms)) fastest = { id, nickname: nameOf(s, id)!, ms };
  }
  return { solvedCount: solved.length, totalPlayers: played.length, fastest };
}

function base(s: GameState, now: number): BaseView {
  const r = s.round;
  const showRound = r && s.phase !== "lobby";
  const ended = !!r?.endedAt;
  const live = standings(s);
  const leaderboard: LeaderEntry[] = live.map((e) => {
    let roundPoints = 0;
    if (r && showRound && r.kind !== "suddenDeath") {
      if (r.progress[e.id]) roundPoints = r.progress[e.id].points;
      else if (ended && r.authorId === e.id) roundPoints = r.authorBonus;
    }
    return { ...e, roundPoints };
  });
  return {
    channel: `room-${s.roomId}`,
    serverNow: now,
    seq: s.seq,
    code: s.code,
    phase: s.phase,
    paused: s.paused,
    mode: s.settings.mode ?? "hangman",
    mixedModes: s.settings.mixedModes ?? ["hangman", "emoji"],
    hold: s.hold ?? null,
    holdMin: s.hold ? (s.holdMin ?? MLT.minPlayers) : null,
    gameNumber: s.gameNumber,
    roundsPlayed: s.roundsPlayed,
    totalRounds: s.settings.rounds,
    content: s.settings.content,
    leaderboard,
    round: showRound
      ? {
          mode: r.mode,
          clue: r.mode === "emoji" ? r.clue : null,
          hostHints: r.mode === "emoji" ? r.hostHints : [],
          answered: (() => {
            const w = wwiPublic(s, r);
            if (w) return w.stage === "writing" ? { done: w.submitted, total: w.writers } : { done: w.guessed, total: w.guessers };
            return {
              done: r.participants.filter((id) => r.progress[id] && r.progress[id].status !== "playing").length,
              total: r.participants.filter((id) => r.progress[id]).length,
            };
          })(),
          question: r.mode === "mlt" || r.mode === "wwi" ? (r.question ?? null) : null,
          wwi: wwiPublic(s, r),
          candidates:
            r.mode === "mlt"
              ? (r.candidates ?? []).filter((id) => s.players.some((p) => p.id === id && !p.removed)).map((id) => ({ id, nickname: nameOf(s, id)! }))
              : [],
          number: r.number,
          kind: r.kind,
          sdAttempt: r.sdAttempt,
          category: categoryLabel(r.category),
          categoryEmoji: emojiFor(r.category),
          multiplier: r.multiplier,
          timer: {
            deadline: r.deadline,
            remainingMs: ended ? 0 : remainingMs(r, now),
            durationMs: r.durationMs,
            paused: s.paused,
          },
          ended,
        }
      : null,
    reveal:
      showRound && ended
        ? {
            mode: r.mode,
            answer: r.mode === "mlt" || r.mode === "wwi" ? (r.question ?? "") : r.answer,
            ...revealStats(s, r),
            totals:
              r.mode === "mlt" && r.totals
                ? Object.entries(r.totals)
                    .map(([id, votes]) => ({ id, nickname: nameOf(s, id)!, votes }))
                    .sort((a, b) => a.votes - b.votes || a.nickname.localeCompare(b.nickname))
                : null,
            crowned: (r.mode === "mlt" ? (r.crowned ?? []) : []).map((id) => ({ id, nickname: nameOf(s, id)! })),
            skipped: r.endReason === "skipped",
            isFriend: r.source === "friend",
            authorId: r.authorId,
            authorName: nameOf(s, r.authorId),
            authorBonus: r.authorBonus,
            stumpedCount: r.stumpedCount,
            sdWinnerId: r.sdWinnerId,
            wwi: r.mode === "wwi" && r.wwi ? { answers: r.wwi.revealed.map((x) => revealedView(s, x)), noAnswers: r.wwi.noAnswers } : null,
          }
        : null,
    loserPick:
      s.phase === "loserPick" && s.loserPick
        ? {
            playerId: s.loserPick.playerId,
            nickname: nameOf(s, s.loserPick.playerId)!,
            kind: s.loserPick.kind ?? "category",
            options: s.loserPick.options.map(categoryOption),
            deadline: s.loserPick.deadline,
          }
        : null,
    dare:
      s.phase === "dare" && s.dare
        ? {
            playerId: s.dare.playerId,
            nickname: nameOf(s, s.dare.playerId)!,
            options: s.dare.options,
            resultIndex: s.dare.resultIndex,
            spinId: s.dare.spinId,
            status: s.dare.status,
            autoSpinAt: s.dare.autoSpinAt,
          }
        : null,
    suddenDeath: s.suddenDeath
      ? { playerIds: s.suddenDeath.playerIds, names: s.suddenDeath.playerIds.map((id) => nameOf(s, id)!) }
      : null,
    final:
      s.phase === "ended" ? { standings: live, awards: computeAwards(s), winnerId: s.winnerId } : null,
  };
}

// ---------------------------------------------------------------------------
// TV
// ---------------------------------------------------------------------------
export interface TvView extends BaseView {
  role: "tv";
  lobby: {
    players: { id: string; nickname: string }[];
    submissions: number;
    questions: number;
    /** Who Wrote It? questions players have submitted. */
    prompts: number;
    friendWords: boolean;
    /** Estimated game length with the current settings. */
    estimateMin: number;
  } | null;
  pattern: MaskCell[] | null; // always blank during a round
  rivals: RivalEntry[];
  reactions: { id: number; emoji: string; nickname: string; at: number }[];
  dareEnabled: boolean;
}

export function rivalsFor(s: GameState, now: number, disguiseAuthor: boolean): RivalEntry[] {
  const r = s.round;
  return s.players
    .filter((p) => !p.removed)
    .map((p): RivalEntry => {
      const pr = r?.progress[p.id];
      if (!r || !pr) {
        if (r && disguiseAuthor && r.authorId === p.id && !r.endedAt)
          return { id: p.id, nickname: p.nickname, lives: r.mode === "emoji" ? EMOJI.attempts : STARTING_LIVES, pct: 0, status: "playing", frozen: false };
        return { id: p.id, nickname: p.nickname, lives: 0, pct: 0, status: "waiting", frozen: false };
      }
      if (r.mode === "wwi") {
        // Never per-player writing/guessing status: it would hint at who wrote the answer on screen.
        return { id: p.id, nickname: p.nickname, lives: 0, pct: 0, status: "playing", frozen: pr.frozenUntil > now && !r.endedAt };
      }
      if (r.mode === "mlt") {
        // Who has voted is public ("N votes in"); who they voted for never is.
        return { id: p.id, nickname: p.nickname, lives: 0, pct: pr.status === "voted" ? 100 : 0, status: pr.status, frozen: pr.frozenUntil > now && !r.endedAt };
      }
      return {
        id: p.id,
        nickname: p.nickname,
        lives: pr.lives, // Emoji Decode: attempts left
        // Emoji Decode has no partial progress, and guesses are never shown.
        pct: r.mode === "emoji" ? (pr.status === "solved" ? 100 : 0) : Math.round(solvedFraction(r.answer, knownLetters(r, pr)) * 100),
        status: pr.status,
        frozen: pr.frozenUntil > now && !r.endedAt,
      };
    });
}

export function tvView(s: GameState, now: number): TvView {
  const b = base(s, now);
  const r = s.round;
  return {
    ...b,
    role: "tv",
    lobby:
      s.phase === "lobby"
        ? {
            players: s.players.filter((p) => !p.removed).map((p) => ({ id: p.id, nickname: p.nickname })),
            submissions: s.submissions.filter((x) => x.status === "pending").length,
            questions: s.questionSubs.filter((x) => x.status === "pending").length,
            prompts: s.promptSubs.filter((x) => x.status === "pending").length,
            friendWords: s.settings.friendWords,
            estimateMin: estimateMinutes(s.settings),
          }
        : null,
    pattern: r && s.phase !== "lobby" && r.mode !== "emoji" && r.mode !== "wwi" ? (r.endedAt ? maskAnswer(r.answer, new Set("ABCDEFGHIJKLMNOPQRSTUVWXYZ")) : maskAnswer(r.answer, new Set())) : null,
    rivals: s.phase === "lobby" ? [] : rivalsFor(s, now, true),
    reactions: s.reactions.map((x) => ({ id: x.id, emoji: x.emoji, nickname: nameOf(s, x.playerId)!, at: x.at })),
    dareEnabled: s.settings.dareWheel,
  };
}

// ---------------------------------------------------------------------------
// Player phone
// ---------------------------------------------------------------------------
export type MyRoundState = "playing" | "solved" | "out" | "sittingOut" | "waiting" | "voted";

export interface PlayerView extends BaseView {
  role: "player";
  me: { id: string; nickname: string; score: number; rank: number; powerupsLeft: number };
  friendWords: boolean;
  submission: { answer: string; hint: string; clue: string | null; status: string } | null;
  my: null | {
    state: MyRoundState;
    pattern: MaskCell[] | null;
    guessed: string[];
    wrong: string[];
    lives: number;
    hint: string | null;
    hintUsed: boolean;
    frozenUntil: number;
    points: number;
    freezeTargets: { id: string; nickname: string }[];
    /** Emoji Decode: attempts allowed this round, this player's own wrong answers, and letters revealed to them by power-up. */
    maxAttempts: number;
    revealedLetters: { position: number; letter: string }[];
    /**
     * Most Likely To. Deliberately NOT included: who this player voted for.
     * voteResult is only sent after the round ends.
     */
    doubleVote: boolean;
    peek: { names: string[]; votes: number } | null;
    voteReset: boolean;
    voteResult: "correct" | "wrong" | "missed" | null;
    /** Who Wrote It?: this player's own view only. */
    wwi: MyWwi | null;
  };
  questionSub: { text: string; status: string } | null;
  /** Who Wrote It? question this player submitted in the lobby. */
  promptSub: { text: string; status: string } | null;
}

/**
 * A player's private Who Wrote It? state. Only ever built for that player.
 * Deliberately NOT included: who anyone else picked, or whether this player's
 * pick was right before the reveal.
 */
export interface MyWwi {
  /** Writing: whether their answer is locked in, and its text (their own). */
  submitted: boolean;
  myAnswer: string | null;
  /** Guessing: their own answer is on screen — they sit this one out. */
  isAuthor: boolean;
  /** Their own shuffled choices (Eliminate Two removes two wrong names). */
  choices: { id: string; nickname: string }[];
  picks: string[];
  pickLimit: number;
  doubleGuess: boolean;
  eliminated: boolean;
  /** Answer reveal: how their guess went, or how many players their answer fooled. */
  result: WwiResult | null;
  fooled: number | null;
}

const NO_MLT = { doubleVote: false, peek: null, voteReset: false, voteResult: null, wwi: null } as const;

function myWwi(s: GameState, r: Round, playerId: string): MyWwi {
  const w = r.wwi!;
  const live = !r.endedAt;
  const cur = live && w.stage === "guessing" ? w.current : null;
  const isAuthor = !!cur && cur.authorId === playerId;
  const removedNames = new Set(cur ? (cur.eliminated[playerId] ?? []) : []);
  const last = w.revealed[w.revealed.length - 1];
  const showResult = live && w.stage === "answerReveal";
  return {
    submitted: !!w.answers[playerId],
    myAnswer: w.answers[playerId]?.text ?? null,
    isAuthor,
    choices:
      cur && !isAuthor
        ? (cur.orders[playerId] ?? [])
            .filter((id) => !removedNames.has(id) && s.players.some((p) => p.id === id && !p.removed))
            .map((id) => ({ id, nickname: nameOf(s, id)! }))
        : [],
    picks: cur && !isAuthor ? (cur.guesses[playerId] ?? []) : [],
    pickLimit: cur?.doubleGuess[playerId] ? 2 : 1,
    doubleGuess: !!cur?.doubleGuess[playerId],
    eliminated: removedNames.size > 0,
    result: showResult ? (w.lastResults[playerId] ?? null) : null,
    fooled: showResult && last && last.authorId === playerId ? last.wrong : null,
  };
}

export function playerView(s: GameState, playerId: string, now: number): PlayerView {
  const b = base(s, now);
  const me = s.players.find((p) => p.id === playerId)!;
  const myStanding = b.leaderboard.find((e) => e.id === playerId);
  const r = s.round;
  let my: PlayerView["my"] = null;
  if (r && s.phase !== "lobby") {
    const pr = r.progress[playerId];
    if (r.authorId === playerId) {
      my = {
        state: "sittingOut",
        pattern: null,
        guessed: [],
        wrong: [],
        lives: 0,
        hint: null,
        hintUsed: false,
        frozenUntil: 0,
        points: r.endedAt ? r.authorBonus : 0,
        freezeTargets: [],
        maxAttempts: 0,
        revealedLetters: [],
        ...NO_MLT,
      };
    } else if (!pr) {
      my = { state: "waiting", pattern: null, guessed: [], wrong: [], lives: 0, hint: null, hintUsed: false, frozenUntil: 0, points: 0, freezeTargets: [], maxAttempts: 0, revealedLetters: [], ...NO_MLT };
    } else if (r.mode === "wwi" && r.wwi) {
      const mine = myWwi(s, r, playerId);
      const canFreeze =
        !r.endedAt && r.wwi.stage === "guessing" && !!r.wwi.current && !mine.isAuthor && remainingMs(r, now) > WWI.freezeCutoffMs;
      my = {
        state: pr.status,
        pattern: null,
        guessed: [],
        wrong: [],
        lives: 0,
        hint: null,
        hintUsed: false,
        frozenUntil: r.endedAt || r.wwi.stage !== "guessing" ? 0 : pr.frozenUntil,
        points: pr.points,
        // Everyone in the question, including the author and anyone who already guessed, so the list never hints at the author.
        freezeTargets: canFreeze
          ? r.participants
              .filter((id) => id !== playerId && r.progress[id] && !r.progress[id].frozenOnce && s.players.some((p) => p.id === id && !p.removed))
              .map((id) => ({ id, nickname: nameOf(s, id)! }))
          : [],
        maxAttempts: 0,
        revealedLetters: [],
        ...NO_MLT,
        wwi: mine,
      };
    } else if (r.mode === "mlt") {
      const canFreeze = !r.endedAt && r.kind !== "suddenDeath" && remainingMs(r, now) > MLT.freezeCutoffMs;
      my = {
        state: pr.status,
        pattern: null,
        guessed: [],
        wrong: [],
        lives: 0,
        hint: null,
        hintUsed: false,
        frozenUntil: r.endedAt ? 0 : pr.frozenUntil,
        points: pr.points,
        freezeTargets: canFreeze
          ? r.participants
              .filter((id) => id !== playerId && r.progress[id]?.status === "playing" && !r.progress[id].frozenOnce)
              .map((id) => ({ id, nickname: nameOf(s, id)! }))
          : [],
        maxAttempts: 0,
        revealedLetters: [],
        doubleVote: !!pr.doubleVote,
        peek: pr.peek ? { names: pr.peek.leaderIds.map((id) => nameOf(s, id)!), votes: pr.peek.votes } : null,
        voteReset: !!pr.voteReset,
        voteResult: r.endedAt && r.endReason !== "skipped" ? (pr.voteResult ?? null) : null,
        wwi: null,
      };
    } else {
      const emoji = r.mode === "emoji";
      const known = emoji ? new Set<string>() : knownLetters(r, pr);
      const letters = emoji ? answerLetters(r.answer) : [];
      my = {
        state: pr.status,
        // Emoji Decode never sends a pattern: it would reveal the answer's shape.
        pattern: emoji ? null : maskAnswer(r.answer, known),
        guessed: emoji ? [] : [...pr.guessed, ...pr.revealed.filter((l) => !pr.guessed.includes(l))],
        wrong: pr.wrong,
        lives: pr.lives,
        hint: pr.hintUsed || r.endedAt ? r.hint : null,
        hintUsed: pr.hintUsed,
        frozenUntil: r.endedAt ? 0 : pr.frozenUntil,
        points: pr.points,
        freezeTargets:
          r.endedAt || r.kind === "suddenDeath"
            ? []
            : r.participants
                .filter((id) => id !== playerId && r.progress[id]?.status === "playing" && !r.progress[id].frozenOnce)
                .map((id) => ({ id, nickname: nameOf(s, id)! })),
        maxAttempts: emoji ? (r.kind === "suddenDeath" ? 1 : EMOJI.attempts) : 0,
        revealedLetters: emoji ? (pr.revealedPos ?? []).map((position) => ({ position, letter: letters[position] })) : [],
        ...NO_MLT,
      };
    }
  }
  const sub = s.phase === "lobby" ? s.submissions.find((x) => x.playerId === playerId && x.status !== "used") : undefined;
  return {
    ...b,
    role: "player",
    me: {
      id: me.id,
      nickname: me.nickname,
      score: me.score,
      rank: myStanding?.rank ?? 0,
      powerupsLeft: me.powerupsLeft,
    },
    friendWords: s.settings.friendWords,
    submission: sub ? { answer: sub.answer, hint: sub.hint, clue: sub.clue ?? null, status: sub.status } : null,
    questionSub: (() => {
      const q = s.phase === "lobby" ? s.questionSubs.find((x) => x.playerId === playerId && x.status !== "used") : undefined;
      return q ? { text: q.text, status: q.status } : null;
    })(),
    promptSub: (() => {
      const q = s.phase === "lobby" ? s.promptSubs.find((x) => x.playerId === playerId && x.status !== "used") : undefined;
      return q ? { text: q.text, status: q.status } : null;
    })(),
    my,
  };
}

// ---------------------------------------------------------------------------
// Host
// ---------------------------------------------------------------------------
export interface HostView extends BaseView {
  role: "host";
  settings: Settings;
  players: { id: string; nickname: string; score: number; joinedAt: number }[];
  submissions: { id: string; playerId: string; nickname: string; answer: string; hint: string; clue: string | null }[];
  insideJokes: { id: string; answer: string; hint: string }[] | null;
  insideJokeCount: number;
  insideClues: { id: string; clue: string; answer: string; alternates: string[] }[] | null;
  insideClueCount: number;
  /** Most Likely To: host's questions; players' questions for review (no author names — they stay anonymous). */
  customQuestions: { id: string; text: string }[] | null;
  customQuestionCount: number;
  questionSubs: { id: string; text: string }[];
  /** Who Wrote It?: host's questions, players' questions for review (anonymous). */
  customPrompts: { id: string; text: string }[] | null;
  customPromptCount: number;
  promptSubs: { id: string; text: string }[];
  /**
   * Who Wrote It?: the answer on screen and the selected answers still to come —
   * text only, NEVER who wrote them — so the host can skip or remove one first.
   */
  wwiCurrent: { id: string; text: string } | null;
  wwiUpcoming: { id: string; text: string }[];
  estimateMin: number;
  customDares: { id: string; text: string }[];
  progress: { playing: number; solved: number; out: number; total: number } | null;
  rivals: RivalEntry[];
}

export function hostView(s: GameState, now: number): HostView {
  const b = base(s, now);
  const r = s.round;
  const inLobby = s.phase === "lobby";
  let progress: HostView["progress"] = null;
  if (r && s.phase === "round" && r.mode !== "wwi") {
    const list = r.participants.map((id) => r.progress[id]).filter(Boolean);
    progress = {
      playing: list.filter((p) => p.status === "playing").length,
      solved: list.filter((p) => p.status === "solved").length,
      out: list.filter((p) => p.status === "out").length,
      total: list.length,
    };
  }
  return {
    ...b,
    role: "host",
    settings: s.settings,
    players: s.players.filter((p) => !p.removed).map((p) => ({ id: p.id, nickname: p.nickname, score: p.score, joinedAt: p.joinedAt })),
    submissions: inLobby
      ? s.submissions
          .filter((x) => x.status === "pending")
          .map((x) => ({ id: x.id, playerId: x.playerId, nickname: nameOf(s, x.playerId)!, answer: x.answer, hint: x.hint, clue: x.clue ?? null }))
      : [],
    insideJokes: inLobby ? s.insideJokes.map((j) => ({ id: j.id, answer: j.answer, hint: j.hint })) : null,
    insideJokeCount: s.insideJokes.length,
    // The host's own inside clues are only listed before the game starts, so answers never show mid-game.
    insideClues: inLobby ? s.insideClues.map((j) => ({ id: j.id, clue: j.clue, answer: j.answer, alternates: j.alternates })) : null,
    insideClueCount: s.insideClues.length,
    customQuestions: inLobby || s.phase === "ended" ? s.customQuestions.map((q) => ({ id: q.id, text: q.text })) : null,
    customQuestionCount: s.customQuestions.length,
    questionSubs: inLobby ? s.questionSubs.filter((q) => q.status === "pending").map((q) => ({ id: q.id, text: q.text })) : [],
    customPrompts: inLobby || s.phase === "ended" ? s.customPrompts.map((q) => ({ id: q.id, text: q.text })) : null,
    customPromptCount: s.customPrompts.length,
    promptSubs: inLobby ? s.promptSubs.filter((q) => q.status === "pending").map((q) => ({ id: q.id, text: q.text })) : [],
    ...hostWwi(s),
    estimateMin: estimateMinutes(s.settings),
    customDares: s.customDares.map((d) => ({ id: d.id, text: d.text })),
    progress,
    rivals: s.phase === "lobby" ? [] : rivalsFor(s, now, true),
  };
}

function hostWwi(s: GameState): Pick<HostView, "wwiCurrent" | "wwiUpcoming"> {
  const r = s.round;
  const w = r?.wwi;
  if (s.phase !== "round" || !r || r.mode !== "wwi" || !w || r.endedAt) return { wwiCurrent: null, wwiUpcoming: [] };
  const textOf = (answerId: string) => Object.values(w.answers).find((a) => a.id === answerId)?.text ?? "";
  const cur = w.stage === "guessing" ? w.current : null;
  const upcoming = Math.max(0, w.total - w.revealed.length - (w.current ? 1 : 0));
  return {
    wwiCurrent: cur ? { id: cur.answerId, text: cur.text } : null,
    wwiUpcoming: w.stage === "writing" ? [] : w.queue.slice(0, upcoming).map((id) => ({ id, text: textOf(id) })),
  };
}
