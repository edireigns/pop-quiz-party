import { describe, expect, it } from "vitest";
import {
  activatePowerup,
  addInsideClue,
  createGame,
  dropHint,
  endGame,
  guess,
  next,
  pickCategory,
  playAgain,
  removeInsideClue,
  roundModeFor,
  skipWord,
  startGame,
  submitAnswer,
  submitWord,
  suddenDeathMode,
  takeHint,
  tick,
  updateSettings,
  upgradeState,
} from "@/lib/game/engine";
import { computeAwards } from "@/lib/game/awards";
import { normalizeAnswer } from "@/lib/game/answers";
import { emojiPoints } from "@/lib/game/scoring";
import { GameError, type GameState } from "@/lib/game/types";
import { forceClue, forceWord, harness, lettersOf } from "./helpers";

import type { Settings } from "@/lib/game/types";
const emoji = (players = 3, extra: Partial<Settings> = {}) =>
  harness({ players, settings: { mode: "emoji", rounds: 5, timerSec: 60, ...extra } });

function advanceRound(h: ReturnType<typeof harness>) {
  skipWord(h.s, h.ctx());
  next(h.s, h.ctx());
  while (h.s.phase === "loserPick" || h.s.phase === "dare") next(h.s, h.ctx());
}

describe("game mode selection", () => {
  it("defaults to Hangman and validates the setting", () => {
    const h = harness({ players: 1 });
    expect(h.s.settings.mode).toBe("hangman");
    startGame(h.s, h.ctx());
    expect(h.s.round!.mode).toBe("hangman");
    expect(h.s.round!.clue).toBeNull();
    const g = harness({ players: 1 });
    expect(() => updateSettings(g.s, { mode: "trivia" as never })).toThrow(GameError);
  });

  it("Emoji Decode plays every round as Emoji Decode", () => {
    const h = emoji(2);
    startGame(h.s, h.ctx());
    for (let i = 0; i < 5; i++) {
      expect(h.s.round!.mode).toBe("emoji");
      expect(h.s.round!.clue).toBeTruthy();
      if (i < 4) advanceRound(h);
    }
  });

  it("Mixed alternates each round, starting with Hangman", () => {
    const h = harness({ players: 2, settings: { mode: "mixed", rounds: 10 } });
    startGame(h.s, h.ctx());
    const modes: string[] = [];
    for (let i = 0; i < 10; i++) {
      modes.push(h.s.round!.mode);
      if (i < 9) advanceRound(h);
    }
    expect(modes).toEqual(["hangman", "emoji", "hangman", "emoji", "hangman", "emoji", "hangman", "emoji", "hangman", "emoji"]);
    expect(roundModeFor(h.s, 1)).toBe("hangman");
    expect(roundModeFor(h.s, 2)).toBe("emoji");
  });

  it("Sudden Death uses the game's mode, and Hangman in Mixed", () => {
    for (const [mode, sd] of [["hangman", "hangman"], ["emoji", "emoji"], ["mixed", "hangman"]] as const) {
      const h = harness({ players: 1, settings: { mode } });
      expect(suddenDeathMode(h.s)).toBe(sd);
    }
  });

  it("host can change the mode on the game-over screen before Play Again", () => {
    const h = emoji(2);
    startGame(h.s, h.ctx());
    expect(() => updateSettings(h.s, { mode: "hangman" })).toThrow(/can't be done/);
    endGame(h.s, h.ctx());
    updateSettings(h.s, { mode: "mixed" });
    playAgain(h.s, h.ctx());
    startGame(h.s, h.ctx());
    expect(h.s.round!.mode).toBe("hangman"); // mixed starts with Hangman
  });

  it("one shared leaderboard: Hangman and Emoji points add to the same score", () => {
    const h = harness({ players: 2, settings: { mode: "mixed", rounds: 5 } });
    startGame(h.s, h.ctx());
    forceWord(h.s, "Up");
    for (const l of lettersOf("Up")) guess(h.s, h.ids[0], l, h.ctx());
    const afterHangman = h.s.players[0].score;
    expect(afterHangman).toBeGreaterThan(0);
    skipWord(h.s, h.ctx()); // ends round 1, wipes its points
    h.s.players[0].score = 140;
    next(h.s, h.ctx());
    while (h.s.phase !== "round") next(h.s, h.ctx());
    expect(h.s.round!.mode).toBe("emoji");
    forceClue(h.s, "🎈🏠👴", "Up");
    h.advance(1000);
    h.s.round!.deadline = h.now + 60_000; // full time left
    submitAnswer(h.s, h.ids[0], "up", h.ctx());
    expect(h.s.players[0].score).toBe(140 + 200);
  });
});

describe("attempts", () => {
  it("gives 3 attempts; wrong answers use one and knock you out at zero", () => {
    const h = emoji(2);
    startGame(h.s, h.ctx());
    forceClue(h.s, "🦁👑", "The Lion King", ["Lion King"]);
    const [a] = h.ids;
    let r = submitAnswer(h.s, a, "Simba", h.ctx());
    expect(r).toEqual({ correct: false, attemptsLeft: 2 });
    h.advance(500);
    expect(() => submitAnswer(h.s, a, "  simba ", h.ctx())).toThrow(/already tried/);
    expect(h.s.round!.progress[a].lives).toBe(2);
    h.advance(500);
    r = submitAnswer(h.s, a, "Mufasa", h.ctx());
    h.advance(500);
    r = submitAnswer(h.s, a, "Nala", h.ctx());
    expect(r).toEqual({ correct: false, attemptsLeft: 0 });
    expect(h.s.round!.progress[a].status).toBe("out");
    expect(() => submitAnswer(h.s, a, "Lion King", h.ctx())).toThrow(/done for this round/);
    expect(h.s.players[0].score).toBe(0);
  });

  it("rejects empty or too-long answers without costing an attempt", () => {
    const h = emoji(1);
    startGame(h.s, h.ctx());
    expect(() => submitAnswer(h.s, h.ids[0], "   ", h.ctx())).toThrow(/Type an answer/);
    expect(() => submitAnswer(h.s, h.ids[0], "!!!", h.ctx())).toThrow(/letters or numbers/);
    expect(() => submitAnswer(h.s, h.ids[0], "x".repeat(61), h.ctx())).toThrow(/60 characters/);
    expect(() => submitAnswer(h.s, h.ids[0], 42, h.ctx())).toThrow(/Type an answer/);
    expect(h.s.round!.progress[h.ids[0]].lives).toBe(3);
  });

  it("rate-limits answer submissions", () => {
    const h = emoji(1);
    startGame(h.s, h.ctx());
    forceClue(h.s, "🍕", "Pizzeria Supreme");
    submitAnswer(h.s, h.ids[0], "one", h.ctx());
    expect(() => submitAnswer(h.s, h.ids[0], "two", h.ctx())).toThrow(/slow down/i);
  });

  it("Hangman actions are rejected in Emoji rounds and vice versa", () => {
    const h = emoji(1);
    startGame(h.s, h.ctx());
    expect(() => guess(h.s, h.ids[0], "A", h.ctx())).toThrow(/Emoji Decode round/);
    expect(() => takeHint(h.s, h.ids[0], h.ctx())).toThrow(/host drops the hints/);
    const g = harness({ players: 1 });
    startGame(g.s, g.ctx());
    expect(() => submitAnswer(g.s, g.ids[0], "Titanic", g.ctx())).toThrow(/Hangman round/);
    expect(() => dropHint(g.s, g.ctx())).toThrow(/Emoji Decode rounds/);
  });

  it("the round ends when every active player has finished, or when the timer expires", () => {
    const h = emoji(2);
    startGame(h.s, h.ctx());
    forceClue(h.s, "🚢🧊💔", "Titanic");
    submitAnswer(h.s, h.ids[0], "titanic", h.ctx());
    expect(h.s.phase).toBe("round");
    submitAnswer(h.s, h.ids[1], "Titanik", h.ctx()); // one typo is fine for 7 letters
    expect(h.s.phase).toBe("reveal");

    const t = emoji(2);
    startGame(t.s, t.ctx());
    t.advance(60_000);
    tick(t.s, t.ctx());
    expect(t.s.phase).toBe("reveal");
    expect(t.s.round!.endReason).toBe("timer");
  });
});

describe("Emoji Decode scoring", () => {
  it("+100 for correct plus up to +100 speed", () => {
    expect(emojiPoints(60_000, 60_000, 0)).toBe(200);
    expect(emojiPoints(30_000, 60_000, 0)).toBe(150);
    expect(emojiPoints(0, 60_000, 0)).toBe(100);
  });

  it("−25 from the maximum for each hint revealed before answering, never below 0", () => {
    expect(emojiPoints(60_000, 60_000, 1)).toBe(175);
    expect(emojiPoints(0, 60_000, 2)).toBe(50);
    expect(emojiPoints(0, 60_000, 9)).toBe(0);
  });

  it("applies the hint penalty only to players who answer after the hint", () => {
    const h = emoji(3);
    startGame(h.s, h.ctx());
    forceClue(h.s, "🦈🏖️", "Jaws");
    const [a, b, c] = h.ids;
    h.advance(15_000); // 45s of 60s left -> speed 75
    submitAnswer(h.s, a, "Jaws", h.ctx());
    expect(h.s.players[0].score).toBe(175);
    dropHint(h.s, h.ctx());
    expect(h.s.round!.hostHints).toEqual(["Starts with “J”"]);
    submitAnswer(h.s, b, "jaws", h.ctx());
    expect(h.s.players[1].score).toBe(150); // 175 − 25
    dropHint(h.s, h.ctx());
    expect(h.s.round!.hostHints[1]).toBe("1 word · 4 letters");
    expect(() => dropHint(h.s, h.ctx())).toThrow(/Both hints/);
    submitAnswer(h.s, c, "JAWS!", h.ctx());
    expect(h.s.players[2].score).toBe(125); // 175 − 50
  });

  it("wrong or missing answers score 0", () => {
    const h = emoji(2);
    startGame(h.s, h.ctx());
    forceClue(h.s, "🦈🏖️", "Jaws");
    submitAnswer(h.s, h.ids[0], "Shark", h.ctx());
    h.advance(60_000);
    tick(h.s, h.ctx());
    expect(h.s.players.map((p) => p.score)).toEqual([0, 0]);
    expect(h.s.history[0].results[h.ids[0]].points).toBe(0);
  });

  it("doubles Emoji Decode points in the final round", () => {
    const h = emoji(2);
    startGame(h.s, h.ctx());
    for (let i = 1; i < 5; i++) advanceRound(h);
    expect(h.s.round!.kind).toBe("final");
    forceClue(h.s, "🦈🏖️", "Jaws");
    dropHint(h.s, h.ctx());
    submitAnswer(h.s, h.ids[0], "Jaws", h.ctx());
    expect(h.s.players[0].score).toBe((200 - 25) * 2);
  });

  it("skip gives no points in Emoji Decode either", () => {
    const h = emoji(2);
    startGame(h.s, h.ctx());
    forceClue(h.s, "🦈🏖️", "Jaws");
    submitAnswer(h.s, h.ids[0], "Jaws", h.ctx());
    skipWord(h.s, h.ctx());
    expect(h.s.players[0].score).toBe(0);
  });
});

describe("power-ups in Emoji Decode", () => {
  it("freeze locks a rival's answer box for 5 seconds", () => {
    const h = emoji(3);
    startGame(h.s, h.ctx());
    forceClue(h.s, "🦈🏖️", "Jaws");
    activatePowerup(h.s, h.ids[0], "freeze", h.ids[1], h.ctx());
    expect(() => submitAnswer(h.s, h.ids[1], "Jaws", h.ctx())).toThrow(/frozen/);
    expect(() => activatePowerup(h.s, h.ids[2], "freeze", h.ids[1], h.ctx())).toThrow(/already frozen/);
    h.advance(5_000);
    expect(submitAnswer(h.s, h.ids[1], "Jaws", h.ctx()).correct).toBe(true);
  });

  it("reveal shows one letter privately (never the first letter once that hint is out)", () => {
    const h = emoji(2);
    startGame(h.s, h.ctx());
    forceClue(h.s, "🦈🏖️", "Jaws");
    dropHint(h.s, h.ctx());
    for (let i = 0; i < 2; i++) activatePowerup(h.s, h.ids[0], "reveal", null, h.ctx());
    const pos = h.s.round!.progress[h.ids[0]].revealedPos!;
    expect(pos).toHaveLength(2);
    expect(pos).not.toContain(0);
    expect(new Set(pos).size).toBe(2);
    expect(h.s.round!.progress[h.ids[1]].revealedPos ?? []).toEqual([]);
    expect(h.s.round!.progress[h.ids[0]].status).toBe("playing"); // revealing never solves
  });

  it("extra life gives one more attempt, within the 2-per-game limit", () => {
    const h = emoji(2);
    startGame(h.s, h.ctx());
    activatePowerup(h.s, h.ids[0], "extraLife", null, h.ctx());
    activatePowerup(h.s, h.ids[0], "extraLife", null, h.ctx());
    expect(h.s.round!.progress[h.ids[0]].lives).toBe(5);
    expect(() => activatePowerup(h.s, h.ids[0], "reveal", null, h.ctx())).toThrow(/both power-ups/);
  });
});

describe("custom clues", () => {
  it("Inside Jokes emoji clues are used, with alternates", () => {
    const h = emoji(1, { categories: ["inside"] });
    addInsideClue(h.s, "🌮🌧️😭", "Taco Tuesday Fiasco", ["Taco fiasco"], h.ctx());
    expect(() => addInsideClue(h.s, "🌮🌧️😭", "Something Else", [], h.ctx())).toThrow(/already/);
    startGame(h.s, h.ctx());
    expect(h.s.round!.source).toBe("inside");
    expect(h.s.round!.clue).toBe("🌮🌧️😭");
    expect(submitAnswer(h.s, h.ids[0], "taco fiasco", h.ctx()).correct).toBe(true);
  });

  it("removing the last inside clue drops the Inside Jokes category", () => {
    const h = emoji(1, { categories: ["inside", "food"] });
    addInsideClue(h.s, "🌮🌧️😭", "Taco Fiasco", [], h.ctx());
    removeInsideClue(h.s, h.s.insideClues[0].id);
    expect(h.s.settings.categories).toEqual(["food"]);
  });

  it("friend words need a clue in Emoji Decode; the author sits out and earns +15 per stumped player", () => {
    const h = emoji(4, { friendWords: true });
    expect(() => submitWord(h.s, h.ids[0], "Lisbon Ferry", "", h.ctx())).toThrow(/emoji clue/);
    submitWord(h.s, h.ids[0], "Lisbon Ferry", "", h.ctx(), "⛴️🇵🇹🤢");
    startGame(h.s, h.ctx());
    while (h.s.round!.source !== "friend") advanceRound(h);
    const r = h.s.round!;
    expect(r.clue).toBe("⛴️🇵🇹🤢");
    expect(r.authorId).toBe(h.ids[0]);
    expect(r.participants).not.toContain(h.ids[0]);
    expect(() => submitAnswer(h.s, h.ids[0], "Lisbon Ferry", h.ctx())).toThrow(/being played/);
    submitAnswer(h.s, h.ids[1], "lisbon ferry", h.ctx());
    for (const id of [h.ids[2], h.ids[3]]) {
      for (const g of ["boat", "ship", "sea"]) {
        h.advance(500);
        submitAnswer(h.s, id, g, h.ctx());
      }
    }
    expect(h.s.phase).toBe("reveal");
    expect(r.stumpedCount).toBe(2);
    expect(r.authorBonus).toBe(30 * r.multiplier);
  });

  it("in Mixed mode, a friend word without a clue is only used in Hangman rounds", () => {
    let usedInHangman = 0;
    let skippedForEmoji = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const h = harness({ players: 3, seed, settings: { mode: "mixed", rounds: 10, friendWords: true } });
      submitWord(h.s, h.ids[0], "Karaoke Kevin", "", h.ctx());
      submitWord(h.s, h.ids[1], "Lisbon Ferry", "", h.ctx(), "⛴️🇵🇹🤢");
      startGame(h.s, h.ctx());
      const planned = [...h.s.friendRoundPlan];
      for (let i = 0; i < 10; i++) {
        const r = h.s.round!;
        if (r.source === "friend" && r.answer === "Karaoke Kevin") {
          expect(r.mode).toBe("hangman");
          usedInHangman++;
        }
        if (r.source === "friend" && r.mode === "emoji") expect(r.clue).toBe("⛴️🇵🇹🤢");
        if (planned.includes(r.number) && r.mode === "emoji" && r.source !== "friend") skippedForEmoji++;
        if (i < 9) advanceRound(h);
      }
    }
    expect(usedInHangman).toBeGreaterThan(0);
    expect(skippedForEmoji + usedInHangman).toBeGreaterThan(0);
  });
});

