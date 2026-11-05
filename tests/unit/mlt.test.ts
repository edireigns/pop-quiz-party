import { describe, expect, it } from "vitest";
import {
  activatePowerup,
  addCustomQuestion,
  addPlayer,
  castVote,
  createGame,
  endGame,
  guess,
  next,
  pickCategory,
  removePlayer,
  roundModeFor,
  skipWord,
  startGame,
  submitAnswer,
  submitQuestion,
  suddenDeathMode,
  takeHint,
  tick,
  updateSettings,
  upgradeState,
} from "@/lib/game/engine";
import { computeAwards } from "@/lib/game/awards";
import { hostView, playerView, tvView } from "@/lib/game/views";
import { GameError, type GameState, type Settings } from "@/lib/game/types";
import { harness } from "./helpers";

const mlt = (players = 4, extra: Partial<Settings> = {}, seed = 42) =>
  harness({ players, seed, settings: { mode: "mlt", rounds: 5, voteSec: 20, ...extra } });

/** Vote for everyone with a short pause between (stays under the rate limit). */
function voteAll(h: ReturnType<typeof harness>, votes: Record<number, number>) {
  for (const [voter, target] of Object.entries(votes)) {
    h.advance(400);
    castVote(h.s, h.ids[Number(voter)], h.ids[target], h.ctx());
  }
}

function toNextRound(h: ReturnType<typeof harness>) {
  if (h.s.phase === "round") skipWord(h.s, h.ctx());
  next(h.s, h.ctx());
  while (h.s.phase === "loserPick" || h.s.phase === "dare") next(h.s, h.ctx());
}

