import { describe, expect, it } from "vitest";
import {
  activatePowerup,
  addCustomBlitz,
  addPlayer,
  availableBlitzCategories,
  endGame,
  finishBlitzReview,
  includesBlitz,
  next,
  pickCategory,
  removeCustomBlitz,
  removePlayer,
  reviewBlitzAnswer,
  roundModeFor,
  skipWord,
  startGame,
  submitBlitzAnswer,
  suddenDeathMode,
  tick,
  updateSettings,
  upgradeState,
} from "@/lib/game/engine";
import { BLITZ_BANK } from "@/data/blitz";
import { computeAwards } from "@/lib/game/awards";
import { estimateMinutes } from "@/lib/game/estimate";
import { hostView, playerView, tvView } from "@/lib/game/views";
import { GameError, type GameState, type Settings } from "@/lib/game/types";
import { harness } from "./helpers";

type H = ReturnType<typeof harness>;
const r13 = (s: string) => s.replace(/[a-z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 97 + 13) % 26) + 97));
const MILD = r13("fuvg");

const blitz = (players = 3, extra: Partial<Settings> = {}, seed = 42) =>
  harness({ players, seed, settings: { mode: "blitz", rounds: 5, ...extra } });
const B = (h: H) => h.s.round!.blitz!;

/** Swap in a known prompt (tests only). */
function forcePrompt(h: H, letter = "S", answers: string[][] = MOVIES_S) {
  B(h).letter = letter;
  B(h).answers = answers.map((g) => [...g]);
}
const MOVIES_S = [["Shrek"], ["Scream"], ["Saw"], ["Speed"], ["Spider-Man", "Spiderman"], ["Superman"], ["Skyfall"], ["Signs"], ["Split"], ["Sing"]];

function add(h: H, i: number, text: string) {
  h.advance(550);
  return submitBlitzAnswer(h.s, h.ids[i], text, h.ctx());
}
/** Run out the clock (no review → scored; otherwise in review). */
function timeUp(h: H) {
  h.advance(h.s.round!.deadline - h.now + 6000);
  tick(h.s, h.ctx());
}
function nextRound(h: H) {
  if (h.s.phase === "round") skipWord(h.s, h.ctx());
  next(h.s, h.ctx());
  while (h.s.phase === "loserPick" || h.s.phase === "dare") next(h.s, h.ctx());
}
const score = (h: H, i: number) => h.s.players[i].score;

describe("mode selection and settings", () => {
  it("is a Game Mode and a Mixed option; Hangman stays the default", () => {
    const h = harness({ players: 2 });
    expect(h.s.settings.mode).toBe("hangman");
    expect(h.s.settings.blitzSec).toBe(30);
    expect(h.s.settings.blitzCategories).toEqual(["tv", "movies", "music", "food", "memes", "college", "places", "animals"]);
    expect(includesBlitz(h.s)).toBe(false);
    updateSettings(h.s, { mode: "blitz", blitzSec: 60, blitzCategories: ["places", "animals"] });
    expect(h.s.settings).toMatchObject({ mode: "blitz", blitzSec: 60, blitzCategories: ["places", "animals"] });
    expect(() => updateSettings(h.s, { blitzSec: 20 as never })).toThrow(/30, 45 or 60/);
    expect(() => updateSettings(h.s, { blitzCategories: [] })).toThrow(/at least one/);
    expect(() => updateSettings(h.s, { blitzCategories: ["sports" as never] })).toThrow(/at least one/);
    updateSettings(h.s, { mode: "mixed", mixedModes: ["hangman", "blitz"] });
    expect(includesBlitz(h.s)).toBe(true);
    expect([1, 2, 3].map((n) => roundModeFor(h.s, n))).toEqual(["hangman", "blitz", "hangman"]);
    expect(estimateMinutes(h.s.settings)).toBeGreaterThan(0);
  });

  it("older saved rooms upgrade cleanly", () => {
    const h = harness({ players: 1 });
    const old = JSON.parse(JSON.stringify(h.s)) as GameState & Record<string, unknown>;
    delete (old as Record<string, unknown>).customBlitz;
    delete (old as Record<string, unknown>).usedBlitz;
    delete (old.settings as unknown as Record<string, unknown>).blitzSec;
    delete (old.settings as unknown as Record<string, unknown>).blitzCategories;
    expect(upgradeState(old)).toEqual(h.s);
  });

  it("starts a round with a category, a letter and the timer", () => {
    const h = blitz(3, { blitzSec: 45, blitzCategories: ["animals"] });
    startGame(h.s, h.ctx());
    const r = h.s.round!;
    expect(r.mode).toBe("blitz");
    expect(r.category).toBe("animals");
    expect(r.durationMs).toBe(45_000);
    expect(r.question).toBe(`Animals starting with ${B(h).letter}`);
    const tv = tvView(h.s, h.now).round!;
    expect(tv.blitz).toMatchObject({ stage: "play", category: "Animals", letter: B(h).letter });
    expect(BLITZ_BANK.animals.map((p) => p.letter)).toContain(B(h).letter);
  });
});

