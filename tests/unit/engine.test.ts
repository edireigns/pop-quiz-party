import { describe, expect, it } from "vitest";
import {
  addPlayer,
  endGame,
  guess,
  next,
  pause,
  pickCategory,
  playAgain,
  removePlayer,
  resume,
  skipWord,
  startGame,
  tick,
  useHint,
  usePowerup,
  passDare,
  respinDare,
  spinDare,
  react,
  submitWord,
  removeSubmission,
  updateSettings,
} from "@/lib/game/engine";
import { wordKey } from "@/lib/game/text";
import { GameError } from "@/lib/game/types";
import { forceWord, harness, lettersOf, WRONG_FOR } from "./helpers";

function solveAll(h: ReturnType<typeof harness>, pid: string) {
  for (const l of lettersOf(h.s.round!.answer)) {
    if (h.s.round!.progress[pid]?.status !== "playing") break;
    guess(h.s, pid, l, h.ctx());
  }
}
function failAll(h: ReturnType<typeof harness>, pid: string) {
  for (const l of WRONG_FOR(h.s.round!.answer)) {
    if (h.s.phase !== "round" || h.s.round!.progress[pid]?.status !== "playing") break;
    guess(h.s, pid, l, h.ctx());
  }
}

describe("round scoring", () => {
  it("awards +10 per correct letter and the solve bonus with speed", () => {
    const h = harness({ players: 2, settings: { timerSec: 60, rounds: 5 } });
    startGame(h.s, h.ctx());
    forceWord(h.s, "Bee Gee");
    const [a] = h.ids;
    guess(h.s, a, "b", h.ctx()); // +10
    guess(h.s, a, "Z", h.ctx()); // wrong, 5 lives
    h.advance(30_000);
    guess(h.s, a, "E", h.ctx()); // +10
    guess(h.s, a, "g", h.ctx()); // +10 and solved with 5 lives, 30s left of 60
    const p = h.s.players.find((x) => x.id === a)!;
    // 3 letters (30) + 50 + 5*10 + 15 speed
    expect(p.score).toBe(30 + 50 + 50 + 15);
    expect(h.s.round!.progress[a].status).toBe("solved");
    expect(h.s.phase).toBe("round"); // other player still playing
  });

  it("costs a life per wrong letter and knocks you out at zero", () => {
    const h = harness({ players: 2 });
    startGame(h.s, h.ctx());
    forceWord(h.s, "Pizza");
    const [a] = h.ids;
    const wrong = WRONG_FOR("Pizza");
    for (let i = 0; i < 6; i++) guess(h.s, a, wrong[i], h.ctx());
    const pr = h.s.round!.progress[a];
    expect(pr.lives).toBe(0);
    expect(pr.status).toBe("out");
    expect(pr.wrong).toHaveLength(6);
    expect(() => guess(h.s, a, "P", h.ctx())).toThrow(GameError);
  });

  it("rejects repeated letters without penalty", () => {
    const h = harness({ players: 1 });
    startGame(h.s, h.ctx());
    forceWord(h.s, "Pizza");
    guess(h.s, h.ids[0], "Q", h.ctx());
    expect(() => guess(h.s, h.ids[0], "q", h.ctx())).toThrow(/already/);
    expect(h.s.round!.progress[h.ids[0]].lives).toBe(5);
  });

  it("hint costs 20 but scores never go below 0", () => {
    const h = harness({ players: 2 });
    startGame(h.s, h.ctx());
    forceWord(h.s, "Pizza", "Cheesy slice");
    const [a] = h.ids;
    expect(useHint(h.s, a, h.ctx())).toBe("Cheesy slice");
    expect(h.s.players[0].score).toBe(0);
    expect(h.s.round!.progress[a].points).toBe(0);
    guess(h.s, a, "P", h.ctx());
    guess(h.s, a, "I", h.ctx());
    guess(h.s, a, "Z", h.ctx());
    expect(h.s.players[0].score).toBe(30);
    // second hint call is free
    useHint(h.s, a, h.ctx());
    expect(h.s.players[0].score).toBe(30);
  });

  it("hint penalty applies when you have points", () => {
    const h = harness({ players: 2 });
    startGame(h.s, h.ctx());
    forceWord(h.s, "Pizza");
    h.s.players[0].score = 100;
    useHint(h.s, h.ids[0], h.ctx());
    expect(h.s.players[0].score).toBe(80);
  });

  it("ends the round when every active player is finished", () => {
    const h = harness({ players: 3 });
    startGame(h.s, h.ctx());
    forceWord(h.s, "Taco");
    solveAll(h, h.ids[0]);
    failAll(h, h.ids[1]);
    expect(h.s.phase).toBe("round");
    solveAll(h, h.ids[2]);
    expect(h.s.phase).toBe("reveal");
    expect(h.s.round!.endReason).toBe("allDone");
  });

  it("ends the round when the server timer expires", () => {
    const h = harness({ players: 2, settings: { timerSec: 45 } });
    startGame(h.s, h.ctx());
    h.advance(44_000);
    expect(tick(h.s, h.ctx())).toBe(false);
    h.advance(1_000);
    expect(tick(h.s, h.ctx())).toBe(true);
    expect(h.s.phase).toBe("reveal");
    expect(h.s.round!.endReason).toBe("timer");
  });
});

