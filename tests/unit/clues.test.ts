import { describe, expect, it } from "vitest";
import { CLUE_BANK } from "@/data/clues";
import { WORD_BANK } from "@/data/words";
import { clueKey, isCorrectAnswer, isEmojiClue, normalizeAnswer } from "@/lib/game/answers";
import { isBlocked } from "@/lib/moderation";

const cats = Object.keys(CLUE_BANK) as (keyof typeof CLUE_BANK)[];

describe("emoji clue bank", () => {
  it("covers exactly the existing categories", () => {
    expect([...cats].sort()).toEqual(Object.keys(WORD_BANK).sort());
  });

  it.each(cats)("%s has at least 30 clues (and enough Clean ones)", (cat) => {
    expect(CLUE_BANK[cat].length).toBeGreaterThanOrEqual(30);
    expect(CLUE_BANK[cat].filter((e) => e.content === "clean").length).toBeGreaterThanOrEqual(25);
  });

  it("every entry is well-formed", () => {
    for (const cat of cats)
      for (const e of CLUE_BANK[cat]) {
        expect(isEmojiClue(e.clue), `${e.answer}: clue must be emojis only`).toBe(true);
        expect(e.answer, e.answer).toMatch(/^[A-Za-z0-9 .,'!?&:\-éÉ]+$/);
        expect(normalizeAnswer(e.answer).length, e.answer).toBeGreaterThan(0);
        expect(["easy", "medium", "hard"]).toContain(e.difficulty);
        expect(["clean", "pg13"]).toContain(e.content);
        expect(Array.isArray(e.alternates)).toBe(true);
        for (const alt of e.alternates) {
          expect(normalizeAnswer(alt).length, `${e.answer} alt "${alt}"`).toBeGreaterThan(0);
          expect(isCorrectAnswer(alt, e.answer, e.alternates), `${e.answer} accepts "${alt}"`).toBe(true);
        }
        expect(isCorrectAnswer(e.answer, e.answer, e.alternates)).toBe(true);
      }
  });

  it("uses no emojis newer than Emoji 13 (so every phone/TV can show them)", () => {
    // Emoji 14+ blocks we avoid: e.g. 🫠🫡🫶🪩🫧🪷🫨 (U+1FAE0–1FAFF, U+1FA70-range additions after 13.0)
    const tooNew = /[\u{1FAE0}-\u{1FAFF}\u{1FAC3}-\u{1FAC5}\u{1FA7B}-\u{1FA7C}\u{1FAA9}-\u{1FAAF}\u{1FAB7}-\u{1FABF}\u{1FACE}-\u{1FADF}\u{1F6DD}-\u{1F6DF}\u{1FAAA}\u{1FA7D}]/u;
    for (const cat of cats) for (const e of CLUE_BANK[cat]) expect(tooNew.test(e.clue), `${e.answer}: ${e.clue}`).toBe(false);
  });

  it("has no duplicate answers or clues across the bank", () => {
    const answers = cats.flatMap((c) => CLUE_BANK[c].map((e) => normalizeAnswer(e.answer)));
    expect(answers.filter((a, i) => answers.indexOf(a) !== i)).toEqual([]);
    const clues = cats.flatMap((c) => CLUE_BANK[c].map((e) => clueKey(e.clue)));
    expect(clues.filter((a, i) => clues.indexOf(a) !== i)).toEqual([]);
  });

  it("clean answers pass the clean filter", () => {
    for (const cat of cats)
      for (const e of CLUE_BANK[cat].filter((x) => x.content === "clean")) {
        expect(isBlocked(e.answer, "clean"), e.answer).toBe(false);
        for (const alt of e.alternates) expect(isBlocked(alt, "clean"), alt).toBe(false);
      }
  });
});
