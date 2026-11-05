import { describe, expect, it } from "vitest";
import {
  activatePowerup,
  addCustomPrompt,
  addPlayer,
  availableWwiPacks,
  castVote,
  endGame,
  includesWwi,
  next,
  pickCategory,
  removeCustomPrompt,
  removePlayer,
  removePromptSub,
  removeWwiAnswer,
  roundModeFor,
  skipWord,
  skipWwiAnswer,
  startGame,
  submitPrompt,
  submitWwiAnswer,
  suddenDeathMode,
  tick,
  updateSettings,
  wwiGuess,
} from "@/lib/game/engine";
import { computeAwards } from "@/lib/game/awards";
import { hostView, playerView, tvView } from "@/lib/game/views";
import { GameError, type GameState, type Settings } from "@/lib/game/types";
import { harness } from "./helpers";

type H = ReturnType<typeof harness>;
const r13 = (s: string) => s.replace(/[a-z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 97 + 13) % 26) + 97));
const MILD = r13("fuvg");

const wwi = (players = 5, extra: Partial<Settings> = {}, seed = 42) =>
  harness({ players, seed, settings: { mode: "wwi", rounds: 5, answersShown: 3, ...extra } });

const W = (h: H) => h.s.round!.wwi!;
const cur = (h: H) => W(h).current!;
const idx = (h: H, id: string) => h.ids.indexOf(id);
/** Indexes of the players in the current round (not removed). */
const inRound = (h: H) => h.ids.map((_, i) => i).filter((i) => h.s.round!.progress[h.ids[i]] && !h.s.players[i].removed);
const guessers = (h: H) => inRound(h).filter((i) => h.ids[i] !== cur(h).authorId);

function write(h: H, i: number, text = `Answer number ${i + 1}`) {
  h.advance(300);
  return submitWwiAnswer(h.s, h.ids[i], text, h.ctx());
}
function writeAll(h: H, who: number[] = inRound(h)) {
  for (const i of who) write(h, i);
}
function guessAs(h: H, i: number, targetId: string) {
  h.advance(300);
  return wwiGuess(h.s, h.ids[i], targetId, h.ctx());
}
const wrongFor = (h: H, i: number) => cur(h).orders[h.ids[i]].find((id) => id !== cur(h).authorId)!;
/** Start the game, everyone writes, skip the short review pause. */
function toGuessing(h: H) {
  startGame(h.s, h.ctx());
  writeAll(h);
  expect(W(h).stage).toBe("review");
  next(h.s, h.ctx());
  expect(W(h).stage).toBe("guessing");
}
function nextRound(h: H) {
  if (h.s.phase === "round") skipWord(h.s, h.ctx());
  next(h.s, h.ctx());
  while (h.s.phase === "loserPick" || h.s.phase === "dare") next(h.s, h.ctx());
}

describe("mode selection", () => {
  it("is a Game Mode and can be part of Mixed; Hangman stays the default", () => {
    const h = harness({ players: 4 });
    expect(h.s.settings.mode).toBe("hangman");
    expect(includesWwi(h.s)).toBe(false);
    updateSettings(h.s, { mode: "wwi" });
    expect(includesWwi(h.s)).toBe(true);
    updateSettings(h.s, { mode: "mixed", mixedModes: ["hangman", "emoji", "mlt", "wwi"] });
    expect(includesWwi(h.s)).toBe(true);
    expect([1, 2, 3, 4, 5].map((n) => roundModeFor(h.s, n))).toEqual(["hangman", "emoji", "mlt", "wwi", "hangman"]);
  });

  it("needs at least 4 active players to start a Who Wrote It? game", () => {
    const h = wwi(3);
    expect(() => startGame(h.s, h.ctx())).toThrow(/at least 4 players/);
    addPlayer(h.s, { nickname: "Dee", tokenHash: "hd" }, h.ctx());
    startGame(h.s, h.ctx());
    expect(h.s.round!.mode).toBe("wwi");
    expect(W(h).stage).toBe("writing");
    expect(h.s.round!.durationMs).toBe(45_000); // default writing timer
    expect(h.s.round!.question).toMatch(/\?$/);
  });

  it("Mixed skips Who Wrote It? rounds while fewer than 4 players are active", () => {
    const h = harness({ players: 3, settings: { mode: "mixed", mixedModes: ["hangman", "wwi"], rounds: 5 } });
    expect(roundModeFor(h.s, 2)).toBe("hangman");
    addPlayer(h.s, { nickname: "Dee", tokenHash: "hd" }, h.ctx());
    expect(roundModeFor(h.s, 2)).toBe("wwi");
    const both = harness({ players: 3, settings: { mode: "mixed", mixedModes: ["mlt", "wwi"], rounds: 5 } });
    expect(roundModeFor(both.s, 2)).toBe("mlt"); // MLT only needs 3
  });

  it("a Who Wrote It?-only game holds and tells the host when it drops below 4 players", () => {
    const h = wwi(4);
    startGame(h.s, h.ctx());
    removePlayer(h.s, h.ids[3], h.ctx());
    expect(h.s.phase).toBe("round"); // the current question carries on
    skipWord(h.s, h.ctx());
    next(h.s, h.ctx());
    expect(h.s.hold).toBe("needPlayers");
    expect(h.s.holdMin).toBe(4);
    expect(tvView(h.s, h.now).holdMin).toBe(4);
    expect(h.s.phase).toBe("reveal");
    addPlayer(h.s, { nickname: "Eve", tokenHash: "he" }, h.ctx());
    next(h.s, h.ctx());
    while (h.s.phase === "loserPick") next(h.s, h.ctx());
    expect(h.s.phase).toBe("round");
    expect(h.s.hold).toBeNull();
    expect(h.s.round!.participants).toHaveLength(4);
  });

  it("uses the chosen packs and timers, and word-game actions are rejected", () => {
    const h = wwi(4, { wwiPacks: ["chaos"], writeSec: 30, guessSec: 10 });
    startGame(h.s, h.ctx());
    expect(h.s.round!.category).toBe("chaos");
    expect(h.s.round!.durationMs).toBe(30_000);
    writeAll(h);
    next(h.s, h.ctx());
    expect(h.s.round!.durationMs).toBe(10_000);
    expect(() => castVote(h.s, h.ids[0], h.ids[1], h.ctx())).toThrow(/no vote/);
  });
});

