import { rankMap } from "./scoring";
import type { GameState, Player } from "./types";

export interface Standing {
  id: string;
  nickname: string;
  score: number;
  rank: number;
}

/** Final/live standings. A sudden-death winner is ranked above tied players. */
export function standings(s: GameState): Standing[] {
  const active = s.players.filter((p) => !p.removed);
  const ranks = rankMap(active.map((p) => ({ id: p.id, score: p.score })));
  const list = active.map((p) => ({ id: p.id, nickname: p.nickname, score: p.score, rank: ranks.get(p.id)! }));
  if (s.winnerId && s.phase === "ended") {
    for (const e of list) if (e.rank === 1 && e.id !== s.winnerId) e.rank = 2;
  }
  return list.sort((a, b) => a.rank - b.rank || b.score - a.score || a.nickname.localeCompare(b.nickname));
}

export interface Award {
  key:
    | "speedDemon"
    | "livesLost"
    | "hintAddict"
    | "comebackKid"
    | "masterStumper"
    | "emojiWhisperer"
    | "crowdFavorite"
    | "mindReader"
    | "mastermind"
    | "undercoverAgent"
    | "openBook"
    | "originalThinker"
    | "blitzMachine";
  title: string;
  emoji: string;
  playerId: string;
  nickname: string;
  detail: string;
}

function best(
  players: Player[],
  rankOf: Map<string, number>,
  value: (p: Player) => number | null,
  better: (a: number, b: number) => boolean,
): { p: Player; v: number } | null {
  let out: { p: Player; v: number } | null = null;
  for (const p of players) {
    const v = value(p);
    if (v == null) continue;
    if (
      !out ||
      better(v, out.v) ||
      (v === out.v && (rankOf.get(p.id) ?? 99) < (rankOf.get(out.p.id) ?? 99))
    )
      out = { p, v };
  }
  return out;
}

