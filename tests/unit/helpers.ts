import { addPlayer, createGame } from "@/lib/game/engine";
import { seededRandom } from "@/lib/game/ctx";
import { letterSet } from "@/lib/game/text";
import type { Ctx, GameState, Settings } from "@/lib/game/types";

export function harness(opts: { players?: number; seed?: number; settings?: Partial<Settings> } = {}) {
  let now = 1_700_000_000_000;
  let n = 0;
  const random = seededRandom(opts.seed ?? 42);
  const ctx = (): Ctx => ({ now, random, id: () => `id${++n}` });
  const s: GameState = createGame({ roomId: "room-1", code: "ABCDE", now, settings: opts.settings });
  const ids: string[] = [];
  for (let i = 0; i < (opts.players ?? 3); i++) {
    ids.push(addPlayer(s, { nickname: `Player${i + 1}`, tokenHash: `hash${i}` }, ctx()).id);
  }
  return {
    s,
    ids,
    ctx,
    advance(ms: number) {
      now += ms;
    },
    get now() {
      return now;
    },
  };
}

/** Replace the current round's word (tests only). */
export function forceWord(s: GameState, answer: string, hint = "a hint") {
  s.round!.answer = answer;
  s.round!.hint = hint;
}

export function lettersOf(answer: string) {
  return [...letterSet(answer)].sort();
}

export const WRONG_FOR = (answer: string) =>
  "ZQXJKVWYFBGPMHUCDLRSNTOIAE".split("").filter((l) => !letterSet(answer).has(l));

/** Replace the current Emoji Decode round's clue and answer (tests only). */
export function forceClue(s: GameState, clue: string, answer: string, alternates: string[] = []) {
  s.round!.clue = clue;
  s.round!.answer = answer;
  s.round!.alternates = alternates;
}