describe("writing", () => {
  it("one answer per player; it locks once submitted", () => {
    const h = wwi(4);
    startGame(h.s, h.ctx());
    expect(write(h, 0, "  Pizza   for breakfast ")).toEqual({ locked: true });
    expect(() => write(h, 0, "Changed my mind")).toThrow(/locked/);
    expect(Object.values(W(h).answers).map((a) => a.text)).toEqual(["Pizza for breakfast"]);
    const me = playerView(h.s, h.ids[0], h.now).my!.wwi!;
    expect(me).toMatchObject({ submitted: true, myAnswer: "Pizza for breakfast" });
    expect(playerView(h.s, h.ids[1], h.now).my!.wwi!).toMatchObject({ submitted: false, myAnswer: null });
  });

  it("validates answers (80 characters, content level) and allows emojis", () => {
    const h = wwi(4);
    startGame(h.s, h.ctx());
    expect(() => write(h, 0, "x".repeat(81))).toThrow(/80 characters/);
    expect(() => write(h, 0, "   ")).toThrow(/Write an answer/);
    expect(() => write(h, 0, `${MILD} happens`)).toThrow(/isn't allowed/); // Clean
    write(h, 0, "🍕🍕 pizza party 👨‍👩‍👧");
    const pg = wwi(4, { content: "pg13" });
    startGame(pg.s, pg.ctx());
    expect(write(pg, 0, `${MILD} happens`)).toEqual({ locked: true }); // PG-13 is looser
  });

  it("ends early when every active player has written, otherwise on the timer", () => {
    const h = wwi(4);
    startGame(h.s, h.ctx());
    writeAll(h, [0, 1, 2]);
    expect(W(h).stage).toBe("writing");
    h.advance(45_000);
    tick(h.s, h.ctx());
    expect(W(h).stage).toBe("review");
    expect(W(h).total).toBe(3);
    const tv = tvView(h.s, h.now).round!.wwi!;
    expect(tv).toMatchObject({ stage: "review", submitted: 3, writers: 4, total: 3 });
  });

  it("if nobody writes, no points and the host moves on", () => {
    const h = wwi(4);
    startGame(h.s, h.ctx());
    h.advance(45_000);
    tick(h.s, h.ctx());
    expect(h.s.phase).toBe("reveal");
    expect(tvView(h.s, h.now).reveal!.wwi).toEqual({ answers: [], noAnswers: true });
    expect(h.s.players.every((p) => p.score === 0)).toBe(true);
    nextRound(h);
    expect(h.s.round!.number).toBe(2);
  });

  it("writing and guessing are blocked while paused and for players not in the question", () => {
    const h = wwi(4);
    startGame(h.s, h.ctx());
    const late = addPlayer(h.s, { nickname: "Late", tokenHash: "hl" }, h.ctx());
    expect(() => submitWwiAnswer(h.s, late.id, "Hi there", h.ctx())).toThrow(/next question/);
    h.s.paused = true;
    expect(() => write(h, 0)).toThrow(/paused/);
  });
});

describe("answer selection", () => {
  it("shows the host's chosen number of answers", () => {
    const h = wwi(6, { answersShown: 3 });
    toGuessing(h);
    expect(W(h).total).toBe(3);
    expect(W(h).queue).toHaveLength(5 - 0); // 2 more selected + 3 reserves
    const seen = new Set<string>();
    for (let k = 0; k < 3; k++) {
      expect(W(h).stage).toBe("guessing");
      seen.add(cur(h).authorId);
      h.advance(15_000);
      tick(h.s, h.ctx()); // guessing timer → author reveal
      expect(W(h).stage).toBe("answerReveal");
      h.advance(6_000);
      tick(h.s, h.ctx()); // → next answer or the round leaderboard
    }
    expect(seen.size).toBe(3);
    expect(h.s.phase).toBe("reveal");
    expect(tvView(h.s, h.now).reveal!.wwi!.answers).toHaveLength(3);
  });

  it("shows every answer when fewer were written than selected", () => {
    const h = wwi(4, { answersShown: 5 });
    startGame(h.s, h.ctx());
    writeAll(h, [0, 1]);
    h.advance(45_000);
    tick(h.s, h.ctx());
    expect(W(h).total).toBe(2);
  });

  it("favors players whose answers have been shown least", () => {
    const h = wwi(6, { answersShown: 3, rounds: 10 });
    startGame(h.s, h.ctx());
    const shownBy = new Map<string, number>();
    for (let round = 0; round < 4; round++) {
      writeAll(h);
      while (h.s.phase === "round") {
        if (W(h).stage === "guessing") shownBy.set(cur(h).authorId, (shownBy.get(cur(h).authorId) ?? 0) + 1);
        h.advance(20_000);
        tick(h.s, h.ctx());
      }
      nextRound(h);
    }
    // 4 rounds × 3 answers = 12 shown across 6 players: exactly 2 each.
    expect([...shownBy.values()].sort()).toEqual([2, 2, 2, 2, 2, 2]);
    expect(Object.values(h.s.wwiShownCount).sort()).toEqual([2, 2, 2, 2, 2, 2]);
  });

  it("answers that weren't selected are dropped when the round ends", () => {
    const h = wwi(5, { answersShown: 1 });
    toGuessing(h);
    expect(Object.keys(W(h).answers)).toHaveLength(5);
    skipWord(h.s, h.ctx());
    expect(W(h).answers).toEqual({});
    expect(W(h).queue).toEqual([]);
    expect(W(h).current).toBeNull();
  });
});

describe("choices", () => {
  it("each guesser gets the author plus 3 others, never themselves, in their own order", () => {
    const h = wwi(8, {}, 7);
    toGuessing(h);
    const c = cur(h);
    expect(Object.keys(c.orders).sort()).toEqual(guessers(h).map((i) => h.ids[i]).sort());
    const orders = Object.entries(c.orders);
    for (const [g, list] of orders) {
      expect(list).toHaveLength(4);
      expect(list).toContain(c.authorId);
      expect(list).not.toContain(g);
      expect(new Set(list).size).toBe(4);
    }
    // The author isn't always in the same spot.
    expect(new Set(orders.map(([, list]) => list.indexOf(c.authorId))).size).toBeGreaterThan(1);
  });

  it("with exactly 4 players, everyone else is a choice", () => {
    const h = wwi(4);
    toGuessing(h);
    for (const i of guessers(h)) expect([...cur(h).orders[h.ids[i]]].sort()).toEqual(h.ids.filter((id) => id !== h.ids[i]).sort());
  });

  it("the phone shows names, and the author's spot is spread evenly over many answers", () => {
    const spots = [0, 0, 0, 0];
    for (let seed = 1; seed <= 60; seed++) {
      const h = wwi(6, { answersShown: 1 }, seed);
      toGuessing(h);
      const g = guessers(h)[0];
      const my = playerView(h.s, h.ids[g], h.now).my!.wwi!;
      expect(my.choices.map((c) => c.nickname)).toEqual(my.choices.map((c) => h.s.players[idx(h, c.id)].nickname));
      spots[my.choices.findIndex((c) => c.id === cur(h).authorId)] += 1;
    }
    for (const n of spots) expect(n).toBeGreaterThan(5);
  });
});

describe("the author sits out", () => {
  it("sees their answer is on screen and can't guess or use power-ups", () => {
    const h = wwi(5);
    toGuessing(h);
    const a = idx(h, cur(h).authorId);
    const my = playerView(h.s, h.ids[a], h.now).my!.wwi!;
    expect(my).toMatchObject({ isAuthor: true, choices: [], picks: [] });
    expect(playerView(h.s, h.ids[a], h.now).my!.freezeTargets).toEqual([]);
    expect(() => guessAs(h, a, h.ids[(a + 1) % 5])).toThrow(/straight face/);
    expect(() => activatePowerup(h.s, h.ids[a], "extraLife", null, h.ctx())).toThrow(/straight face/);
    // Everyone else can guess.
    const g = guessers(h)[0];
    expect(playerView(h.s, h.ids[g], h.now).my!.wwi!).toMatchObject({ isAuthor: false, pickLimit: 1 });
    expect(playerView(h.s, h.ids[g], h.now).my!.wwi!.choices).toHaveLength(4);
  });

  it("the guessing stage ends once every other player has guessed", () => {
    const h = wwi(5);
    toGuessing(h);
    const gs = guessers(h);
    for (const g of gs.slice(0, -1)) guessAs(h, g, cur(h).authorId);
    expect(W(h).stage).toBe("guessing");
    expect(tvView(h.s, h.now).round!.wwi).toMatchObject({ guessed: 3, guessers: 4 });
    guessAs(h, gs[gs.length - 1], cur(h).authorId);
    expect(W(h).stage).toBe("answerReveal");
  });
});

describe("guessing", () => {
  it("one guess per answer, only from the names on your screen, never echoed back", () => {
    const h = wwi(6);
    toGuessing(h);
    const [g] = guessers(h);
    const notMine = h.ids.find((id) => !cur(h).orders[h.ids[g]].includes(id))!;
    expect(() => guessAs(h, g, notMine)).toThrow(/names on your screen/);
    expect(guessAs(h, g, wrongFor(h, g))).toEqual({ locked: true });
    expect(() => guessAs(h, g, cur(h).authorId)).toThrow(/locked in/);
    expect(playerView(h.s, h.ids[g], h.now).my!.wwi!.picks).toEqual([wrongFor(h, g)]);
  });

  it("rate-limits rapid guesses and answers", () => {
    const h = wwi(5);
    startGame(h.s, h.ctx());
    h.s.players[0].wwiTimes = [h.now, h.now, h.now, h.now, h.now, h.now];
    expect(() => submitWwiAnswer(h.s, h.ids[0], "Too quick", h.ctx())).toThrow(GameError);
    expect(() => submitWwiAnswer(h.s, h.ids[0], "Too quick", h.ctx())).toThrow(/slow down/);
  });
});

describe("scoring", () => {
  function playOne(h: H, plan: (h: H) => void) {
    toGuessing(h);
    const author = cur(h).authorId;
    plan(h);
    if (W(h).stage === "guessing") {
      h.advance(15_000);
      tick(h.s, h.ctx());
    }
    expect(W(h).stage).toBe("answerReveal");
    return author;
  }

  it("+100 for a correct guess, +15 to the author per wrong guess, 0 for wrong or missed", () => {
    const h = wwi(6, { answersShown: 1 });
    let gs: number[] = [];
    const author = playOne(h, (h) => {
      gs = guessers(h);
      guessAs(h, gs[0], cur(h).authorId);
      guessAs(h, gs[1], cur(h).authorId);
      guessAs(h, gs[2], wrongFor(h, gs[2]));
      guessAs(h, gs[3], wrongFor(h, gs[3]));
      // gs[4] misses
    });
    const score = (i: number) => h.s.players[i].score;
    expect([score(gs[0]), score(gs[1]), score(gs[2]), score(gs[3]), score(gs[4])]).toEqual([100, 100, 0, 0, 0]);
    expect(h.s.players[idx(h, author)].score).toBe(30);
    expect(W(h).revealed[0]).toMatchObject({ authorId: author, correct: 2, wrong: 2, guessers: 5 });
    // TV: the author, totals and the updated scores.
    const tv = tvView(h.s, h.now);
    expect(tv.round!.wwi!.revealed).toMatchObject({ authorId: author, correct: 2, wrong: 2 });
    expect(tv.leaderboard.find((e) => e.id === author)!.score).toBe(30);
    // Phones: each player's own result.
    const res = (i: number) => playerView(h.s, h.ids[i], h.now).my!.wwi!;
    expect(res(gs[0]).result).toBe("correct");
    expect(res(gs[2]).result).toBe("wrong");
    expect(res(gs[4]).result).toBe("missed");
    expect(res(idx(h, author))).toMatchObject({ result: "author", fooled: 2 });
    expect(res(gs[0]).fooled).toBeNull();
    // After the last answer, the leaderboard waits for the host.
    h.advance(6_000);
    tick(h.s, h.ctx());
    expect(h.s.phase).toBe("reveal");
  });

  it("missed guesses don't count as fooled", () => {
    const h = wwi(5, { answersShown: 1 });
    const author = playOne(h, () => {});
    expect(h.s.players[idx(h, author)].score).toBe(0);
    expect(h.s.players.every((p) => p.score === 0)).toBe(true);
  });

  it("doubles everything in the final round", () => {
    const h = wwi(5, { answersShown: 1, rounds: 5 });
    startGame(h.s, h.ctx());
    for (let n = 1; n < 5; n++) nextRound(h);
    expect(h.s.round!.kind).toBe("final");
    writeAll(h);
    next(h.s, h.ctx());
    const author = cur(h).authorId;
    const gs = guessers(h);
    guessAs(h, gs[0], author);
    guessAs(h, gs[1], wrongFor(h, gs[1]));
    h.advance(15_000);
    tick(h.s, h.ctx());
    expect(h.s.players[gs[0]].score).toBe(200);
    expect(h.s.players[idx(h, author)].score).toBe(30);
  });

  it("scores carry over on the shared leaderboard and history", () => {
    const h = wwi(5, { answersShown: 1 });
    toGuessing(h);
    const g = guessers(h)[0];
    guessAs(h, g, cur(h).authorId);
    h.advance(20_000);
    tick(h.s, h.ctx());
    h.advance(6_000);
    tick(h.s, h.ctx());
    expect(h.s.history).toHaveLength(1);
    expect(h.s.history[0]).toMatchObject({ mode: "wwi", answer: h.s.round!.question });
    expect(h.s.history[0].results[h.ids[g]]).toMatchObject({ points: 100, solved: true });
    expect(tvView(h.s, h.now).leaderboard[0]).toMatchObject({ id: h.ids[g], score: 100, roundPoints: 100 });
  });
});

describe("power-ups", () => {
  it("Freeze locks a rival's guess buttons for 5s, but never in the final 5 seconds", () => {
    const h = wwi(5);
    toGuessing(h);
    const [a, b] = guessers(h);
    activatePowerup(h.s, h.ids[a], "freeze", h.ids[b], h.ctx());
    expect(() => guessAs(h, b, cur(h).authorId)).toThrow(/frozen/);
    expect(playerView(h.s, h.ids[b], h.now).my!.frozenUntil).toBeGreaterThan(h.now);
    h.advance(5_000);
    guessAs(h, b, cur(h).authorId);
    expect(() => activatePowerup(h.s, h.ids[a], "freeze", h.ids[b], h.ctx())).toThrow(/already frozen/);
    h.advance(5_000); // under 5s left
    const c = guessers(h)[2];
    expect(() => activatePowerup(h.s, h.ids[a], "freeze", h.ids[c], h.ctx())).toThrow(/final 5 seconds/);
    expect(playerView(h.s, h.ids[a], h.now).my!.freezeTargets).toEqual([]);
  });

  it("freezing the author or someone who already guessed looks exactly like any other freeze", () => {
    const h = wwi(5);
    toGuessing(h);
    const [a, b] = guessers(h);
    const author = cur(h).authorId;
    const targets = playerView(h.s, h.ids[a], h.now).my!.freezeTargets.map((t) => t.id);
    expect(targets).toContain(author); // the list never hints at who wrote it
    expect(targets).toHaveLength(4);
    guessAs(h, b, author);
    expect(() => activatePowerup(h.s, h.ids[a], "freeze", author, h.ctx())).not.toThrow();
    h.advance(300);
    expect(() => activatePowerup(h.s, h.ids[a], "freeze", h.ids[b], h.ctx())).not.toThrow();
    expect(h.s.players[a].powerupsLeft).toBe(0);
  });

  it("Eliminate Two removes two wrong names (the author always stays)", () => {
    const h = wwi(6);
    toGuessing(h);
    const [g] = guessers(h);
    activatePowerup(h.s, h.ids[g], "reveal", null, h.ctx());
    const my = playerView(h.s, h.ids[g], h.now).my!.wwi!;
    expect(my.eliminated).toBe(true);
    expect(my.choices).toHaveLength(2);
    expect(my.choices.map((c) => c.id)).toContain(cur(h).authorId);
    const gone = cur(h).eliminated[h.ids[g]];
    expect(() => guessAs(h, g, gone[0])).toThrow(/names on your screen/);
    expect(() => activatePowerup(h.s, h.ids[g], "extraLife", null, h.ctx())).toThrow(/One boost per answer/);
  });

  it("Eliminate Two keeps at least two names with 4 players", () => {
    const h = wwi(4);
    toGuessing(h);
    const [g] = guessers(h);
    activatePowerup(h.s, h.ids[g], "reveal", null, h.ctx());
    expect(playerView(h.s, h.ids[g], h.now).my!.wwi!.choices).toHaveLength(2);
  });

  it("Double Guess allows two picks; correct if either is the author", () => {
    const h = wwi(6, { answersShown: 1 });
    toGuessing(h);
    const [g, other] = guessers(h);
    activatePowerup(h.s, h.ids[g], "extraLife", null, h.ctx());
    expect(playerView(h.s, h.ids[g], h.now).my!.wwi!).toMatchObject({ doubleGuess: true, pickLimit: 2 });
    expect(guessAs(h, g, wrongFor(h, g))).toEqual({ locked: false });
    expect(() => guessAs(h, g, wrongFor(h, g))).toThrow(/already picked/);
    expect(guessAs(h, g, cur(h).authorId)).toEqual({ locked: true });
    expect(() => guessAs(h, g, wrongFor(h, g))).toThrow(/locked in/);
    guessAs(h, other, wrongFor(h, other));
    h.advance(20_000);
    tick(h.s, h.ctx());
    expect(h.s.players[g].score).toBe(100);
  });

  it("power-ups must be used before guessing, and keep the 2-per-game limit", () => {
    const h = wwi(5);
    toGuessing(h);
    const [g, x, y] = guessers(h);
    guessAs(h, g, wrongFor(h, g));
    expect(() => activatePowerup(h.s, h.ids[g], "reveal", null, h.ctx())).toThrow(/before you guess/);
    activatePowerup(h.s, h.ids[x], "freeze", h.ids[y], h.ctx());
    h.advance(300);
    activatePowerup(h.s, h.ids[x], "extraLife", null, h.ctx());
    h.advance(300);
    expect(() => activatePowerup(h.s, h.ids[x], "freeze", h.ids[g], h.ctx())).toThrow(/both power-ups/);
  });

  it("power-ups only work while an answer is on screen", () => {
    const h = wwi(5);
    startGame(h.s, h.ctx());
    expect(() => activatePowerup(h.s, h.ids[0], "extraLife", null, h.ctx())).toThrow(/answer is on screen/);
  });
});

describe("host controls", () => {
  it("the host sees selected answers without authors and can remove one before it appears", () => {
    const h = wwi(5, { answersShown: 3 });
    startGame(h.s, h.ctx());
    writeAll(h);
    const hv = hostView(h.s, h.now);
    expect(hv.wwiUpcoming).toHaveLength(3);
    expect(JSON.stringify(hv.wwiUpcoming)).not.toMatch(/author|playerId|nickname/);
    const first = hv.wwiUpcoming[0];
    removeWwiAnswer(h.s, first.id, h.ctx());
    const after = hostView(h.s, h.now).wwiUpcoming;
    expect(after).toHaveLength(3); // a reserve answer took its place
    expect(after.map((a) => a.id)).not.toContain(first.id);
    expect(Object.values(W(h).answers).map((a) => a.text)).not.toContain(first.text);
    // Removed answers never reach the TV.
    while (h.s.phase === "round") {
      expect(JSON.stringify(tvView(h.s, h.now))).not.toContain(first.text);
      h.advance(20_000);
      tick(h.s, h.ctx());
    }
    expect(tvView(h.s, h.now).reveal!.wwi!.answers).toHaveLength(3);
  });

  it("with no answers left to swap in, removing one shows fewer", () => {
    const h = wwi(4, { answersShown: 3 });
    startGame(h.s, h.ctx());
    writeAll(h, [0, 1, 2]);
    h.advance(45_000);
    tick(h.s, h.ctx());
    removeWwiAnswer(h.s, hostView(h.s, h.now).wwiUpcoming[1].id, h.ctx());
    expect(W(h).total).toBe(2);
    expect(() => removeWwiAnswer(h.s, "nope", h.ctx())).toThrow(/isn't waiting/);
  });

  it("skipping the answer on screen gives no points and brings in a replacement", () => {
    const h = wwi(5, { answersShown: 1 });
    toGuessing(h);
    const first = cur(h);
    const [g] = guessers(h);
    activatePowerup(h.s, h.ids[g], "extraLife", null, h.ctx());
    guessAs(h, g, first.authorId);
    expect(hostView(h.s, h.now).wwiCurrent).toEqual({ id: first.answerId, text: first.text });
    skipWwiAnswer(h.s, h.ctx());
    expect(h.s.players[g].powerupsLeft).toBe(2); // refunded
    expect(W(h).stage).toBe("guessing");
    expect(cur(h).answerId).not.toBe(first.answerId);
    expect(W(h).revealed).toEqual([]);
    expect(h.s.players.every((p) => p.score === 0)).toBe(true);
    // The skipped author is never revealed.
    expect(JSON.stringify(tvView(h.s, h.now))).not.toContain(first.text);
  });

  it("skipping the whole question before any reveal: no points, nothing recorded", () => {
    const h = wwi(5);
    toGuessing(h);
    const [g] = guessers(h);
    guessAs(h, g, cur(h).authorId);
    skipWord(h.s, h.ctx());
    expect(h.s.phase).toBe("reveal");
    expect(h.s.players.every((p) => p.score === 0)).toBe(true);
    expect(h.s.history).toEqual([]);
    expect(tvView(h.s, h.now).reveal!.skipped).toBe(true);
  });

  it("Next moves on from an author reveal right away; it can't cut the guessing short", () => {
    const h = wwi(5);
    toGuessing(h);
    expect(() => next(h.s, h.ctx())).toThrow(/still running/);
    for (const g of guessers(h)) guessAs(h, g, cur(h).authorId);
    expect(W(h).stage).toBe("answerReveal");
    next(h.s, h.ctx());
    expect(W(h).stage).toBe("guessing");
    expect(W(h).revealed).toHaveLength(1);
  });

  it("pause stops the stage timer", () => {
    const h = wwi(5);
    toGuessing(h);
    hostAction(h, "pause");
    h.advance(60_000);
    tick(h.s, h.ctx());
    expect(W(h).stage).toBe("guessing");
    hostAction(h, "resume");
    h.advance(15_000);
    tick(h.s, h.ctx());
    expect(W(h).stage).toBe("answerReveal");
  });
});

function hostAction(h: H, action: "pause" | "resume") {
  if (action === "pause") {
    h.s.round!.pausedRemainingMs = Math.max(0, h.s.round!.deadline - h.now);
    h.s.paused = true;
  } else {
    const rem = h.s.round!.pausedRemainingMs ?? 0;
    h.s.round!.deadline = h.now + rem;
    h.s.round!.pausedRemainingMs = null;
    h.s.paused = false;
  }
}

describe("custom and friend-written questions", () => {
  it("host questions form the Host's Questions pack", () => {
    const h = wwi(4, { wwiPacks: ["chaos"] });
    addCustomPrompt(h.s, "What would our group's theme song be?", h.ctx());
    expect(h.s.settings.wwiPacks).toEqual(["chaos", "custom"]);
    expect(() => addCustomPrompt(h.s, "What would our group's THEME SONG be?", h.ctx())).toThrow(/already/);
    updateSettings(h.s, { wwiPacks: ["custom"] });
    startGame(h.s, h.ctx());
    expect(h.s.round!.question).toBe("What would our group's theme song be?");
    expect(h.s.round!.category).toBe("custom");
    const g = wwi(4);
    addCustomPrompt(g.s, "What would our group's theme song be?", g.ctx());
    removeCustomPrompt(g.s, g.s.customPrompts[0].id);
    expect(g.s.settings.wwiPacks).not.toContain("custom");
  });

  it("friend questions fill about a third of the rounds, stay anonymous and give no author points", () => {
    const h = wwi(5, { friendWords: true, rounds: 5 });
    const texts = ["What is the best snack for a road trip?", "What would you name a pet rock?", "What song gets you hyped instantly?"];
    texts.forEach((t, i) => submitPrompt(h.s, h.ids[i], t, h.ctx()));
    submitPrompt(h.s, h.ids[3], "What is the worst possible pizza topping?", h.ctx());
    removePromptSub(h.s, h.s.promptSubs[3].id); // host removed it
    expect(hostView(h.s, h.now).promptSubs.map((q) => q.text)).toEqual(texts);
    expect(JSON.stringify(hostView(h.s, h.now).promptSubs)).not.toMatch(/playerId|Player\d/);
    startGame(h.s, h.ctx());
    expect(h.s.wwiRoundPlan).toHaveLength(2); // round(5 / 3)
    const used: string[] = [];
    for (let n = 1; n <= 5; n++) {
      if (h.s.round!.category === "friend") {
        used.push(h.s.round!.question!);
        expect(h.s.round!.authorId).toBeNull();
        const tv = JSON.stringify(tvView(h.s, h.now));
        expect(tv).not.toMatch(/authorName":"Player/);
      }
      if (n < 5) nextRound(h);
    }
    expect(used).toHaveLength(2);
    for (const q of used) expect(texts).toContain(q);
  });

  it("player questions need friend-written rounds on and a game that includes Who Wrote It?", () => {
    const h = wwi(4);
    expect(() => submitPrompt(h.s, h.ids[0], "What is the best snack ever?", h.ctx())).toThrow(/turned off/);
    updateSettings(h.s, { friendWords: true, mode: "hangman" });
    expect(() => submitPrompt(h.s, h.ids[0], "What is the best snack ever?", h.ctx())).toThrow(/only used/);
  });

  it("never repeats a question within a game", () => {
    const h = wwi(4, { wwiPacks: ["habits"], rounds: 20 });
    startGame(h.s, h.ctx());
    const qs = new Set<string>();
    for (let n = 1; n <= 20; n++) {
      qs.add(h.s.round!.question!);
      if (n < 20) nextRound(h);
    }
    expect(qs.size).toBe(20);
  });
});

describe("late joining", () => {
  it("joins with 0 points from the next question, and only becomes a choice after writing", () => {
    const h = wwi(4, { answersShown: 5 });
    startGame(h.s, h.ctx());
    const late = addPlayer(h.s, { nickname: "Late", tokenHash: "hl" }, h.ctx());
    expect(late.score).toBe(0);
    expect(playerView(h.s, late.id, h.now).my!.state).toBe("waiting");
    nextRound(h);
    // Round 2: Late plays but doesn't write — they're never offered as a choice.
    expect(h.s.round!.participants).toContain(late.id);
    writeAll(h, [0, 1, 2, 3]);
    h.advance(45_000);
    tick(h.s, h.ctx());
    while (h.s.phase === "round") {
      if (W(h).stage === "guessing") for (const list of Object.values(cur(h).orders)) expect(list).not.toContain(late.id);
      h.advance(20_000);
      tick(h.s, h.ctx());
    }
    nextRound(h);
    // Round 3: Late writes, so from now on they can be a choice.
    writeAll(h);
    submitWwiAnswer(h.s, late.id, "Late but great", h.ctx());
    expect(h.s.wwiWriters).toContain(late.id);
    let offered = false;
    const live = () => h.s.phase === "round";
    while (live()) {
      if (W(h).stage === "guessing" && Object.values(cur(h).orders).some((l) => l.includes(late.id))) offered = true;
      h.advance(20_000);
      tick(h.s, h.ctx());
    }
    expect(offered).toBe(true);
  });
});

describe("player removal", () => {
  it("removed players can't write or guess, and their unrevealed answer leaves the selection", () => {
    const h = wwi(6, { answersShown: 5 });
    startGame(h.s, h.ctx());
    writeAll(h);
    const queued = W(h).queue.length;
    removePlayer(h.s, h.ids[5], h.ctx());
    expect(W(h).queue).toHaveLength(queued - 1);
    expect(W(h).total).toBe(5);
    expect(() => write(h, 5)).toThrow(/not in this game/);
    next(h.s, h.ctx());
    for (const list of Object.values(cur(h).orders)) expect(list).not.toContain(h.ids[5]);
    expect(Object.keys(cur(h).orders)).not.toContain(h.ids[5]);
  });

  it("removing the author of the answer on screen skips it (no points) and shows the next one", () => {
    const h = wwi(5, { answersShown: 3 });
    toGuessing(h);
    const first = cur(h);
    for (const g of guessers(h).slice(0, 2)) guessAs(h, g, first.authorId);
    removePlayer(h.s, first.authorId, h.ctx());
    expect(W(h).stage).toBe("guessing");
    expect(cur(h).authorId).not.toBe(first.authorId);
    expect(h.s.players.every((p) => p.score === 0)).toBe(true);
    expect(W(h).total).toBe(3); // a reserve answer took its place
  });

  it("removing a guesser can finish the guessing stage", () => {
    const h = wwi(5);
    toGuessing(h);
    const gs = guessers(h);
    for (const g of gs.slice(0, -1)) guessAs(h, g, cur(h).authorId);
    removePlayer(h.s, h.ids[gs[gs.length - 1]], h.ctx());
    expect(W(h).stage).toBe("answerReveal");
  });
});

describe("Sudden Death, Loser Picks, Dare Wheel and awards", () => {
  it("Who Wrote It?-only ties go to a vote by the other players; games with word rounds keep theirs", () => {
    const h = wwi(5, { rounds: 5 });
    startGame(h.s, h.ctx());
    for (let i = 1; i < 5; i++) nextRound(h);
    skipWord(h.s, h.ctx());
    [300, 300, 100, 50, 0].forEach((sc, i) => (h.s.players[i].score = sc));
    next(h.s, h.ctx());
    const r = h.s.round!;
    expect(r.kind).toBe("suddenDeath");
    expect(r.mode).toBe("mlt");
    expect(r.candidates).toEqual([h.ids[0], h.ids[1]]);
    expect(r.participants).toEqual([h.ids[2], h.ids[3], h.ids[4]]);
    const set = (mixedModes: Settings["mixedModes"]) => harness({ players: 4, settings: { mode: "mixed", mixedModes } }).s;
    expect(suddenDeathMode(set(["mlt", "wwi"]))).toBe("mlt");
    expect(suddenDeathMode(set(["hangman", "wwi"]))).toBe("hangman");
    expect(suddenDeathMode(set(["emoji", "wwi"]))).toBe("emoji");
  });

  it("the lowest scorer picks the next question pack", () => {
    const h = wwi(5, { answersShown: 1 });
    toGuessing(h);
    for (const g of guessers(h).slice(0, 2)) guessAs(h, g, cur(h).authorId);
    h.advance(20_000);
    tick(h.s, h.ctx());
    h.advance(6_000);
    tick(h.s, h.ctx());
    next(h.s, h.ctx());
    expect(h.s.phase).toBe("loserPick");
    const lp = h.s.loserPick!;
    expect(lp.kind).toBe("pack");
    expect(lp.options).toEqual(availableWwiPacks(h.s));
    expect(tvView(h.s, h.now).loserPick!.options.map((o) => o.label)).toContain("Hypotheticals");
    pickCategory(h.s, lp.playerId, "hypotheticals", h.ctx());
    expect(h.s.round!.category).toBe("hypotheticals");
  });

  it("the Dare Wheel works between Who Wrote It? rounds", () => {
    const h = wwi(4, { dareWheel: true, dareEvery: 2 });
    startGame(h.s, h.ctx());
    nextRound(h);
    skipWord(h.s, h.ctx());
    next(h.s, h.ctx());
    expect(h.s.phase).toBe("dare");
    next(h.s, h.ctx());
    while (h.s.phase === "loserPick") next(h.s, h.ctx());
    expect(h.s.round!.mode).toBe("wwi");
  });

  it("Mastermind, Undercover Agent and Open Book; hidden without qualifying data", () => {
    const h = wwi(5, { answersShown: 1 });
    toGuessing(h);
    const author = cur(h).authorId;
    const gs = guessers(h);
    guessAs(h, gs[0], author);
    guessAs(h, gs[1], wrongFor(h, gs[1]));
    guessAs(h, gs[2], wrongFor(h, gs[2]));
    h.advance(20_000);
    tick(h.s, h.ctx());
    endGame(h.s, h.ctx());
    const awards = computeAwards(h.s);
    expect(awards.find((a) => a.key === "mastermind")).toMatchObject({ playerId: h.ids[gs[0]] });
    expect(awards.find((a) => a.key === "undercoverAgent")).toMatchObject({ playerId: author, detail: "Fooled 2 guesses" });
    expect(awards.find((a) => a.key === "openBook")).toMatchObject({ playerId: author });
    const none = wwi(4);
    startGame(none.s, none.ctx());
    endGame(none.s, none.ctx());
    expect(computeAwards(none.s).map((a) => a.key)).not.toEqual(expect.arrayContaining(["mastermind"]));
    expect(computeAwards(none.s).filter((a) => ["mastermind", "undercoverAgent", "openBook"].includes(a.key))).toEqual([]);
  });
});

describe("refresh restores everything", () => {
  it("a fresh view carries the stage, question, answer, timer, status, choices, power-ups and score", () => {
    const h = wwi(5);
    startGame(h.s, h.ctx());
    write(h, 0, "Tacos forever");
    let v = playerView(h.s, h.ids[0], h.now);
    expect(v.round).toMatchObject({ mode: "wwi", question: h.s.round!.question });
    expect(v.round!.wwi).toMatchObject({ stage: "writing", submitted: 1, writers: 5 });
    expect(v.round!.timer.remainingMs).toBeGreaterThan(0);
    expect(v.my!.wwi).toMatchObject({ submitted: true, myAnswer: "Tacos forever" });
    writeAll(h, [1, 2, 3, 4]);
    next(h.s, h.ctx());
    const g = guessers(h)[0];
    v = playerView(h.s, h.ids[g], h.now);
    expect(v.round!.wwi!.answer).toBe(cur(h).text);
    expect(v.my!.wwi!.choices).toHaveLength(4);
    expect(v.me).toMatchObject({ powerupsLeft: 2, score: 0 });
  });
});

describe("anonymity", () => {
  /** Swap who wrote the answer on screen (and their answers), as if the other player had written it. */
  function swapAuthor(s: GameState, from: string, to: string): GameState {
    const t = structuredClone(s);
    const w = t.round!.wwi!;
    [w.answers[from], w.answers[to]] = [w.answers[to], w.answers[from]];
    w.current!.authorId = to;
    w.current!.orders[from] = w.current!.orders[to].map((id) => (id === from ? to : id));
    delete w.current!.orders[to];
    return t;
  }

  it("every other screen's data is identical whoever wrote the answer on screen", () => {
    const h = wwi(4);
    toGuessing(h);
    const author = cur(h).authorId;
    const [x, y, z] = guessers(h).map((i) => h.ids[i]);
    const other = swapAuthor(h.s, author, x);
    const screens = (s: GameState) => [tvView(s, h.now), hostView(s, h.now), playerView(s, y, h.now), playerView(s, z, h.now)];
    expect(screens(other)).toEqual(screens(h.s));
  });

  it("every other screen's data is identical whoever a player guessed", () => {
    const run = (pickAuthor: boolean) => {
      const h = wwi(5, {}, 3);
      toGuessing(h);
      const [g, a, b] = guessers(h);
      guessAs(h, g, pickAuthor ? cur(h).authorId : wrongFor(h, g));
      return [tvView(h.s, h.now), hostView(h.s, h.now), playerView(h.s, h.ids[a], h.now), playerView(h.s, h.ids[b], h.now)].map((v) =>
        JSON.stringify(v),
      );
    };
    expect(run(true)).toEqual(run(false));
  });

  it("no screen carries the author before the reveal, and guesses are dropped after it", () => {
    const h = wwi(6, { answersShown: 3 });
    startGame(h.s, h.ctx());
    writeAll(h);
    const unselected = W(h).queue.slice(3).map((id) => Object.values(W(h).answers).find((a) => a.id === id)!.text);
    next(h.s, h.ctx());
    const views = (except?: string) => [
      tvView(h.s, h.now),
      hostView(h.s, h.now),
      ...h.ids.filter((id) => id !== except).map((id) => playerView(h.s, id, h.now)),
    ];
    for (let k = 0; k < 3; k++) {
      const c = cur(h);
      for (const v of views()) {
        const json = JSON.stringify(v);
        expect(json).not.toMatch(/"authorId"|"orders"|"guesses"|"eliminated":\[/);
        expect(json).not.toContain(`"answerId"`);
      }
      // Nobody else's pick is visible to anyone.
      const [g] = guessers(h);
      guessAs(h, g, c.authorId);
      for (const v of views(h.ids[g])) expect(JSON.stringify(v)).not.toContain('"picks":["');
      h.advance(20_000);
      tick(h.s, h.ctx());
      expect(W(h).current).toBeNull(); // who guessed whom is gone from the server state too
      // Unselected answers never reach the TV or other phones.
      for (const v of [tvView(h.s, h.now), ...h.ids.map((id) => playerView(h.s, id, h.now))])
        for (const text of unselected) {
          const mine = v.role === "player" && v.my?.wwi?.myAnswer === text;
          if (!mine) expect(JSON.stringify(v)).not.toContain(text);
        }
      h.advance(6_000);
      tick(h.s, h.ctx());
    }
    expect(h.s.phase).toBe("reveal");
    expect(W(h).answers).toEqual({});
    for (const text of unselected) expect(JSON.stringify(h.s)).not.toContain(text);
  });

  it("the TV and host never show per-player writing or guessing status", () => {
    const h = wwi(5);
    startGame(h.s, h.ctx());
    write(h, 0);
    const tv = tvView(h.s, h.now);
    expect(new Set(tv.rivals.map((r) => r.status))).toEqual(new Set(["playing"]));
    expect(new Set(hostView(h.s, h.now).rivals.map((r) => r.status))).toEqual(new Set(["playing"]));
    expect(hostView(h.s, h.now).progress).toBeNull();
  });
});
