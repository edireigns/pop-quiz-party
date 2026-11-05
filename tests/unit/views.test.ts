import { describe, expect, it } from "vitest";
import { guess, next, startGame, submitWord, tick, takeHint, activatePowerup, submitAnswer, dropHint } from "@/lib/game/engine";
import { hostView, playerView, tvView } from "@/lib/game/views";
import { forceWord, harness, WRONG_FOR } from "./helpers";

const SECRET = "Quixotic Zephyr Jukebox";
const HINT = "Secret hint text 123";

function allViews(h: ReturnType<typeof harness>) {
  return [
    JSON.stringify(tvView(h.s, h.now)),
    JSON.stringify(hostView(h.s, h.now)),
    ...h.ids.map((id) => JSON.stringify(playerView(h.s, id, h.now))),
  ];
}

function assertNoSecret(json: string) {
  expect(json).not.toMatch(/quixotic/i);
  expect(json).not.toMatch(/zephyr/i);
  expect(json).not.toMatch(/jukebox/i);
  expect(json).not.toContain(HINT);
  expect(json).not.toContain('"answer"');
}

describe("answer protection", () => {
  it("no view contains the answer or hint during a round", () => {
    const h = harness({ players: 3 });
    startGame(h.s, h.ctx());
    forceWord(h.s, SECRET, HINT);
    for (const v of allViews(h)) assertNoSecret(v);
    // even after many correct guesses by one player, others' views stay blank
    for (const l of ["Q", "U", "I", "X", "O", "T", "C", "Z", "E", "P", "H", "Y", "R", "J", "K", "B"]) {
      h.advance(150);
      if (h.s.round!.progress[h.ids[0]].status === "playing") guess(h.s, h.ids[0], l, h.ctx());
    }
    expect(h.s.round!.progress[h.ids[0]].status).toBe("solved");
    const [tv, host, , p2, p3] = allViews(h);
    for (const v of [tv, host, p2, p3]) assertNoSecret(v);
  });

  it("TV pattern is blank; player pattern only has letters they earned", () => {
    const h = harness({ players: 2 });
    startGame(h.s, h.ctx());
    forceWord(h.s, "Big Apple", HINT);
    guess(h.s, h.ids[0], "P", h.ctx());
    const tv = tvView(h.s, h.now);
    expect(tv.pattern!.every((c) => c.t !== "letter" || c.c === null)).toBe(true);
    const me = playerView(h.s, h.ids[0], h.now).my!;
    const shown = me.pattern!.map((c) => (c.t === "letter" ? (c.c ?? "_") : " ")).join("");
    expect(shown).toBe("___ _PP__");
    const other = playerView(h.s, h.ids[1], h.now).my!;
    expect(other.pattern!.every((c) => c.t !== "letter" || c.c === null)).toBe(true);
  });

  it("a player who runs out of lives never receives the remaining letters", () => {
    const h = harness({ players: 2 });
    startGame(h.s, h.ctx());
    forceWord(h.s, SECRET, HINT);
    for (const l of WRONG_FOR(SECRET).slice(0, 6)) guess(h.s, h.ids[0], l, h.ctx());
    expect(h.s.round!.progress[h.ids[0]].status).toBe("out");
    assertNoSecret(JSON.stringify(playerView(h.s, h.ids[0], h.now)));
  });

  it("hint only reaches the player who paid for it", () => {
    const h = harness({ players: 2 });
    startGame(h.s, h.ctx());
    forceWord(h.s, SECRET, HINT);
    takeHint(h.s, h.ids[0], h.ctx());
    expect(JSON.stringify(playerView(h.s, h.ids[0], h.now))).toContain(HINT);
    expect(JSON.stringify(playerView(h.s, h.ids[1], h.now))).not.toContain(HINT);
    expect(JSON.stringify(tvView(h.s, h.now))).not.toContain(HINT);
    expect(JSON.stringify(hostView(h.s, h.now))).not.toContain(HINT);
  });

  it("answer appears only after the round ends", () => {
    const h = harness({ players: 2 });
    startGame(h.s, h.ctx());
    forceWord(h.s, SECRET, HINT);
    h.advance(61_000);
    tick(h.s, h.ctx());
    for (const v of allViews(h)) expect(v).toContain(SECRET);
  });

  it("friend author is hidden during the round and revealed after", () => {
    const h = harness({ players: 3, settings: { friendWords: true, rounds: 5 } });
    submitWord(h.s, h.ids[0], SECRET, HINT, h.ctx());
    startGame(h.s, h.ctx());
    while (h.s.round!.source !== "friend") {
      h.advance(61_000);
      tick(h.s, h.ctx());
      next(h.s, h.ctx());
      if (h.s.phase === "loserPick") next(h.s, h.ctx());
    }
    const tv = tvView(h.s, h.now);
    expect(tv.reveal).toBeNull();
    const authorRow = tv.rivals.find((r) => r.id === h.ids[0])!;
    expect(authorRow.status).toBe("playing"); // disguised
    const authorView = playerView(h.s, h.ids[0], h.now);
    expect(authorView.my!.state).toBe("sittingOut");
    for (const v of allViews(h)) assertNoSecret(v);
    h.advance(61_000);
    tick(h.s, h.ctx());
    const after = tvView(h.s, h.now);
    expect(after.reveal!.authorName).toBe("Player1");
    expect(after.reveal!.answer).toBe(SECRET);
  });

  it("unused friend submissions are never shown to TV or players", () => {
    const h = harness({ players: 3, settings: { friendWords: true } });
    submitWord(h.s, h.ids[0], SECRET, HINT, h.ctx());
    const tv = JSON.stringify(tvView(h.s, h.now));
    assertNoSecret(tv);
    assertNoSecret(JSON.stringify(playerView(h.s, h.ids[1], h.now)));
    // the author can see their own submission in the lobby
    expect(JSON.stringify(playerView(h.s, h.ids[0], h.now))).toContain(SECRET);
  });

  it("reveal power-up only exposes letters to the user", () => {
    const h = harness({ players: 2 });
    startGame(h.s, h.ctx());
    forceWord(h.s, "Mississippi", HINT);
    activatePowerup(h.s, h.ids[0], "reveal", null, h.ctx());
    const other = playerView(h.s, h.ids[1], h.now).my!;
    expect(other.pattern!.every((c) => c.t !== "letter" || c.c === null)).toBe(true);
  });
});