export function computeAwards(s: GameState): Award[] {
  const active = s.players.filter((p) => !p.removed);
  const st = standings(s);
  const rankOf = new Map(st.map((e) => [e.id, e.rank]));
  const awards: Award[] = [];
  const more = (a: number, b: number) => a > b;

  const speed = best(active, rankOf, (p) => p.stats.bestSolveMs, (a, b) => a < b);
  if (speed)
    awards.push({
      key: "speedDemon",
      title: "Speed Demon",
      emoji: "⚡",
      playerId: speed.p.id,
      nickname: speed.p.nickname,
      detail: `Solved a word in ${(speed.v / 1000).toFixed(1)}s`,
    });

  const lives = best(active, rankOf, (p) => (p.stats.livesLost > 0 ? p.stats.livesLost : null), more);
  if (lives)
    awards.push({
      key: "livesLost",
      title: "Most Lives Lost",
      emoji: "🎈",
      playerId: lives.p.id,
      nickname: lives.p.nickname,
      detail: s.history.some((h) => (h.mode ?? "hangman") === "hangman")
        ? `Popped ${lives.v} balloon${lives.v === 1 ? "" : "s"}`
        : `Missed ${lives.v} answer${lives.v === 1 ? "" : "s"}`,
    });

  // Hint Addict only makes sense when the game had Hangman rounds (players buy hints there).
  const playedHangman = s.history.some((h) => (h.mode ?? "hangman") === "hangman");
  const hints = playedHangman ? best(active, rankOf, (p) => (p.stats.hints > 0 ? p.stats.hints : null), more) : null;
  if (hints)
    awards.push({
      key: "hintAddict",
      title: "Hint Addict",
      emoji: "💡",
      playerId: hints.p.id,
      nickname: hints.p.nickname,
      detail: `Used ${hints.v} hint${hints.v === 1 ? "" : "s"}`,
    });

  const comeback = best(
    active,
    rankOf,
    (p) => {
      const worst = p.stats.worstRank;
      const fin = rankOf.get(p.id);
      if (worst == null || fin == null) return null;
      const climb = worst - fin;
      return climb > 0 ? climb : null;
    },
    more,
  );
  if (comeback)
    awards.push({
      key: "comebackKid",
      title: "Comeback Kid",
      emoji: "🚀",
      playerId: comeback.p.id,
      nickname: comeback.p.nickname,
      detail: `Climbed ${comeback.v} place${comeback.v === 1 ? "" : "s"}`,
    });

  const whisperer = best(active, rankOf, (p) => ((p.stats.emojiSolves ?? 0) > 0 ? p.stats.emojiSolves : null), more);
  if (whisperer)
    awards.push({
      key: "emojiWhisperer",
      title: "Emoji Whisperer",
      emoji: "🔮",
      playerId: whisperer.p.id,
      nickname: whisperer.p.nickname,
      detail: `Decoded ${whisperer.v} emoji clue${whisperer.v === 1 ? "" : "s"}`,
    });

  // Most Likely To. Every award only appears when someone actually qualifies.
  const crowd = best(active, rankOf, (p) => ((p.stats.crowns ?? 0) > 0 ? p.stats.crowns! : null), more);
  if (crowd)
    awards.push({
      key: "crowdFavorite",
      title: "Crowd Favorite",
      emoji: "👑",
      playerId: crowd.p.id,
      nickname: crowd.p.nickname,
      detail: `Crowned ${crowd.v} time${crowd.v === 1 ? "" : "s"}`,
    });
  const mind = best(active, rankOf, (p) => ((p.stats.correctVotes ?? 0) > 0 ? p.stats.correctVotes! : null), more);
  if (mind)
    awards.push({
      key: "mindReader",
      title: "Mind Reader",
      emoji: "🧠",
      playerId: mind.p.id,
      nickname: mind.p.nickname,
      detail: `Read the room ${mind.v} time${mind.v === 1 ? "" : "s"}`,
    });

  // Who Wrote It?. Hidden when nobody qualifies.
  const master = best(active, rankOf, (p) => ((p.stats.correctGuesses ?? 0) > 0 ? p.stats.correctGuesses! : null), more);
  if (master)
    awards.push({
      key: "mastermind",
      title: "Mastermind",
      emoji: "🕵️",
      playerId: master.p.id,
      nickname: master.p.nickname,
      detail: `Spotted the writer ${master.v} time${master.v === 1 ? "" : "s"}`,
    });
  const agent = best(active, rankOf, (p) => ((p.stats.fooled ?? 0) > 0 ? p.stats.fooled! : null), more);
  if (agent)
    awards.push({
      key: "undercoverAgent",
      title: "Undercover Agent",
      emoji: "🥸",
      playerId: agent.p.id,
      nickname: agent.p.nickname,
      detail: `Fooled ${agent.v} guess${agent.v === 1 ? "" : "es"}`,
    });
  const book = best(active, rankOf, (p) => ((p.stats.timesGuessed ?? 0) > 0 ? p.stats.timesGuessed! : null), more);
  if (book)
    awards.push({
      key: "openBook",
      title: "Open Book",
      emoji: "📖",
      playerId: book.p.id,
      nickname: book.p.nickname,
      detail: `Recognized ${book.v} time${book.v === 1 ? "" : "s"}`,
    });

  // Category Blitz. Hidden when nobody qualifies.
  const original = best(active, rankOf, (p) => ((p.stats.uniqueAnswers ?? 0) > 0 ? p.stats.uniqueAnswers! : null), more);
  if (original)
    awards.push({
      key: "originalThinker",
      title: "Original Thinker",
      emoji: "💡",
      playerId: original.p.id,
      nickname: original.p.nickname,
      detail: `${original.v} answer${original.v === 1 ? "" : "s"} nobody else thought of`,
    });
  const machine = best(active, rankOf, (p) => ((p.stats.validAnswers ?? 0) > 0 ? p.stats.validAnswers! : null), more);
  if (machine)
    awards.push({
      key: "blitzMachine",
      title: "Blitz Machine",
      emoji: "⚡",
      playerId: machine.p.id,
      nickname: machine.p.nickname,
      detail: `${machine.v} valid answer${machine.v === 1 ? "" : "s"}`,
    });

  // Use the settings the game was played with, so editing settings on the
  // game-over screen (before Play Again) doesn't change the awards shown.
  if ((s.startedSettings ?? s.settings).friendWords) {
    const stump = best(active, rankOf, (p) => (p.stats.stumped > 0 ? p.stats.stumped : null), more);
    if (stump)
      awards.push({
        key: "masterStumper",
        title: "Master Stumper",
        emoji: "🧩",
        playerId: stump.p.id,
        nickname: stump.p.nickname,
        detail: `Stumped ${stump.v} friend${stump.v === 1 ? "" : "s"}`,
      });
  }
  return awards;
}
