import { describe, expect, it } from "vitest";
import { BLITZ_BANK } from "@/data/blitz";
import { normalizeAnswer } from "@/lib/game/answers";
import { blitzTypos, matchBlitzAnswer } from "@/lib/game/blitzMatch";
import { isBlocked } from "@/lib/moderation";

const CATS = ["tv", "movies", "music", "food", "memes", "college", "places", "animals"] as const;

describe("Category Blitz prompt bank", () => {
  it("has the eight categories and no video game or sports category", () => {
    expect(Object.keys(BLITZ_BANK).sort()).toEqual([...CATS].sort());
  });

  for (const cat of CATS) {
    it(`${cat}: 15+ prompts, one per letter, 30+ well-formed answers each`, () => {
      const prompts = BLITZ_BANK[cat];
      expect(prompts.length).toBeGreaterThanOrEqual(15);
      expect(new Set(prompts.map((p) => p.letter)).size).toBe(prompts.length);
      for (const p of prompts) {
        const where = `${cat} ${p.letter}`;
        expect(p.letter, where).toMatch(/^[A-Z]$/);
        expect(["easy", "medium", "hard"], where).toContain(p.difficulty);
        expect(["clean", "pg13"], where).toContain(p.content);
        expect(p.answers.length, where).toBeGreaterThanOrEqual(30);
        const seen = new Map<string, string>();
        for (const group of p.answers) {
          for (const a of group) {
            const n = normalizeAnswer(a);
            expect(n[0], `${where}: "${a}" must start with ${p.letter}`).toBe(p.letter.toLowerCase());
            expect(seen.has(n), `${where}: "${a}" duplicates "${seen.get(n)}"`).toBe(false);
            seen.set(n, a);
            if (p.content === "clean") expect(isBlocked(a, "clean"), `${where}: "${a}" fails the Clean filter`).toBe(false);
            expect(a.length, `${where}: "${a}"`).toBeLessThanOrEqual(40);
          }
        }
        // Every listed answer (and alternate) matches itself.
        p.answers.forEach((group, i) => {
          for (const a of group) expect(matchBlitzAnswer(a, p.letter, p.answers), `${where}: "${a}"`).toBe(i);
        });
      }
    });
  }

  it("covers enough of the alphabet's playable letters", () => {
    expect(blitzTypos(4)).toBe(0);
    for (const cat of CATS) expect(BLITZ_BANK[cat].filter((p) => p.content === "clean").length).toBeGreaterThanOrEqual(15);
  });
});
