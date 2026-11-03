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
  key: "speedDemon" | "livesLost" | "hintAddict" | "comebackKid" | "masterStumper";
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
      detail: `Popped ${lives.v} balloon${lives.v === 1 ? "" : "s"}`,
    });

  const hints = best(active, rankOf, (p) => (p.stats.hints > 0 ? p.stats.hints : null), more);
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

  if (s.settings.friendWords) {
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