describe("pause and skip", () => {
  it("pausing stops the server timer and blocks guesses", () => {
    const h = harness({ players: 1, settings: { timerSec: 60 } });
    startGame(h.s, h.ctx());
    h.advance(10_000);
    pause(h.s, h.ctx());
    h.advance(120_000);
    tick(h.s, h.ctx());
    expect(h.s.phase).toBe("round");
    expect(() => guess(h.s, h.ids[0], "A", h.ctx())).toThrow(/paused/);
    resume(h.s, h.ctx());
    h.advance(49_000);
    tick(h.s, h.ctx());
    expect(h.s.phase).toBe("round");
    h.advance(1_000);
    tick(h.s, h.ctx());
    expect(h.s.phase).toBe("reveal");
  });

  it("skip awards no points and refunds power-ups", () => {
    const h = harness({ players: 2 });
    startGame(h.s, h.ctx());
    forceWord(h.s, "Ramen");
    h.s.players[0].score = 50;
    guess(h.s, h.ids[0], "R", h.ctx());
    usePowerup(h.s, h.ids[0], "extraLife", null, h.ctx());
    expect(h.s.players[0].score).toBe(60);
    expect(h.s.players[0].powerupsLeft).toBe(1);
    skipWord(h.s, h.ctx());
    expect(h.s.phase).toBe("reveal");
    expect(h.s.players[0].score).toBe(50);
    expect(h.s.players[0].powerupsLeft).toBe(2);
    expect(h.s.history).toHaveLength(0);
  });
});

describe("players", () => {
  it("blocks duplicate nicknames case-insensitively", () => {
    const h = harness({ players: 1 });
    expect(() => addPlayer(h.s, { nickname: "player1", tokenHash: "x" }, h.ctx())).toThrow(/taken/);
  });

  it("late joiners start with 0 points from the next round", () => {
    const h = harness({ players: 1 });
    startGame(h.s, h.ctx());
    const late = addPlayer(h.s, { nickname: "Late", tokenHash: "late" }, h.ctx());
    expect(h.s.round!.participants).not.toContain(late.id);
    expect(() => guess(h.s, late.id, "A", h.ctx())).toThrow(/next round/);
    skipWord(h.s, h.ctx());
    next(h.s, h.ctx());
    if (h.s.phase === "loserPick") next(h.s, h.ctx());
    expect(h.s.round!.participants).toContain(late.id);
    expect(late.score).toBe(0);
  });

  it("removing a player drops them from the round and can end it", () => {
    const h = harness({ players: 2 });
    startGame(h.s, h.ctx());
    solveAll(h, h.ids[0]);
    expect(h.s.phase).toBe("round");
    removePlayer(h.s, h.ids[1], h.ctx());
    expect(h.s.phase).toBe("reveal");
  });
});