describe("mode selection", () => {
  it("validates the new settings, and Hangman stays the default", () => {
    const h = harness({ players: 3 });
    expect(h.s.settings.mode).toBe("hangman");
    expect(h.s.settings.mixedModes).toEqual(["hangman", "emoji"]);
    expect(h.s.settings.voteSec).toBe(20);
    expect(h.s.settings.packs).toEqual(["college", "friends", "chaos", "future", "habits"]);
    updateSettings(h.s, { mode: "mlt", voteSec: 30, packs: ["chaos", "habits"] });
    expect(h.s.settings).toMatchObject({ mode: "mlt", voteSec: 30, packs: ["chaos", "habits"] });
    expect(() => updateSettings(h.s, { voteSec: 25 as never })).toThrow(GameError);
    expect(() => updateSettings(h.s, { packs: [] })).toThrow(/question pack/);
    expect(() => updateSettings(h.s, { mixedModes: ["mlt"] })).toThrow(/at least two/);
    updateSettings(h.s, { mixedModes: ["mlt", "hangman", "mlt"] as never });
    expect(h.s.settings.mixedModes).toEqual(["hangman", "mlt"]); // canonical order, no duplicates
  });

  it("uses the voting timer and the question packs", () => {
    const h = mlt(3, { voteSec: 15, packs: ["future"] });
    startGame(h.s, h.ctx());
    const r = h.s.round!;
    expect(r.mode).toBe("mlt");
    expect(r.durationMs).toBe(15_000);
    expect(r.category).toBe("future");
    expect(r.question).toMatch(/^Who is most likely to .+\?$/);
    expect(r.candidates).toEqual(h.ids);
  });

  it("needs at least 3 active players to start a Most Likely To game", () => {
    const h = mlt(2);
    expect(() => startGame(h.s, h.ctx())).toThrow(/at least 3 players/);
    addPlayer(h.s, { nickname: "Third", tokenHash: "x" }, h.ctx());
    startGame(h.s, h.ctx());
    expect(h.s.round!.mode).toBe("mlt");
  });

  it("Mixed default is unchanged; Mixed rotates through the chosen modes", () => {
    const def = harness({ players: 3, settings: { mode: "mixed" } });
    expect([1, 2, 3, 4].map((n) => roundModeFor(def.s, n))).toEqual(["hangman", "emoji", "hangman", "emoji"]);
    const h = harness({ players: 3, settings: { mode: "mixed", mixedModes: ["hangman", "emoji", "mlt"], rounds: 10 } });
    startGame(h.s, h.ctx());
    const modes: string[] = [];
    for (let i = 0; i < 6; i++) {
      modes.push(h.s.round!.mode);
      toNextRound(h);
    }
    expect(modes).toEqual(["hangman", "emoji", "mlt", "hangman", "emoji", "mlt"]);
  });

  it("Mixed skips Most Likely To rounds while fewer than 3 players are active", () => {
    const h = harness({ players: 2, settings: { mode: "mixed", mixedModes: ["hangman", "mlt"], rounds: 10 } });
    startGame(h.s, h.ctx());
    const modes: string[] = [];
    for (let i = 0; i < 4; i++) {
      modes.push(h.s.round!.mode);
      toNextRound(h);
    }
    expect(modes).toEqual(["hangman", "hangman", "hangman", "hangman"]);
    addPlayer(h.s, { nickname: "Third", tokenHash: "x" }, h.ctx());
    // round 6 would be Most Likely To in the rotation — now there are 3 players
    while (h.s.roundsPlayed < 5) toNextRound(h);
    toNextRound(h);
    expect(h.s.round!.number).toBe(6);
    expect(h.s.round!.mode).toBe("mlt");
  });

  it("a Most Likely To-only game holds and tells the host when it drops below 3 players", () => {
    const h = mlt(3);
    startGame(h.s, h.ctx());
    skipWord(h.s, h.ctx());
    removePlayer(h.s, h.ids[2], h.ctx());
    next(h.s, h.ctx());
    expect(h.s.hold).toBe("needPlayers");
    expect(h.s.phase).toBe("reveal");
    expect(tvView(h.s, h.now).hold).toBe("needPlayers");
    expect(hostView(h.s, h.now).hold).toBe("needPlayers");
    next(h.s, h.ctx()); // still held
    expect(h.s.roundsPlayed).toBe(1);
    addPlayer(h.s, { nickname: "Late", tokenHash: "late" }, h.ctx());
    next(h.s, h.ctx());
    expect(h.s.hold).toBeNull();
    expect(h.s.phase).toBe("round");
    expect(h.s.round!.number).toBe(2);
  });

  it("word-game actions are rejected in Most Likely To rounds", () => {
    const h = mlt(3);
    startGame(h.s, h.ctx());
    expect(() => guess(h.s, h.ids[0], "A", h.ctx())).toThrow(/Most Likely To/);
    expect(() => takeHint(h.s, h.ids[0], h.ctx())).toThrow(/no hints/);
    expect(() => submitAnswer(h.s, h.ids[0], "anything", h.ctx())).toThrow(/Hangman round|wrong/i);
  });
});