describe("no repeats", () => {
  it("never repeats a clue or an answer, even across Hangman and Emoji Decode in Mixed mode", () => {
    for (const seed of [1, 2, 3]) {
      const h = harness({ players: 1, seed, settings: { mode: "mixed", rounds: 20, categories: ["food"] } });
      startGame(h.s, h.ctx());
      const answers: string[] = [];
      const clues: string[] = [];
      for (let i = 0; i < 20; i++) {
        answers.push(normalizeAnswer(h.s.round!.answer));
        if (h.s.round!.clue) clues.push(h.s.round!.clue);
        if (i < 19) advanceRound(h);
      }
      expect(new Set(answers).size).toBe(answers.length);
      expect(new Set(clues).size).toBe(clues.length);
    }
  });
});

describe("existing features in Emoji Decode", () => {
  it("Loser Picks offers categories for the next Emoji round", () => {
    const h = emoji(2, { categories: ["food", "movies"] });
    startGame(h.s, h.ctx());
    forceClue(h.s, "🦈🏖️", "Jaws");
    submitAnswer(h.s, h.ids[0], "Jaws", h.ctx());
    for (const g of ["a1", "b2", "c3"]) {
      h.advance(500);
      submitAnswer(h.s, h.ids[1], g, h.ctx());
    }
    next(h.s, h.ctx());
    expect(h.s.phase).toBe("loserPick");
    expect(h.s.loserPick!.playerId).toBe(h.ids[1]);
    pickCategory(h.s, h.ids[1], "movies", h.ctx());
    expect(h.s.round!.mode).toBe("emoji");
    expect(h.s.round!.category).toBe("movies");
  });

  it("Dare Wheel appears between Emoji rounds", () => {
    const h = emoji(2, { dareWheel: true, dareEvery: 2, categories: ["food"] });
    startGame(h.s, h.ctx());
    skipWord(h.s, h.ctx());
    next(h.s, h.ctx());
    skipWord(h.s, h.ctx());
    next(h.s, h.ctx());
    expect(h.s.phase).toBe("dare");
  });

  it("Sudden Death in Emoji Decode: one wrong answer eliminates, first correct wins", () => {
    const h = emoji(3);
    startGame(h.s, h.ctx());
    for (let i = 1; i <= 5; i++) {
      skipWord(h.s, h.ctx());
      if (i < 5) {
        next(h.s, h.ctx());
        while (h.s.phase !== "round") next(h.s, h.ctx());
      }
    }
    h.s.players[0].score = 300;
    h.s.players[1].score = 300;
    next(h.s, h.ctx());
    const r = h.s.round!;
    expect(r.kind).toBe("suddenDeath");
    expect(r.mode).toBe("emoji");
    expect(r.participants.sort()).toEqual([h.ids[0], h.ids[1]].sort());
    forceClue(h.s, "🦈🏖️", "Jaws");
    expect(submitAnswer(h.s, h.ids[0], "Shark", h.ctx()).attemptsLeft).toBe(0);
    expect(r.progress[h.ids[0]].status).toBe("out");
    submitAnswer(h.s, h.ids[1], "Jaws", h.ctx());
    expect(h.s.winnerId).toBe(h.ids[1]);
    expect(h.s.players[1].score).toBe(300); // no points in Sudden Death
    next(h.s, h.ctx());
    expect(h.s.phase).toBe("ended");
  });

  it("Sudden Death in Mixed mode is Hangman", () => {
    const h = harness({ players: 2, settings: { mode: "mixed", rounds: 5 } });
    startGame(h.s, h.ctx());
    for (let i = 1; i <= 5; i++) {
      skipWord(h.s, h.ctx());
      if (i < 5) {
        next(h.s, h.ctx());
        while (h.s.phase !== "round") next(h.s, h.ctx());
      }
    }
    next(h.s, h.ctx()); // 0-0 tie
    expect(h.s.round!.kind).toBe("suddenDeath");
    expect(h.s.round!.mode).toBe("hangman");
  });
});

