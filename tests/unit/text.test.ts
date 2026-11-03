import { describe, expect, it } from "vitest";
import { isSolved, letterSet, maskAnswer, normalizeGuess, solvedFraction, wordKey } from "@/lib/game/text";

describe("phrase handling", () => {
  it("reveals spaces and punctuation automatically", () => {
    const cells = maskAnswer("Rock & Roll!", new Set());
    expect(cells.map((c) => c.t)).toEqual([
      "letter", "letter", "letter", "letter", "space", "fixed", "space", "letter", "letter", "letter", "letter", "fixed",
    ]);
    expect(cells[5]).toEqual({ t: "fixed", c: "&" });
    expect(cells[11]).toEqual({ t: "fixed", c: "!" });
    expect(cells.filter((c) => c.t === "letter").every((c) => c.t === "letter" && c.c === null)).toBe(true);
  });

  it("treats apostrophes, hyphens, colons and digits as auto-revealed", () => {
    const cells = maskAnswer("Grey's Nine-Nine: 4K", new Set());
    const fixed = cells.filter((c) => c.t === "fixed").map((c) => (c as { c: string }).c);
    expect(fixed).toEqual(["'", "-", ":", "4"]);
  });

  it("matches letters case-insensitively and reveals every occurrence", () => {
    const g = normalizeGuess("o");
    expect(g).toBe("O");
    const cells = maskAnswer("Doctor Who", new Set([g!]));
    const shown = cells.map((c) => (c.t === "letter" ? (c.c ?? "_") : c.t === "space" ? " " : c.c)).join("");
    expect(shown).toBe("_O__O_ __O");
  });

  it("normalises accents", () => {
    expect(normalizeGuess("é")).toBe("E");
    expect(letterSet("Beyoncé").has("E")).toBe(true);
  });

  it("rejects non-letters as guesses", () => {
    for (const bad of ["", "ab", "1", " ", "!", null, 5, undefined]) expect(normalizeGuess(bad)).toBeNull();
  });

  it("computes solved fraction over letter positions, not distinct letters", () => {
    expect(solvedFraction("BOOK", new Set(["O"]))).toBe(0.5);
    expect(solvedFraction("A B", new Set(["A", "B"]))).toBe(1);
  });

  it("detects a solved multi-word phrase", () => {
    expect(isSolved("No cap", new Set(["N", "O", "C", "A", "P"]))).toBe(true);
    expect(isSolved("No cap", new Set(["N", "O", "C", "A"]))).toBe(false);
  });

  it("builds repeat-proof keys", () => {
    expect(wordKey("Spider-Man Pointing")).toBe(wordKey("spider man pointing"));
  });
});