describe("word selection", () => {
  it("never repeats a word within a game", () => {
    const h = harness({ players: 1, settings: { rounds: 20, categories: ["food"] } });
    startGame(h.s, h.ctx());
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const key = wordKey(h.s.round!.answer);
      expect(seen.has(key)).toBe(false);
      seen.add(key);
      skipWord(h.s, h.ctx());
      if (i < 19) next(h.s, h.ctx());
    }
  });

  it("respects Clean content and difficulty filters", async () => {
    const { WORD_BANK } = await import("@/data/words");
    const h = harness({ players: 1, settings: { rounds: 20, categories: ["tv", "movies"], difficulty: "easy", content: "clean" } });
    startGame(h.s, h.ctx());
    for (let i = 0; i < 20; i++) {
      const entry = [...WORD_BANK.tv, ...WORD_BANK.movies].find((e) => e.answer === h.s.round!.answer)!;
      expect(entry.content).toBe("clean");
      expect(entry.difficulty).toBe("easy");
      skipWord(h.s, h.ctx());
      if (i < 19) {
        next(h.s, h.ctx());
        if (h.s.phase === "loserPick") next(h.s, h.ctx());
      }
    }
  });

  it("uses inside jokes when that category is selected", () => {
    const h = harness({ players: 1, settings: { categories: ["inside"] } });
    h.s.insideJokes.push({ id: "j1", answer: "Taco Tuesday Fiasco", hint: "Never again" });
    startGame(h.s, h.ctx());
    expect(h.s.round!.answer).toBe("Taco Tuesday Fiasco");
    expect(h.s.round!.source).toBe("inside");
  });
});

describe("Double-Points Final", () => {
  it("doubles every point earned in the last round", () => {
    const h = harness({ players: 2, settings: { rounds: 5 } });
    startGame(h.s, h.ctx());
    for (let i = 1; i < 5; i++) {
      skipWord(h.s, h.ctx());
      next(h.s, h.ctx());
      if (h.s.phase === "loserPick") next(h.s, h.ctx());
    }
    expect(h.s.round!.kind).toBe("final");
    expect(h.s.round!.multiplier).toBe(2);
    forceWord(h.s, "Up");
    guess(h.s, h.ids[0], "U", h.ctx()); // +20
    expect(h.s.players[0].score).toBe(20);
    guess(h.s, h.ids[0], "P", h.ctx()); // +20 + (50 + 60 + 30) * 2
    expect(h.s.players[0].score).toBe(40 + 280);
  });

  it("hint penalty in the final is not doubled", () => {
    const h = harness({ players: 2, settings: { rounds: 5 } });
    startGame(h.s, h.ctx());
    h.s.round!.multiplier = 2;
    h.s.players[0].score = 100;
    useHint(h.s, h.ids[0], h.ctx());
    expect(h.s.players[0].score).toBe(80);
  });
});