describe("awards", () => {
  function finishEmojiGame(mode: "emoji" | "mixed") {
    const h = harness({ players: 2, settings: { mode, rounds: 5 } });
    startGame(h.s, h.ctx());
    for (let i = 1; i <= 5; i++) {
      if (h.s.round!.mode === "emoji") {
        forceClue(h.s, "🦈🏖️", `Jaws Number ${i}`);
        h.advance(500);
        submitAnswer(h.s, h.ids[0], `Jaws Number ${i}`, h.ctx());
        submitAnswer(h.s, h.ids[1], "nope", h.ctx());
      } else {
        if (h.s.round!.progress[h.ids[1]]) takeHint(h.s, h.ids[1], h.ctx());
      }
      h.advance(60_000);
      tick(h.s, h.ctx());
      next(h.s, h.ctx());
      while (h.s.phase === "loserPick" || h.s.phase === "dare") next(h.s, h.ctx());
      if (h.s.phase === "round" && h.s.round!.kind === "suddenDeath") endGame(h.s, h.ctx());
    }
    if (h.s.phase !== "ended") endGame(h.s, h.ctx());
    return { h, awards: computeAwards(h.s) };
  }

  it("Emoji Whisperer goes to the most correct Emoji Decode answers; Hint Addict needs Hangman rounds", () => {
    const { h, awards } = finishEmojiGame("emoji");
    const keys = awards.map((a) => a.key);
    expect(keys).toContain("emojiWhisperer");
    expect(awards.find((a) => a.key === "emojiWhisperer")!.playerId).toBe(h.ids[0]);
    expect(keys).not.toContain("hintAddict");
    const lives = awards.find((a) => a.key === "livesLost")!;
    expect(lives.playerId).toBe(h.ids[1]); // wrong attempts count toward Most Lives Lost
  });

  it("Mixed games can show both Hint Addict and Emoji Whisperer", () => {
    const { awards } = finishEmojiGame("mixed");
    const keys = awards.map((a) => a.key);
    expect(keys).toContain("emojiWhisperer");
    expect(keys).toContain("hintAddict");
  });
});