describe("adding answers", () => {
  it("shows each answer as Added, never whether it's valid", () => {
    const h = blitz();
    startGame(h.s, h.ctx());
    forcePrompt(h);
    expect(add(h, 0, "Shrek")).toEqual({ added: true, count: 1 });
    expect(add(h, 0, "Banana")).toEqual({ added: true, count: 2 }); // wrong letter: still just "Added"
    expect(add(h, 0, "Sandwich man")).toEqual({ added: true, count: 3 }); // unrecognized
    const my = playerView(h.s, h.ids[0], h.now).my!.blitz!;
    expect(my.answers).toEqual(["Shrek", "Banana", "Sandwich man"]);
    expect(JSON.stringify(my)).not.toMatch(/valid|correct|key/);
  });

  it("rejects duplicates from the same player (after normalisation) but not across players", () => {
    const h = blitz();
    startGame(h.s, h.ctx());
    forcePrompt(h);
    add(h, 0, "Spider-Man");
    expect(() => add(h, 0, "the spiderman!")).toThrow(/already added/);
    expect(add(h, 1, "Spider-Man").added).toBe(true);
  });

  it("caps answers at 20 per player per round", () => {
    const h = blitz();
    startGame(h.s, h.ctx());
    forcePrompt(h);
    for (let i = 0; i < 20; i++) {
      h.advance(600);
      submitBlitzAnswer(h.s, h.ids[0], `Something ${i}`, h.ctx());
    }
    h.advance(600);
    expect(() => submitBlitzAnswer(h.s, h.ids[0], "One more", h.ctx())).toThrow(/20 answers/);
  });

  it("rate-limits rapid submissions", () => {
    const h = blitz();
    startGame(h.s, h.ctx());
    h.s.players[0].blitzTimes = Array(8).fill(h.now);
    expect(() => submitBlitzAnswer(h.s, h.ids[0], "Speed", h.ctx())).toThrow(GameError);
  });

  it("validates text and the content level", () => {
    const h = blitz();
    startGame(h.s, h.ctx());
    expect(() => add(h, 0, "   ")).toThrow(/Type an answer/);
    expect(() => add(h, 0, "S".repeat(41))).toThrow(/40 characters/);
    expect(() => add(h, 0, `S ${MILD}`)).toThrow(/isn't allowed/);
  });

  it("stops at the timer; late joiners wait for the next round", () => {
    const h = blitz();
    startGame(h.s, h.ctx());
    const late = addPlayer(h.s, { nickname: "Late", tokenHash: "hl" }, h.ctx());
    expect(late.score).toBe(0);
    expect(() => submitBlitzAnswer(h.s, late.id, "Shrek", h.ctx())).toThrow(/next round/);
    h.advance(30_000);
    expect(() => submitBlitzAnswer(h.s, h.ids[0], "Shrek", h.ctx())).toThrow(/Time's up/);
    nextRound(h);
    expect(h.s.round!.participants).toContain(late.id);
  });
});

describe("scoring", () => {
  it("+10 per valid answer, +30 if nobody else gave it, 0 for invalid with no penalty", () => {
    const h = blitz(3);
    startGame(h.s, h.ctx());
    forcePrompt(h);
    add(h, 0, "Shrek"); // shared with player 1
    add(h, 0, "Scream"); // unique
    add(h, 0, "Banana"); // wrong letter
    add(h, 0, "Spoon"); // unrecognized, never reviewed → 0
    add(h, 1, "shrek");
    add(h, 1, "Spiderman"); // alternate of Spider-Man...
    add(h, 2, "Spider Man"); // ...so not unique
    timeUp(h);
    expect(h.s.round!.blitz!.stage).toBe("review");
    finishBlitzReview(h.s, h.ctx()); // nothing approved
    expect(h.s.phase).toBe("reveal");
    expect([score(h, 0), score(h, 1), score(h, 2)]).toEqual([10 + 40, 10 + 10, 10]);
    const rv = tvView(h.s, h.now).reveal!.blitz!;
    expect(rv.players.find((p) => p.id === h.ids[0])).toMatchObject({ valid: 2, unique: 1, points: 50 });
    expect(rv.popular).toEqual(expect.arrayContaining([{ text: "Shrek", count: 2 }, { text: "Spider-Man", count: 2 }]));
    expect(rv.uniques).toEqual([{ text: "Scream", nickname: "Player1" }]);
    expect(playerView(h.s, h.ids[0], h.now).my!.blitz!.result).toEqual({ valid: 2, unique: 1, points: 50 });
  });

  it("caps a round at 300, and the final round doubles it", () => {
    const answers = Array.from({ length: 30 }, (_, i) => [`S${"abcdefghijklmnopqrstuvwxyz"[i % 26]}${i}word`]);
    const run = (final: boolean) => {
      const h = blitz(2, { rounds: 5 });
      startGame(h.s, h.ctx());
      if (final) for (let n = 1; n < 5; n++) nextRound(h);
      forcePrompt(h, "S", answers);
      for (let i = 0; i < 20; i++) {
        h.advance(600);
        submitBlitzAnswer(h.s, h.ids[0], answers[i][0], h.ctx());
      }
      expect(h.s.phase).toBe("round"); // player 1 hasn't hit 20, so the timer still runs
      timeUp(h);
      return h;
    };
    const normal = run(false);
    expect(score(normal, 0)).toBe(300); // 20 unique × 40 = 800 → capped
    const fin = run(true);
    expect(fin.s.round!.kind).toBe("final");
    expect(score(fin, 0)).toBe(600);
  });

  it("scores stay on the shared leaderboard and in history", () => {
    const h = blitz(2);
    startGame(h.s, h.ctx());
    forcePrompt(h);
    add(h, 0, "Saw");
    timeUp(h);
    expect(h.s.history[0]).toMatchObject({ mode: "blitz", answer: h.s.round!.question });
    expect(h.s.history[0].results[h.ids[0]]).toMatchObject({ points: 40, solved: true });
    expect(tvView(h.s, h.now).leaderboard[0]).toMatchObject({ id: h.ids[0], score: 40, roundPoints: 40 });
  });
});

describe("host review", () => {
  function reviewRound() {
    const h = blitz(3);
    startGame(h.s, h.ctx());
    forcePrompt(h);
    for (let i = 0; i < 11; i++) add(h, 0, `Sx${"abcdefghijk"[i]}`); // 11 one-off unrecognized answers
    add(h, 0, "Seabiscuit");
    add(h, 1, "Seabiscuit");
    add(h, 2, "seabiscuit!"); // most common unrecognized
    add(h, 2, "Sxa");
    timeUp(h);
    return h;
  }

  it("sends up to 10 of the most common unrecognized answers to the host, for 20 seconds", () => {
    const h = reviewRound();
    expect(B(h).stage).toBe("review");
    expect(h.s.round!.durationMs).toBe(20_000);
    const items = hostView(h.s, h.now).blitzReview;
    expect(items).toHaveLength(10);
    expect(items[0]).toMatchObject({ text: "Seabiscuit", count: 3, verdict: null });
    expect(items[1]).toMatchObject({ text: "Sxa", count: 2 });
    expect(tvView(h.s, h.now).round!.blitz!.review).toEqual({ total: 10, decided: 0 });
    expect(JSON.stringify(tvView(h.s, h.now))).not.toContain("Seabiscuit"); // never on the TV before the reveal
  });

  it("approved answers score; rejected and unreviewed ones don't", () => {
    const h = reviewRound();
    const items = hostView(h.s, h.now).blitzReview;
    reviewBlitzAnswer(h.s, items[0].id, "ok"); // Seabiscuit, 3 players
    reviewBlitzAnswer(h.s, items[1].id, "no"); // Sxa
    expect(tvView(h.s, h.now).round!.blitz!.review).toEqual({ total: 10, decided: 2 });
    expect(() => reviewBlitzAnswer(h.s, items[2].id, "maybe")).toThrow(/Approve or reject/);
    h.advance(20_000);
    tick(h.s, h.ctx()); // the 20 seconds run out
    expect(h.s.phase).toBe("reveal");
    expect([score(h, 0), score(h, 1), score(h, 2)]).toEqual([10, 10, 10]); // Sxa rejected, the other 10 never reviewed
    expect(tvView(h.s, h.now).reveal!.blitz!.popular).toEqual([{ text: "Seabiscuit", count: 3 }]);
  });

  it("the host can finish early with Next, and nothing is left to review afterwards", () => {
    const h = reviewRound();
    reviewBlitzAnswer(h.s, hostView(h.s, h.now).blitzReview[0].id, "ok");
    next(h.s, h.ctx());
    expect(h.s.phase).toBe("reveal");
    expect(hostView(h.s, h.now).blitzReview).toEqual([]);
    expect(() => finishBlitzReview(h.s, h.ctx())).toThrow(GameError);
  });

  it("skips review when every answer was recognized or invalid", () => {
    const h = blitz(2);
    startGame(h.s, h.ctx());
    forcePrompt(h);
    add(h, 0, "Speed");
    add(h, 1, "Hello");
    timeUp(h);
    expect(h.s.phase).toBe("reveal");
  });
});

describe("custom prompts", () => {
  it("host prompts form their own category; without answers everything goes to review", () => {
    const h = blitz(2, { blitzCategories: ["movies"] });
    addCustomBlitz(h.s, { category: "Things in a fridge", letter: "M", answers: [] }, h.ctx());
    expect(h.s.settings.blitzCategories).toEqual(["movies", "hostPrompts"]);
    expect(() => addCustomBlitz(h.s, { category: "things in a FRIDGE", letter: "M", answers: [] }, h.ctx())).toThrow(/already/);
    updateSettings(h.s, { blitzCategories: ["hostPrompts"] });
    startGame(h.s, h.ctx());
    expect(h.s.round!.question).toBe("Things in a fridge starting with M");
    add(h, 0, "Milk");
    add(h, 1, "milk");
    add(h, 1, "Mustard");
    timeUp(h);
    const items = hostView(h.s, h.now).blitzReview;
    expect(items.map((x) => [x.text, x.count])).toEqual([
      ["Milk", 2],
      ["Mustard", 1],
    ]);
    reviewBlitzAnswer(h.s, items[0].id, "ok");
    reviewBlitzAnswer(h.s, items[1].id, "ok");
    finishBlitzReview(h.s, h.ctx());
    expect([score(h, 0), score(h, 1)]).toEqual([10, 10 + 40]);
  });

  it("host prompts with answers are matched like the built-in bank", () => {
    const h = blitz(1, { blitzCategories: ["hostPrompts"] });
    addCustomBlitz(h.s, { category: "Things in a fridge", letter: "M", answers: [["Milk"], ["Mayonnaise", "Mayo"]] }, h.ctx());
    startGame(h.s, h.ctx());
    add(h, 0, "mayo");
    timeUp(h);
    expect(score(h, 0)).toBe(40);
  });

  it("removing the last host prompt drops the category", () => {
    const h = blitz(1);
    addCustomBlitz(h.s, { category: "Snacks", letter: "C", answers: [] }, h.ctx());
    removeCustomBlitz(h.s, h.s.customBlitz[0].id);
    expect(h.s.settings.blitzCategories).not.toContain("hostPrompts");
    expect(hostView(h.s, h.now).customBlitz).toEqual([]);
  });

  it("never repeats a prompt within a game", () => {
    const h = blitz(1, { blitzCategories: ["food"], rounds: 15 });
    startGame(h.s, h.ctx());
    const seen = new Set<string>();
    for (let n = 1; n <= 15; n++) {
      seen.add(B(h).promptKey);
      if (n < 15) nextRound(h);
    }
    expect(seen.size).toBe(15);
  });
});

describe("power-ups", () => {
  it("Freeze locks a rival's answer box for 5s, never in the final 5 seconds", () => {
    const h = blitz(3);
    startGame(h.s, h.ctx());
    forcePrompt(h);
    activatePowerup(h.s, h.ids[0], "freeze", h.ids[1], h.ctx());
    expect(() => add(h, 1, "Saw")).toThrow(/frozen/);
    h.advance(5000);
    expect(add(h, 1, "Saw").added).toBe(true);
    h.advance(21_000); // under 5s left
    expect(() => activatePowerup(h.s, h.ids[0], "freeze", h.ids[2], h.ctx())).toThrow(/final 5 seconds/);
    expect(playerView(h.s, h.ids[0], h.now).my!.freezeTargets).toEqual([]);
  });

  it("Get a Suggestion privately gives one valid answer to that player only", () => {
    const h = blitz(2);
    startGame(h.s, h.ctx());
    forcePrompt(h);
    activatePowerup(h.s, h.ids[0], "reveal", null, h.ctx());
    const tip = playerView(h.s, h.ids[0], h.now).my!.blitz!.suggestion!;
    expect(MOVIES_S.map((g) => g[0])).toContain(tip);
    expect(JSON.stringify(playerView(h.s, h.ids[1], h.now))).not.toContain(`"${tip}"`);
    expect(JSON.stringify(tvView(h.s, h.now))).not.toContain(`"${tip}"`);
    expect(JSON.stringify(hostView(h.s, h.now))).not.toContain(`"${tip}"`);
    expect(() => activatePowerup(h.s, h.ids[0], "reveal", null, h.ctx())).toThrow(/already have/);
    add(h, 0, tip);
    timeUp(h);
    expect(score(h, 0)).toBe(40);
  });

  it("Get a Suggestion has nothing to give for a host prompt without answers (and isn't used up)", () => {
    const h = blitz(1, { blitzCategories: ["hostPrompts"] });
    addCustomBlitz(h.s, { category: "Snacks", letter: "C", answers: [] }, h.ctx());
    startGame(h.s, h.ctx());
    expect(() => activatePowerup(h.s, h.ids[0], "reveal", null, h.ctx())).toThrow(/No suggestions/);
    expect(h.s.players[0].powerupsLeft).toBe(2);
  });

  it("Extra Time adds 5 seconds for that player only", () => {
    const h = blitz(2);
    startGame(h.s, h.ctx());
    forcePrompt(h);
    activatePowerup(h.s, h.ids[0], "extraLife", null, h.ctx());
    expect(() => activatePowerup(h.s, h.ids[0], "extraLife", null, h.ctx())).toThrow(/already added/);
    const deadline = h.s.round!.deadline;
    expect(playerView(h.s, h.ids[0], h.now).my!.blitz!.timer.deadline).toBe(deadline + 5000);
    h.advance(deadline - h.now + 1000);
    tick(h.s, h.ctx());
    expect(h.s.phase).toBe("round"); // still going for player 0
    expect(tvView(h.s, h.now).round!.blitz!.extraTime).toBe(true);
    expect(() => submitBlitzAnswer(h.s, h.ids[1], "Saw", h.ctx())).toThrow(/Time's up/);
    expect(submitBlitzAnswer(h.s, h.ids[0], "Saw", h.ctx()).added).toBe(true);
    h.advance(4500);
    tick(h.s, h.ctx());
    expect(h.s.phase).toBe("reveal");
    expect(score(h, 0)).toBe(40);
  });

  it("keeps the 2-per-game limit, and skipping refunds them", () => {
    const h = blitz(3);
    startGame(h.s, h.ctx());
    forcePrompt(h);
    activatePowerup(h.s, h.ids[0], "extraLife", null, h.ctx());
    activatePowerup(h.s, h.ids[0], "reveal", null, h.ctx());
    expect(() => activatePowerup(h.s, h.ids[0], "freeze", h.ids[1], h.ctx())).toThrow(/both power-ups/);
    skipWord(h.s, h.ctx());
    expect(h.s.players[0].powerupsLeft).toBe(2);
    expect(h.s.players.every((p) => p.score === 0)).toBe(true);
  });
});

describe("Loser Picks, Dare Wheel, Sudden Death, removal and awards", () => {
  it("the round's lowest scorer picks the next category from the host's selection", () => {
    const h = blitz(2, { blitzCategories: ["places", "animals", "food"] });
    startGame(h.s, h.ctx());
    forcePrompt(h);
    add(h, 0, "Saw");
    timeUp(h);
    next(h.s, h.ctx());
    expect(h.s.phase).toBe("loserPick");
    expect(h.s.loserPick).toMatchObject({ playerId: h.ids[1], kind: "category" });
    expect([...h.s.loserPick!.options].sort()).toEqual(availableBlitzCategories(h.s).sort());
    expect(tvView(h.s, h.now).loserPick!.options.map((o) => o.label)).toEqual(expect.arrayContaining(["Places", "Animals"]));
    pickCategory(h.s, h.ids[1], "animals", h.ctx());
    expect(h.s.round!.category).toBe("animals");
  });

  it("the Dare Wheel works between Category Blitz rounds", () => {
    const h = blitz(2, { dareWheel: true, dareEvery: 2 });
    startGame(h.s, h.ctx());
    nextRound(h);
    skipWord(h.s, h.ctx());
    next(h.s, h.ctx());
    expect(h.s.phase).toBe("dare");
  });

  function tieAtTheEnd(h: H, scores: number[]) {
    startGame(h.s, h.ctx());
    for (let i = 1; i < 5; i++) nextRound(h);
    skipWord(h.s, h.ctx());
    scores.forEach((sc, i) => (h.s.players[i].score = sc));
    next(h.s, h.ctx());
  }

  it("Category Blitz-only Sudden Death: first valid answer wins", () => {
    const h = blitz(3);
    tieAtTheEnd(h, [200, 200, 50]);
    const r = h.s.round!;
    expect(r).toMatchObject({ kind: "suddenDeath", mode: "blitz" });
    expect(r.participants).toEqual([h.ids[0], h.ids[1]]);
    expect(r.category).not.toBe("hostPrompts");
    forcePrompt(h);
    expect(() => add(h, 2, "Saw")).toThrow(/next round/);
    expect(() => activatePowerup(h.s, h.ids[0], "extraLife", null, h.ctx())).toThrow(/No power-ups/);
    add(h, 1, "Superman");
    expect(h.s.winnerId).toBe(h.ids[1]);
    expect(score(h, 1)).toBe(200); // no points in Sudden Death
    next(h.s, h.ctx());
    expect(h.s.phase).toBe("ended");
  });

  it("an invalid answer eliminates; if everyone is out, another prompt", () => {
    const h = blitz(3);
    tieAtTheEnd(h, [200, 200, 50]);
    forcePrompt(h);
    const first = B(h).promptKey;
    add(h, 0, "Sandwich");
    expect(h.s.round!.progress[h.ids[0]].status).toBe("out");
    expect(() => add(h, 0, "Saw")).toThrow(/done for this round/);
    add(h, 1, "Batman"); // wrong letter
    expect(h.s.phase).toBe("reveal");
    expect(h.s.winnerId).toBeNull();
    next(h.s, h.ctx());
    expect(h.s.round!.kind).toBe("suddenDeath");
    expect(h.s.round!.sdAttempt).toBe(2);
    expect(B(h).promptKey).not.toBe(first);
  });

  it("games with word rounds keep their Sudden Death", () => {
    const set = (mixedModes: Settings["mixedModes"]) => harness({ players: 2, settings: { mode: "mixed", mixedModes } }).s;
    expect(suddenDeathMode(set(["hangman", "blitz"]))).toBe("hangman");
    expect(suddenDeathMode(set(["emoji", "blitz"]))).toBe("emoji");
    expect(suddenDeathMode(set(["mlt", "blitz"]))).toBe("blitz");
    expect(suddenDeathMode(blitz().s)).toBe("blitz");
  });

  it("a removed player can't answer and their answers stop counting for uniqueness", () => {
    const h = blitz(3);
    startGame(h.s, h.ctx());
    forcePrompt(h);
    add(h, 0, "Saw");
    add(h, 2, "Saw");
    removePlayer(h.s, h.ids[2], h.ctx());
    expect(() => add(h, 2, "Speed")).toThrow(/not in this game/);
    timeUp(h);
    expect(score(h, 0)).toBe(40); // unique again
  });

  it("Original Thinker and Blitz Machine; hidden without qualifying data", () => {
    const h = blitz(2);
    startGame(h.s, h.ctx());
    forcePrompt(h);
    add(h, 0, "Saw");
    add(h, 0, "Speed");
    add(h, 1, "Saw");
    add(h, 1, "Signs");
    add(h, 1, "Split");
    timeUp(h);
    endGame(h.s, h.ctx());
    const awards = computeAwards(h.s);
    expect(awards.find((a) => a.key === "blitzMachine")).toMatchObject({ playerId: h.ids[1], detail: "3 valid answers" });
    expect(awards.find((a) => a.key === "originalThinker")).toMatchObject({ playerId: h.ids[1] });
    const none = blitz(2);
    startGame(none.s, none.ctx());
    endGame(none.s, none.ctx());
    expect(computeAwards(none.s).filter((a) => ["originalThinker", "blitzMachine"].includes(a.key))).toEqual([]);
  });
});

describe("answer protection and refresh", () => {
  it("no screen carries an accepted answer or anyone else's answers before the reveal", () => {
    const h = blitz(3, { blitzCategories: ["places"] });
    startGame(h.s, h.ctx());
    const accepted = B(h).answers.flat();
    add(h, 0, accepted[0]);
    add(h, 1, "Secret guess");
    const others = [tvView(h.s, h.now), hostView(h.s, h.now), playerView(h.s, h.ids[2], h.now)].map((v) => JSON.stringify(v));
    for (const json of others) {
      for (const a of accepted) expect(json).not.toContain(`"${a}"`);
      expect(json).not.toContain("Secret guess");
      expect(json).not.toMatch(/"subs"|"answers":\[\[|"suggestions"/);
    }
    // Your own phone shows only what you typed.
    const mine = JSON.stringify(playerView(h.s, h.ids[0], h.now));
    for (const a of accepted.slice(1)) expect(mine).not.toContain(`"${a}"`);
    // After the round, the accepted answers and everyone's answers are gone from the server state too.
    timeUp(h);
    if (h.s.phase === "round") finishBlitzReview(h.s, h.ctx());
    expect(B(h).answers).toEqual([]);
    expect(B(h).subs).toEqual({});
  });

  it("the TV shows how many answers each player has added, never the text", () => {
    const h = blitz(2);
    startGame(h.s, h.ctx());
    forcePrompt(h);
    add(h, 0, "Saw");
    add(h, 0, "Spoons");
    const tv = tvView(h.s, h.now);
    expect(tv.rivals.find((r) => r.id === h.ids[0])!.count).toBe(2);
    expect(tv.rivals.find((r) => r.id === h.ids[1])!.count).toBe(0);
    expect(JSON.stringify(tv)).not.toContain("Spoons");
  });

  it("a fresh view restores the prompt, timer, answers, power-ups and score", () => {
    const h = blitz(2);
    startGame(h.s, h.ctx());
    forcePrompt(h);
    add(h, 0, "Shrek");
    activatePowerup(h.s, h.ids[0], "extraLife", null, h.ctx());
    const v = playerView(h.s, h.ids[0], h.now);
    expect(v.round).toMatchObject({ mode: "blitz", question: h.s.round!.question });
    expect(v.round!.blitz).toMatchObject({ category: h.s.round!.blitz!.categoryLabel, letter: "S" });
    expect(v.my!.blitz).toMatchObject({ answers: ["Shrek"], extraTime: true, max: 20 });
    expect(v.my!.blitz!.timer.remainingMs).toBeGreaterThan(0);
    expect(v.me).toMatchObject({ powerupsLeft: 1, score: 0 });
  });
});