describe("Sudden Death tie handling", () => {
  function toFinalReveal(h: ReturnType<typeof harness>) {
    startGame(h.s, h.ctx());
    for (let i = 1; i <= h.s.settings.rounds; i++) {
      skipWord(h.s, h.ctx());
      if (i < h.s.settings.rounds) {
        next(h.s, h.ctx());
        if (h.s.phase === "loserPick") next(h.s, h.ctx());
      }
    }
  }

  it("declares an outright winner without sudden death", () => {
    const h = harness({ players: 3, settings: { rounds: 5 } });
    toFinalReveal(h);
    h.s.players[0].score = 300;
    h.s.players[1].score = 200;
    next(h.s, h.ctx());
    expect(h.s.phase).toBe("ended");
    expect(h.s.winnerId).toBe(h.ids[0]);
  });

  it("only tied leaders play; one wrong guess eliminates; first solve wins", () => {
    const h = harness({ players: 3, settings: { rounds: 5 } });
    toFinalReveal(h);
    h.s.players[0].score = 300;
    h.s.players[1].score = 300;
    h.s.players[2].score = 100;
    next(h.s, h.ctx());
    expect(h.s.phase).toBe("round");
    expect(h.s.round!.kind).toBe("suddenDeath");
    expect(h.s.round!.participants.sort()).toEqual([h.ids[0], h.ids[1]].sort());
    expect(() => guess(h.s, h.ids[2], "A", h.ctx())).toThrow();
    forceWord(h.s, "Bagel");
    guess(h.s, h.ids[0], "Z", h.ctx());
    expect(h.s.round!.progress[h.ids[0]].status).toBe("out");
    expect(() => useHint(h.s, h.ids[1], h.ctx())).toThrow(/Sudden Death/);
    for (const l of ["B", "A", "G", "E", "L"]) guess(h.s, h.ids[1], l, h.ctx());
    expect(h.s.phase).toBe("reveal");
    expect(h.s.winnerId).toBe(h.ids[1]);
    expect(h.s.players[1].score).toBe(300); // no points in sudden death
    next(h.s, h.ctx());
    expect(h.s.phase).toBe("ended");
  });

  it("plays another word if every tied player is eliminated", () => {
    const h = harness({ players: 2, settings: { rounds: 5 } });
    toFinalReveal(h);
    next(h.s, h.ctx()); // both 0 -> tie
    expect(h.s.round!.kind).toBe("suddenDeath");
    const firstWord = h.s.round!.answer;
    for (const id of h.ids) guess(h.s, id, WRONG_FOR(firstWord)[0], h.ctx());
    expect(h.s.phase).toBe("reveal");
    expect(h.s.winnerId).toBeNull();
    next(h.s, h.ctx());
    expect(h.s.phase).toBe("round");
    expect(h.s.round!.kind).toBe("suddenDeath");
    expect(h.s.round!.sdAttempt).toBe(2);
    expect(h.s.round!.answer).not.toBe(firstWord);
  });
});

describe("friend-written words", () => {
  function setup(players = 4, rounds: 5 | 10 = 5) {
    const h = harness({ players, settings: { rounds, friendWords: true } });
    for (const [i, id] of h.ids.entries()) submitWord(h.s, id, `Friend Word ${"ABCDEFGH"[i]}`, "", h.ctx());
    return h;
  }

  it("plans about one-third of rounds with friend words", () => {
    const h = setup(6, 10);
    startGame(h.s, h.ctx());
    expect(h.s.friendRoundPlan).toHaveLength(3);
  });

  it("author sits out, cannot guess, and earns +15 per player who fails", () => {
    const h = setup(4);
    startGame(h.s, h.ctx());
    // Force round 1 to be a friend word by replaying through the plan.
    while (h.s.round!.source !== "friend") {
      skipWord(h.s, h.ctx());
      next(h.s, h.ctx());
      if (h.s.phase === "loserPick") next(h.s, h.ctx());
    }
    const r = h.s.round!;
    const author = r.authorId!;
    expect(r.participants).not.toContain(author);
    expect(() => guess(h.s, author, "A", h.ctx())).toThrow(/Your word is being played/);
    const others = r.participants;
    const authorBefore = h.s.players.find((p) => p.id === author)!.score;
    solveAll(h, others[0]);
    failAll(h, others[1]);
    failAll(h, others[2]);
    expect(h.s.phase).toBe("reveal");
    const mult = r.multiplier;
    expect(h.s.players.find((p) => p.id === author)!.score).toBe(authorBefore + 15 * 2 * mult);
    expect(r.stumpedCount).toBe(2);
  });

  it("validates host removal before start and only allows lobby submissions", () => {
    const h = setup(2);
    const sub = h.s.submissions[0];
    removeSubmission(h.s, sub.id);
    expect(h.s.submissions[0].status).toBe("removed");
    expect(() => submitWord(h.s, sub.playerId, "Another One", "", h.ctx())).toThrow(/removed/);
    startGame(h.s, h.ctx());
    expect(() => submitWord(h.s, h.ids[1], "Late Word", "", h.ctx())).toThrow();
  });

  it("does not use friend words when the setting is off", () => {
    const h = harness({ players: 3, settings: { rounds: 5 } });
    startGame(h.s, h.ctx());
    expect(h.s.friendRoundPlan).toEqual([]);
  });
});

