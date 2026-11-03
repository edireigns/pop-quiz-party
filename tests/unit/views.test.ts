import { describe, expect, it } from "vitest";
import { guess, next, startGame, submitWord, tick, takeHint, activatePowerup } from "@/lib/game/engine";
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
