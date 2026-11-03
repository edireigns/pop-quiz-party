import { describe, expect, it } from "vitest";
import { CATEGORY_LABELS, WORD_BANK } from "@/data/words";
import { STARTER_DARES } from "@/data/dares";
import { wordKey } from "@/lib/game/text";
import { isBlocked } from "@/lib/moderation";

describe("built-in word bank", () => {
  const cats = Object.keys(WORD_BANK) as (keyof typeof WORD_BANK)[];

  it("has the required categories and no video game or sports categories", () => {
    expect(cats.sort()).toEqual(["college", "food", "genz", "memes", "mixed", "movies", "music", "tv"]);
    for (const label of Object.values(CATEGORY_LABELS)) expect(label).not.toMatch(/game|sport/i);
  });

  it.each(cats)("%s has at least 40 entries (and enough Clean ones)", (cat) => {
    expect(WORD_BANK[cat].length).toBeGreaterThanOrEqual(40);
    expect(WORD_BANK[cat].filter((e) => e.content === "clean").length).toBeGreaterThanOrEqual(30);
  });

  it("every entry is well-formed", () => {
    for (const cat of cats) {
      for (const e of WORD_BANK[cat]) {
        expect(e.answer, e.answer).toMatch(/^[A-Za-z0-9 .,'!?&:\-]+$/);
        expect(e.answer.length).toBeLessThanOrEqual(40);
        expect(e.hint.length, e.answer).toBeGreaterThan(3);
        expect(e.hint.toLowerCase(), e.answer).not.toContain(e.answer.toLowerCase());
        expect(["easy", "medium", "hard"]).toContain(e.difficulty);
        expect(["clean", "pg13"]).toContain(e.content);
      }
    }
  });

  it("has no duplicates across the whole bank", () => {
    const keys = cats.flatMap((c) => WORD_BANK[c].map((e) => wordKey(e.answer)));
    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
    expect(dupes).toEqual([]);
  });

  it("mixes single words and multi-word phrases", () => {
    const all = cats.flatMap((c) => WORD_BANK[c]);
    expect(all.filter((e) => e.answer.includes(" ")).length).toBeGreaterThan(100);
    expect(all.filter((e) => !e.answer.includes(" ")).length).toBeGreaterThan(80);
  });

  it("clean entries pass the clean filter", () => {
    for (const cat of cats)
      for (const e of WORD_BANK[cat].filter((x) => x.content === "clean")) {
        expect(isBlocked(e.answer, "clean"), e.answer).toBe(false);
      }
  });
});

describe("starter dares", () => {
  it("are safe: no alcohol, no physical risk wording", () => {
    for (const d of STARTER_DARES) {
      expect(d.text).not.toMatch(/drink|shot|alcohol|beer|wine|vodka|lick|kiss (someone|a player)|strip|hit|slap someone/i);
      expect(isBlocked(d.text, d.content)).toBe(false);
    }
  });
  it("have clean options", () => {
    expect(STARTER_DARES.filter((d) => d.content === "clean").length).toBeGreaterThanOrEqual(12);
  });
});