describe("power-ups", () => {
  it("allows exactly 2 uses per game, shared across types", () => {
    const h = harness({ players: 3 });
    startGame(h.s, h.ctx());
    forceWord(h.s, "Pancakes");
    const [a, b] = h.ids;
    usePowerup(h.s, a, "extraLife", null, h.ctx());
    expect(h.s.round!.progress[a].lives).toBe(7);
    usePowerup(h.s, a, "freeze", b, h.ctx());
    expect(() => usePowerup(h.s, a, "reveal", null, h.ctx())).toThrow(/both power-ups/);
  });

  it("freeze blocks the target for 5 seconds, once per round", () => {
    const h = harness({ players: 3 });
    startGame(h.s, h.ctx());
    forceWord(h.s, "Pancakes");
    const [a, b, c] = h.ids;
    usePowerup(h.s, a, "freeze", b, h.ctx());
    expect(() => guess(h.s, b, "P", h.ctx())).toThrow(/frozen/);
    expect(() => usePowerup(h.s, c, "freeze", b, h.ctx())).toThrow(/already frozen/);
    expect(() => usePowerup(h.s, a, "freeze", a, h.ctx())).toThrow();
    h.advance(5_000);
    guess(h.s, b, "P", h.ctx());
    expect(h.s.round!.progress[b].guessed).toContain("P");
  });

  it("reveal shows a hidden letter without awarding letter points", () => {
    const h = harness({ players: 2 });
    startGame(h.s, h.ctx());
    forceWord(h.s, "Kimchi");
    usePowerup(h.s, h.ids[0], "reveal", null, h.ctx());
    const pr = h.s.round!.progress[h.ids[0]];
    expect(pr.revealed).toHaveLength(1);
    expect("KIMCH").toContain(pr.revealed[0]);
    expect(h.s.players[0].score).toBe(0);
  });

  it("reveal can complete the word and award the solve bonus", () => {
    const h = harness({ players: 2 });
    startGame(h.s, h.ctx());
    forceWord(h.s, "Up");
    guess(h.s, h.ids[0], "U", h.ctx());
    usePowerup(h.s, h.ids[0], "reveal", null, h.ctx());
    expect(h.s.round!.progress[h.ids[0]].status).toBe("solved");
    expect(h.s.players[0].score).toBe(10 + 50 + 60 + 30);
  });
});

describe("Loser Picks", () => {
  it("lowest round scorer picks the next category within 15s", () => {
    const h = harness({ players: 3, settings: { categories: ["food", "movies", "tv"] } });
    startGame(h.s, h.ctx());
    forceWord(h.s, "Taco");
    solveAll(h, h.ids[0]);
    solveAll(h, h.ids[1]);
    failAll(h, h.ids[2]);
    next(h.s, h.ctx());
    expect(h.s.phase).toBe("loserPick");
    expect(h.s.loserPick!.playerId).toBe(h.ids[2]);
    expect(() => pickCategory(h.s, h.ids[0], "tv", h.ctx())).toThrow(/not your pick/);
    pickCategory(h.s, h.ids[2], "tv", h.ctx());
    expect(h.s.phase).toBe("round");
    expect(h.s.round!.category).toBe("tv");
  });

  it("chooses randomly after 15 seconds", () => {
    const h = harness({ players: 2, settings: { categories: ["food", "movies"] } });
    startGame(h.s, h.ctx());
    h.advance(61_000);
    tick(h.s, h.ctx());
    next(h.s, h.ctx());
    expect(h.s.phase).toBe("loserPick");
    h.advance(15_000);
    tick(h.s, h.ctx());
    expect(h.s.phase).toBe("round");
    expect(["food", "movies"]).toContain(h.s.round!.category);
  });

  it("is skipped with a single category", () => {
    const h = harness({ players: 2, settings: { categories: ["food"] } });
    startGame(h.s, h.ctx());
    h.advance(61_000);
    tick(h.s, h.ctx());
    next(h.s, h.ctx());
    expect(h.s.phase).toBe("round");
  });
});