describe("existing saved rooms", () => {
  it("rooms saved before Emoji Decode existed are upgraded and keep playing Hangman", () => {
    const h = harness({ players: 2 });
    startGame(h.s, h.ctx());
    forceWord(h.s, "Taco");
    guess(h.s, h.ids[0], "T", h.ctx());
    // Strip every field added for Emoji Decode, as an old saved room would look.
    const old = JSON.parse(JSON.stringify(h.s)) as Record<string, unknown> & GameState;
    delete (old.settings as Partial<GameState["settings"]>).mode;
    for (const k of ["insideClues", "usedClues", "startedSettings"]) delete (old as Record<string, unknown>)[k];
    for (const k of ["mode", "clue", "alternates", "hostHints"]) delete (old.round as unknown as Record<string, unknown>)[k];
    for (const p of old.players) delete (p.stats as Partial<typeof p.stats>).emojiSolves;
    const s = upgradeState(old);
    expect(s.settings.mode).toBe("hangman");
    expect(s.round!.mode).toBe("hangman");
    expect(s.round!.progress[h.ids[0]].guessed).toEqual(["T"]);
    guess(s, h.ids[0], "A", h.ctx());
    expect(s.players[0].score).toBe(20);
    const fresh = createGame({ roomId: "r", code: "ABCDE", now: 0 });
    expect(upgradeState(JSON.parse(JSON.stringify(fresh)))).toEqual(fresh);
  });
});
