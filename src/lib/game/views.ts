// Projections of the server-side GameState for each client role.
// SECURITY: the answer (and hint) may only appear here once the round has
// ended (round.endedAt != null). Unit tests enforce this.
import { CATEGORY_EMOJI, CATEGORY_LABELS } from "@/data/categories";
import { computeAwards, standings, type Award, type Standing } from "./awards";
import { knownLetters, remainingMs } from "./engine";
import { EMOJI, STARTING_LIVES } from "./scoring";
import { answerLetters } from "./answers";
import { maskAnswer, solvedFraction, type MaskCell } from "./text";
import type { CategoryId, GameMode, GameState, Phase, Round, RoundMode, Settings } from "./types";

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
  status: "playing" | "solved" | "out" | "waiting";
  frozen: boolean;
}

export interface RevealView {
  mode: RoundMode;
  answer: string;
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
}

export interface CategoryOption {
  id: CategoryId;
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
  /** The host's Game Mode for this game. */
  mode: GameMode;
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
    /** Players finished (solved or out) / players in the round. */
    answered: { done: number; total: number };
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

export function categoryLabel(c: CategoryId | "friend") {
  return CATEGORY_LABELS[c];
}

export function categoryOption(id: CategoryId): CategoryOption {
  return { id, label: CATEGORY_LABELS[id], emoji: CATEGORY_EMOJI[id] };
}

function nameOf(s: GameState, id: string | null) {
  return id ? (s.players.find((p) => p.id === id)?.nickname ?? "Someone") : null;
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
          answered: {
            done: r.participants.filter((id) => r.progress[id] && r.progress[id].status !== "playing").length,
            total: r.participants.filter((id) => r.progress[id]).length,
          },
          number: r.number,
          kind: r.kind,
          sdAttempt: r.sdAttempt,
          category: categoryLabel(r.category),
          categoryEmoji: CATEGORY_EMOJI[r.category],
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
            answer: r.answer,
            ...revealStats(s, r),
            skipped: r.endReason === "skipped",
            isFriend: r.source === "friend",
            authorId: r.authorId,
            authorName: nameOf(s, r.authorId),
            authorBonus: r.authorBonus,
            stumpedCount: r.stumpedCount,
            sdWinnerId: r.sdWinnerId,
          }
        : null,
    loserPick:
      s.phase === "loserPick" && s.loserPick
        ? {
            playerId: s.loserPick.playerId,
            nickname: nameOf(s, s.loserPick.playerId)!,
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
  lobby: { players: { id: string; nickname: string }[]; submissions: number; friendWords: boolean } | null;
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
            friendWords: s.settings.friendWords,
          }
        : null,
    pattern: r && s.phase !== "lobby" && r.mode !== "emoji" ? (r.endedAt ? maskAnswer(r.answer, new Set("ABCDEFGHIJKLMNOPQRSTUVWXYZ")) : maskAnswer(r.answer, new Set())) : null,
    rivals: s.phase === "lobby" ? [] : rivalsFor(s, now, true),
    reactions: s.reactions.map((x) => ({ id: x.id, emoji: x.emoji, nickname: nameOf(s, x.playerId)!, at: x.at })),
    dareEnabled: s.settings.dareWheel,
  };
}

// ---------------------------------------------------------------------------
// Player phone
// ---------------------------------------------------------------------------
export type MyRoundState = "playing" | "solved" | "out" | "sittingOut" | "waiting";

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
      };
    } else if (!pr) {
      my = { state: "waiting", pattern: null, guessed: [], wrong: [], lives: 0, hint: null, hintUsed: false, frozenUntil: 0, points: 0, freezeTargets: [], maxAttempts: 0, revealedLetters: [] };
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
  customDares: { id: string; text: string }[];
  progress: { playing: number; solved: number; out: number; total: number } | null;
  rivals: RivalEntry[];
}

export function hostView(s: GameState, now: number): HostView {
  const b = base(s, now);
  const r = s.round;
  const inLobby = s.phase === "lobby";
  let progress: HostView["progress"] = null;
  if (r && s.phase === "round") {
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
    customDares: s.customDares.map((d) => ({ id: d.id, text: d.text })),
    progress,
    rivals: s.phase === "lobby" ? [] : rivalsFor(s, now, true),
  };
}