describe("Dare Wheel", () => {
  it("appears at the chosen interval for the last-place player, who can spin or pass", () => {
    const h = harness({ players: 3, settings: { dareWheel: true, dareEvery: 2, categories: ["food"], rounds: 10 } });
    startGame(h.s, h.ctx());
    skipWord(h.s, h.ctx());
    next(h.s, h.ctx());
    expect(h.s.phase).toBe("round");
    h.s.players[0].score = 50;
    h.s.players[1].score = 20;
    h.s.players[2].score = 40;
    skipWord(h.s, h.ctx());
    next(h.s, h.ctx());
    expect(h.s.phase).toBe("dare");
    expect(h.s.dare!.playerId).toBe(h.ids[1]);
    expect(() => spinDare(h.s, h.ids[0], h.ctx())).toThrow();
    spinDare(h.s, h.ids[1], h.ctx());
    const first = h.s.dare!.resultIndex;
    expect(first).not.toBeNull();
    respinDare(h.s, h.ctx());
    expect(h.s.dare!.resultIndex).not.toBe(first);
    passDare(h.s, h.ids[1]);
    expect(h.s.dare!.status).toBe("passed");
    next(h.s, h.ctx());
    expect(h.s.phase).toBe("round");
  });

  it("starter dares respect the content level", async () => {
    const { STARTER_DARES } = await import("@/data/dares");
    const h = harness({ players: 2, settings: { dareWheel: true, dareEvery: 2, content: "clean", categories: ["food"] } });
    startGame(h.s, h.ctx());
    skipWord(h.s, h.ctx());
    next(h.s, h.ctx());
    skipWord(h.s, h.ctx());
    next(h.s, h.ctx());
    const pg = new Set(STARTER_DARES.filter((d) => d.content === "pg13").map((d) => d.text));
    for (const o of h.s.dare!.options) expect(pg.has(o)).toBe(false);
  });
});

describe("game lifecycle", () => {
  it("end game then Play Again resets scores and keeps the room and players", () => {
    const h = harness({ players: 3 });
    startGame(h.s, h.ctx());
    forceWord(h.s, "Taco");
    solveAll(h, h.ids[0]);
    endGame(h.s, h.ctx());
    expect(h.s.phase).toBe("ended");
    expect(h.s.players[0].score).toBeGreaterThan(0);
    playAgain(h.s, h.ctx());
    expect(h.s.phase).toBe("lobby");
    expect(h.s.code).toBe("ABCDE");
    expect(h.s.players.map((p) => p.id)).toEqual(h.ids);
    expect(h.s.players.every((p) => p.score === 0 && p.powerupsLeft === 2)).toBe(true);
    expect(h.s.gameNumber).toBe(2);
  });

  it("settings are only editable in the lobby and validated", () => {
    const h = harness({ players: 1 });
    expect(() => updateSettings(h.s, { rounds: 7 as never })).toThrow();
    updateSettings(h.s, { rounds: 15, timerSec: 90, dareEvery: 5 });
    expect(h.s.settings.rounds).toBe(15);
    startGame(h.s, h.ctx());
    expect(() => updateSettings(h.s, { rounds: 5 })).toThrow();
  });

  it("rate-limits emoji reactions", () => {
    const h = harness({ players: 1 });
    react(h.s, h.ids[0], "🔥", h.ctx());
    expect(() => react(h.s, h.ids[0], "🔥", h.ctx())).toThrow(/slow down/i);
    h.advance(700);
    react(h.s, h.ids[0], "😂", h.ctx());
    expect(() => react(h.s, h.ids[0], "🍆", h.ctx())).toThrow(/Unknown/);
  });
});