describe("Emoji Decode answer protection", () => {
  const ANSWER = "Quixotic Zephyr Jukebox";
  const ALT = "Wobblyflangewidget";
  function setup() {
    const h = harness({ players: 3, settings: { mode: "emoji" } });
    startGame(h.s, h.ctx());
    h.s.round!.clue = "🎰🌬️📻";
    h.s.round!.answer = ANSWER;
    h.s.round!.alternates = [ALT];
    return h;
  }
  const noSecrets = (json: string) => {
    expect(json).not.toMatch(/quixotic|zephyr|jukebox/i);
    expect(json).not.toMatch(/wobblyflange/i);
    expect(json).not.toContain('"answer"');
    expect(json).not.toContain('"alternates"');
  };

  it("no view contains the answer or alternates during the round, only the public clue", () => {
    const h = setup();
    for (const v of allViews(h)) {
      noSecrets(v);
      expect(v).toContain("🎰🌬️📻");
    }
    const tv = tvView(h.s, h.now);
    expect(tv.pattern).toBeNull(); // no tiles: they'd reveal the answer's shape
    expect(tv.round!.mode).toBe("emoji");
  });

  it("a player who answered correctly still never receives the answer before the round ends", () => {
    const h = setup();
    submitAnswer(h.s, h.ids[0], "quixotic zephyr jukebox", h.ctx());
    expect(h.s.round!.progress[h.ids[0]].status).toBe("solved");
    for (const id of h.ids) noSecrets(JSON.stringify(playerView(h.s, id, h.now)));
    noSecrets(JSON.stringify(tvView(h.s, h.now)));
    noSecrets(JSON.stringify(hostView(h.s, h.now)));
  });

  it("the TV shows attempts left and solved status but never anyone's guesses", () => {
    const h = setup();
    submitAnswer(h.s, h.ids[1], "Banana Hammock", h.ctx());
    const tv = JSON.stringify(tvView(h.s, h.now));
    expect(tv).not.toContain("Banana Hammock");
    expect(JSON.stringify(hostView(h.s, h.now))).not.toContain("Banana Hammock");
    expect(JSON.stringify(playerView(h.s, h.ids[2], h.now))).not.toContain("Banana Hammock");
    const row = tvView(h.s, h.now).rivals.find((r) => r.id === h.ids[1])!;
    expect(row.lives).toBe(2);
    expect(row.status).toBe("playing");
    // the player can see their own earlier attempt
    expect(playerView(h.s, h.ids[1], h.now).my!.wrong).toEqual(["Banana Hammock"]);
  });

  it("a revealed letter is only sent to the player who used the power-up", () => {
    const h = setup();
    activatePowerup(h.s, h.ids[0], "reveal", null, h.ctx());
    const mine = playerView(h.s, h.ids[0], h.now).my!;
    expect(mine.revealedLetters).toHaveLength(1);
    expect("QUIXOTICZEPHYRJUKEBOX").toContain(mine.revealedLetters[0].letter);
    expect(playerView(h.s, h.ids[1], h.now).my!.revealedLetters).toEqual([]);
    expect(JSON.stringify(tvView(h.s, h.now))).not.toContain("revealedPos");
  });

  it("host hints are public; the answer appears only after the round ends (alternates never)", () => {
    const h = setup();
    dropHint(h.s, h.ctx());
    for (const v of allViews(h)) {
      expect(v).toContain("Starts with “Q”");
      noSecrets(v);
    }
    submitAnswer(h.s, h.ids[0], ANSWER, h.ctx());
    h.advance(61_000);
    tick(h.s, h.ctx());
    const tv = tvView(h.s, h.now);
    expect(tv.reveal!.answer).toBe(ANSWER);
    expect(tv.reveal!.solvedCount).toBe(1);
    expect(tv.reveal!.totalPlayers).toBe(3);
    expect(tv.reveal!.fastest!.id).toBe(h.ids[0]);
    for (const v of allViews(h)) expect(v).not.toMatch(/wobblyflange/i);
  });
});