describe("voting", () => {
  it("one locked vote per player per round; voting for yourself is allowed", () => {
    const h = mlt(3);
    startGame(h.s, h.ctx());
    castVote(h.s, h.ids[0], h.ids[0], h.ctx());
    expect(h.s.round!.progress[h.ids[0]].status).toBe("voted");
    h.advance(400);
    expect(() => castVote(h.s, h.ids[0], h.ids[1], h.ctx())).toThrow(/locked/);
  });

  it("rejects votes for players who aren't options, and from players who aren't voters", () => {
    const h = mlt(3);
    startGame(h.s, h.ctx());
    expect(() => castVote(h.s, h.ids[0], "nobody", h.ctx())).toThrow(/isn't an option/);
    h.advance(400); // invalid attempts still count toward the rate limit
    expect(() => castVote(h.s, h.ids[0], 42, h.ctx())).toThrow(/isn't an option/);
    const late = addPlayer(h.s, { nickname: "Late", tokenHash: "late" }, h.ctx());
    h.advance(400);
    expect(() => castVote(h.s, h.ids[0], late.id, h.ctx())).toThrow(/isn't an option/); // late joiners: next round
    expect(() => castVote(h.s, late.id, h.ids[0], h.ctx())).toThrow(/next round/);
    toNextRound(h);
    expect(h.s.round!.candidates).toContain(late.id);
    castVote(h.s, late.id, h.ids[0], h.ctx());
  });

  it("rate-limits vote requests", () => {
    const h = mlt(3);
    startGame(h.s, h.ctx());
    expect(() => castVote(h.s, h.ids[0], "bogus", h.ctx())).toThrow(/isn't an option/);
    expect(() => castVote(h.s, h.ids[0], h.ids[1], h.ctx())).toThrow(/slow down/i);
  });

  it("ends when every active player has voted, or when the timer expires", () => {
    const h = mlt(3);
    startGame(h.s, h.ctx());
    voteAll(h, { 0: 1, 1: 1 });
    expect(h.s.phase).toBe("round");
    voteAll(h, { 2: 0 });
    expect(h.s.phase).toBe("reveal");
    const t = mlt(3);
    startGame(t.s, t.ctx());
    t.advance(20_000);
    tick(t.s, t.ctx());
    expect(t.s.phase).toBe("reveal");
  });
});

describe("scoring", () => {
  it("+100 for voting for the crowned player, +50 to the crowned player, 0 otherwise", () => {
    const h = mlt(4);
    startGame(h.s, h.ctx());
    voteAll(h, { 0: 1, 1: 1, 2: 1, 3: 0 }); // P2 crowned with 3 votes
    expect(h.s.phase).toBe("reveal");
    expect(h.s.round!.crowned).toEqual([h.ids[1]]);
    expect(h.s.players.map((p) => p.score)).toEqual([100, 150, 100, 0]);
    expect(h.s.round!.progress[h.ids[3]].voteResult).toBe("wrong");
  });

  it("points are only applied when the round ends (the leaderboard can't leak the lead)", () => {
    const h = mlt(3);
    startGame(h.s, h.ctx());
    voteAll(h, { 0: 1, 1: 1 });
    expect(h.s.players.map((p) => p.score)).toEqual([0, 0, 0]);
  });

  it("a tie crowns everyone tied, and votes for any of them count", () => {
    const h = mlt(4);
    startGame(h.s, h.ctx());
    voteAll(h, { 0: 1, 1: 0, 2: 1, 3: 0 }); // P1 and P2 tied on 2
    expect([...h.s.round!.crowned!].sort()).toEqual([h.ids[0], h.ids[1]].sort());
    expect(h.s.players.map((p) => p.score)).toEqual([150, 150, 100, 100]);
  });

  it("a missed vote scores 0", () => {
    const h = mlt(3);
    startGame(h.s, h.ctx());
    voteAll(h, { 0: 1, 1: 1 });
    h.advance(20_000);
    tick(h.s, h.ctx());
    expect(h.s.round!.progress[h.ids[2]].voteResult).toBe("missed");
    expect(h.s.players.map((p) => p.score)).toEqual([100, 150, 0]);
  });

  it("if nobody votes, no one is crowned and no points are awarded", () => {
    const h = mlt(3);
    startGame(h.s, h.ctx());
    h.advance(20_000);
    tick(h.s, h.ctx());
    expect(h.s.round!.crowned).toEqual([]);
    expect(h.s.players.every((p) => p.score === 0)).toBe(true);
    expect(tvView(h.s, h.now).reveal!.crowned).toEqual([]);
  });

  it("doubles everything in the final round", () => {
    const h = mlt(3);
    startGame(h.s, h.ctx());
    for (let i = 1; i < 5; i++) toNextRound(h);
    expect(h.s.round!.kind).toBe("final");
    voteAll(h, { 0: 1, 1: 1, 2: 0 });
    expect(h.s.players.map((p) => p.score)).toEqual([200, 300, 0]);
  });

  it("the host can skip before the reveal: no points, votes discarded unseen", () => {
    const h = mlt(3);
    startGame(h.s, h.ctx());
    voteAll(h, { 0: 1, 1: 1 });
    skipWord(h.s, h.ctx());
    expect(h.s.players.every((p) => p.score === 0)).toBe(true);
    expect(h.s.round!.votes).toEqual({});
    expect(tvView(h.s, h.now).reveal!.totals).toBeNull();
    expect(playerView(h.s, h.ids[0], h.now).my!.voteResult).toBeNull();
  });

  it("scores stay on the shared leaderboard across modes", () => {
    const h = harness({ players: 3, settings: { mode: "mixed", mixedModes: ["hangman", "mlt"], rounds: 5 } });
    startGame(h.s, h.ctx());
    h.s.players[0].score = 70; // as if earned in Hangman
    toNextRound(h);
    expect(h.s.round!.mode).toBe("mlt");
    voteAll(h, { 0: 1, 1: 1, 2: 1 });
    expect(h.s.players[0].score).toBe(170);
  });
});

describe("power-ups", () => {
  it("Freeze locks a rival's voting screen for 5s, but never in the final 5 seconds", () => {
    const h = mlt(4);
    startGame(h.s, h.ctx());
    activatePowerup(h.s, h.ids[0], "freeze", h.ids[1], h.ctx());
    expect(() => castVote(h.s, h.ids[1], h.ids[2], h.ctx())).toThrow(/frozen/);
    h.advance(5_000);
    castVote(h.s, h.ids[1], h.ids[2], h.ctx());
    expect(() => activatePowerup(h.s, h.ids[0], "freeze", h.ids[1], h.ctx())).toThrow(/already voted/);
    h.advance(10_100); // 4.9s left
    expect(() => activatePowerup(h.s, h.ids[0], "freeze", h.ids[2], h.ctx())).toThrow(/final 5 seconds/);
    expect(playerView(h.s, h.ids[0], h.now).my!.freezeTargets).toEqual([]);
  });

  it("Peek privately shows the current leader", () => {
    const h = mlt(4);
    startGame(h.s, h.ctx());
    voteAll(h, { 1: 2, 2: 2 });
    activatePowerup(h.s, h.ids[0], "reveal", null, h.ctx());
    expect(playerView(h.s, h.ids[0], h.now).my!.peek).toEqual({ names: ["Player3"], votes: 2 });
    expect(playerView(h.s, h.ids[3], h.now).my!.peek).toBeNull();
    expect(JSON.stringify(tvView(h.s, h.now))).not.toContain('"peek"');
  });

  it("Double Vote counts one vote twice", () => {
    const h = mlt(4);
    startGame(h.s, h.ctx());
    activatePowerup(h.s, h.ids[0], "extraLife", null, h.ctx());
    expect(playerView(h.s, h.ids[0], h.now).my!.doubleVote).toBe(true);
    voteAll(h, { 0: 3, 1: 2, 2: 1 }); // P4 gets 2 (doubled), others 1
    voteAll(h, { 3: 1 }); // P2 gets 2 too -> tie between P2 and P4
    expect([...h.s.round!.crowned!].sort()).toEqual([h.ids[1], h.ids[3]].sort());
    expect(tvView(h.s, h.now).reveal!.totals!.find((t) => t.id === h.ids[3])!.votes).toBe(2);
  });

  it("keeps the 2-per-game limit across modes", () => {
    const h = mlt(3);
    startGame(h.s, h.ctx());
    activatePowerup(h.s, h.ids[0], "reveal", null, h.ctx());
    activatePowerup(h.s, h.ids[0], "extraLife", null, h.ctx());
    expect(() => activatePowerup(h.s, h.ids[0], "freeze", h.ids[1], h.ctx())).toThrow(/both power-ups/);
  });
});

describe("custom and friend-written questions", () => {
  it("host questions form the Host's Questions pack", () => {
    const h = mlt(3, { packs: ["chaos"] });
    addCustomQuestion(h.s, "Who is most likely to adopt a goat named Kevin?", h.ctx());
    expect(h.s.settings.packs).toEqual(["chaos", "custom"]);
    updateSettings(h.s, { packs: ["custom"] });
    startGame(h.s, h.ctx());
    expect(h.s.round!.question).toBe("Who is most likely to adopt a goat named Kevin?");
    expect(h.s.round!.category).toBe("custom");
  });

  it("friend questions fill about a third of the rounds, stay anonymous and give no author points", () => {
    const h = mlt(4, { friendWords: true, rounds: 10 });
    for (const [i, id] of h.ids.entries()) submitQuestion(h.s, id, `Who is most likely to win friend contest number ${i + 1}?`, h.ctx());
    startGame(h.s, h.ctx());
    expect(h.s.questionRoundPlan).toHaveLength(3); // round(10/3)
    let friendRounds = 0;
    for (let i = 0; i < 10; i++) {
      const r = h.s.round!;
      if (r.source === "friend") {
        friendRounds++;
        expect(r.authorId).toBeNull();
        expect(r.participants).toHaveLength(4); // the author votes too
        for (const v of [tvView(h.s, h.now), hostView(h.s, h.now)]) expect(JSON.stringify(v)).not.toMatch(/"author(Id|Name)":"[^n]/);
        voteAll(h, { 0: 1, 1: 1, 2: 1, 3: 1 });
        // +100 vote, +50 crowned, no author bonus (doubled if this happened to be the final round)
        expect(h.s.history.at(-1)!.results[h.ids[1]].points).toBe(150 * r.multiplier);
        expect(h.s.players.map((p) => p.stats.stumped)).toEqual([0, 0, 0, 0]);
        next(h.s, h.ctx());
        while (h.s.phase === "loserPick" || h.s.phase === "dare") next(h.s, h.ctx());
      } else if (i < 9) toNextRound(h);
    }
    expect(friendRounds).toBe(3);
  });

  it("never repeats a question within a game", () => {
    const h = mlt(3, { rounds: 20, packs: ["college"] });
    startGame(h.s, h.ctx());
    const qs: string[] = [];
    for (let i = 0; i < 20; i++) {
      qs.push(h.s.round!.question!);
      if (i < 19) toNextRound(h);
    }
    expect(new Set(qs).size).toBe(20);
  });
});

describe("player removal", () => {
  it("a removed player's own vote is discarded and they can't vote again", () => {
    const h = mlt(4);
    startGame(h.s, h.ctx());
    voteAll(h, { 3: 0 });
    removePlayer(h.s, h.ids[3], h.ctx());
    expect(() => castVote(h.s, h.ids[3], h.ids[0], h.ctx())).toThrow(/not in this game/);
    voteAll(h, { 0: 1, 1: 1, 2: 0 });
    expect(h.s.round!.crowned).toEqual([h.ids[1]]); // P1 didn't keep the removed player's vote
  });

  it("votes FOR a removed player are returned so those voters can vote again", () => {
    const h = mlt(4);
    startGame(h.s, h.ctx());
    voteAll(h, { 0: 3, 1: 3, 2: 0 });
    removePlayer(h.s, h.ids[3], h.ctx());
    const r = h.s.round!;
    expect(r.candidates).not.toContain(h.ids[3]);
    expect(r.progress[h.ids[0]].status).toBe("playing");
    expect(playerView(h.s, h.ids[0], h.now).my!.voteReset).toBe(true);
    expect(tvView(h.s, h.now).round!.answered).toEqual({ done: 1, total: 3 });
    expect(() => castVote(h.s, h.ids[0], h.ids[3], h.ctx())).toThrow(); // removed: not an option
    voteAll(h, { 0: 2, 1: 2 });
    expect(h.s.phase).toBe("reveal");
    expect(h.s.round!.crowned).toEqual([h.ids[2]]);
    // crowned (+50); their own vote went to Player1, who wasn't crowned
    expect(h.s.players.find((p) => p.id === h.ids[2])!.score).toBe(50);
    expect(h.s.players.find((p) => p.id === h.ids[0])!.score).toBe(100);
  });

  it("votes FOR a removed player that aren't recast before time runs out count as missed", () => {
    const h = mlt(4);
    startGame(h.s, h.ctx());
    voteAll(h, { 0: 3, 1: 2, 2: 1 });
    removePlayer(h.s, h.ids[3], h.ctx());
    h.advance(20_000);
    tick(h.s, h.ctx());
    expect(h.s.round!.progress[h.ids[0]].voteResult).toBe("missed");
    expect(h.s.round!.totals![h.ids[3]]).toBeUndefined();
  });

  it("removed players are not options in later rounds", () => {
    const h = mlt(4);
    startGame(h.s, h.ctx());
    removePlayer(h.s, h.ids[3], h.ctx());
    toNextRound(h);
    expect(h.s.round!.candidates).toEqual(h.ids.slice(0, 3));
    expect(tvView(h.s, h.now).round!.candidates.map((c) => c.id)).toEqual(h.ids.slice(0, 3));
  });
});

describe("Sudden Death", () => {
  function tieAtTheEnd(h: ReturnType<typeof harness>, scores: number[]) {
    startGame(h.s, h.ctx());
    for (let i = 1; i <= 5; i++) {
      skipWord(h.s, h.ctx());
      if (i < 5) {
        next(h.s, h.ctx());
        while (h.s.phase !== "round") next(h.s, h.ctx());
      }
    }
    scores.forEach((sc, i) => (h.s.players[i].score = sc));
    next(h.s, h.ctx());
  }

  it("Most Likely To-only: the non-tied players vote on the tied players", () => {
    const h = mlt(4);
    tieAtTheEnd(h, [300, 300, 100, 50]);
    const r = h.s.round!;
    expect(r.kind).toBe("suddenDeath");
    expect(r.mode).toBe("mlt");
    expect(r.candidates).toEqual([h.ids[0], h.ids[1]]);
    expect(r.participants).toEqual([h.ids[2], h.ids[3]]);
    expect(() => castVote(h.s, h.ids[0], h.ids[1], h.ctx())).toThrow(/next round/);
    expect(() => castVote(h.s, h.ids[2], h.ids[3], h.ctx())).toThrow(/isn't an option/);
    voteAll(h, { 2: 1, 3: 1 });
    expect(h.s.winnerId).toBe(h.ids[1]);
    expect(h.s.players[1].score).toBe(300); // no points in Sudden Death
    next(h.s, h.ctx());
    expect(h.s.phase).toBe("ended");
  });

  it("a tied Sudden Death vote picks the winner at random", () => {
    const winners = new Set<string>();
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const h = mlt(4, {}, seed);
      tieAtTheEnd(h, [300, 300, 100, 50]);
      voteAll(h, { 2: 0, 3: 1 });
      expect([h.ids[0], h.ids[1]]).toContain(h.s.winnerId);
      winners.add(h.s.winnerId === h.ids[0] ? "a" : "b");
    }
    expect(winners.size).toBe(2);
  });

  it("if everyone is tied there's nobody to vote: random winner", () => {
    const h = mlt(3);
    tieAtTheEnd(h, [100, 100, 100]);
    expect(h.s.phase).toBe("ended");
    expect(h.ids).toContain(h.s.winnerId);
  });

  it("games with word rounds keep the word-game Sudden Death", () => {
    const set = (mixedModes: Settings["mixedModes"]) => harness({ players: 3, settings: { mode: "mixed", mixedModes } }).s;
    expect(suddenDeathMode(set(["hangman", "mlt"]))).toBe("hangman");
    expect(suddenDeathMode(set(["emoji", "mlt"]))).toBe("emoji");
    expect(suddenDeathMode(set(["hangman", "emoji"]))).toBe("hangman");
  });
});

describe("Loser Picks and Dare Wheel", () => {
  it("the lowest scorer picks the next question pack", () => {
    const h = mlt(3, { packs: ["chaos", "future"] });
    startGame(h.s, h.ctx());
    voteAll(h, { 0: 1, 1: 1, 2: 0 });
    next(h.s, h.ctx());
    expect(h.s.phase).toBe("loserPick");
    expect(h.s.loserPick!.kind).toBe("pack");
    expect(h.s.loserPick!.playerId).toBe(h.ids[2]);
    expect(tvView(h.s, h.now).loserPick!.options.map((o) => o.label).sort()).toEqual(["Chaos", "Future Predictions"]);
    pickCategory(h.s, h.ids[2], "future", h.ctx());
    expect(h.s.round!.category).toBe("future");
  });

  it("before a word round in Mixed, Loser Picks offers categories as before", () => {
    const h = harness({ players: 3, settings: { mode: "mixed", mixedModes: ["hangman", "mlt"], categories: ["food", "movies"] } });
    startGame(h.s, h.ctx());
    toNextRound(h); // round 2 = MLT
    voteAll(h, { 0: 1, 1: 1, 2: 0 });
    next(h.s, h.ctx());
    expect(h.s.loserPick!.kind).toBe("category");
    expect([...h.s.loserPick!.options].sort()).toEqual(["food", "movies"]);
  });

  it("the Dare Wheel works between Most Likely To rounds", () => {
    const h = mlt(3, { dareWheel: true, dareEvery: 2, packs: ["chaos"] });
    startGame(h.s, h.ctx());
    skipWord(h.s, h.ctx());
    next(h.s, h.ctx());
    skipWord(h.s, h.ctx());
    next(h.s, h.ctx());
    expect(h.s.phase).toBe("dare");
  });
});

describe("awards", () => {
  it("Crowd Favorite and Mind Reader; awards without qualifying data are hidden", () => {
    const h = mlt(3);
    startGame(h.s, h.ctx());
    for (let i = 0; i < 5; i++) {
      voteAll(h, { 0: 1, 1: 1, 2: 0 });
      if (i < 4) {
        next(h.s, h.ctx());
        while (h.s.phase === "loserPick" || h.s.phase === "dare") next(h.s, h.ctx());
      }
    }
    endGame(h.s, h.ctx());
    const awards = computeAwards(h.s);
    const keys = awards.map((a) => a.key);
    expect(awards.find((a) => a.key === "crowdFavorite")!.playerId).toBe(h.ids[1]);
    expect(awards.find((a) => a.key === "mindReader")!.nickname).toMatch(/Player[12]/);
    for (const k of ["speedDemon", "livesLost", "hintAddict", "masterStumper", "emojiWhisperer"]) expect(keys).not.toContain(k);
  });
});

describe("vote privacy", () => {
  /** Play one round with the given votes and capture every view at each step. */
  function snapshots(votes: Record<number, number>) {
    const h = mlt(3);
    startGame(h.s, h.ctx());
    const shots: string[] = [];
    const capture = () => {
      shots.push(JSON.stringify(tvView(h.s, h.now)));
      shots.push(JSON.stringify(hostView(h.s, h.now)));
      for (const id of h.ids) shots.push(JSON.stringify(playerView(h.s, id, h.now)));
    };
    capture();
    for (const [voter, target] of Object.entries(votes)) {
      h.advance(400);
      castVote(h.s, h.ids[Number(voter)], h.ids[target], h.ctx());
      capture();
    }
    return { h, shots };
  }

  it("every screen's data is identical whoever voted for whom (same totals)", () => {
    // Each player gets one vote either way, so totals are identical.
    const a = snapshots({ 0: 1, 1: 2, 2: 0 });
    const b = snapshots({ 0: 2, 1: 0, 2: 1 });
    expect(a.shots).toEqual(b.shots);
    expect(a.h.s.phase).toBe("reveal");
  });

  it("no view, not even the voter's own phone, carries an individual vote", () => {
    const { h, shots } = snapshots({ 0: 1, 1: 1 });
    for (const json of shots) {
      expect(json).not.toContain('"votes":{');
      expect(json).not.toContain("targetId");
      expect(json).not.toMatch(/"(myVote|votedFor|vote)":/);
    }
    // the vote mapping is wiped from the server state once scored
    h.advance(20_000);
    tick(h.s, h.ctx());
    expect(h.s.round!.votes).toEqual({});
    expect(h.s.round!.totals).toEqual({ [h.ids[0]]: 0, [h.ids[1]]: 2, [h.ids[2]]: 0 });
  });

  it("older saved rooms without the new fields upgrade cleanly", () => {
    const fresh = createGame({ roomId: "r", code: "ABCDE", now: 0 });
    const old = JSON.parse(JSON.stringify(fresh)) as GameState & Record<string, unknown>;
    for (const k of ["customQuestions", "questionSubs", "usedQuestions", "questionRoundPlan", "hold"]) delete old[k];
    for (const k of ["mixedModes", "voteSec", "packs"]) delete (old.settings as unknown as Record<string, unknown>)[k];
    expect(upgradeState(old)).toEqual(fresh);
  });
});
