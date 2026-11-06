import { describe, expect, it } from "vitest";
import { BLITZ_BANK } from "@/data/blitz";
import { blitzTypos, matchBlitzAnswer, startsWithLetter } from "@/lib/game/blitzMatch";
import type { BuiltInBlitzCategoryId } from "@/lib/game/types";

const prompt = (cat: BuiltInBlitzCategoryId, letter: string) => BLITZ_BANK[cat].find((p) => p.letter === letter)!;
/** The canonical answer a typed answer matches, or null. */
function m(cat: BuiltInBlitzCategoryId, letter: string, typed: string): string | null {
  const p = prompt(cat, letter);
  const i = matchBlitzAnswer(typed, letter, p.answers);
  return i < 0 ? null : p.answers[i][0];
}

describe("Category Blitz answer matching", () => {
  it("ignores case, accents, punctuation, extra spaces and a leading the/a/an", () => {
    expect(m("tv", "S", "  the   SIMPSONS!! ")).toBe("The Simpsons");
    expect(m("tv", "S", "simpsons")).toBe("The Simpsons");
    expect(m("music", "B", "beyonce")).toBe("Beyoncé");
    expect(m("movies", "S", "spiderman")).toBe("Spider-Man");
    expect(m("movies", "S", "Spider Man")).toBe("Spider-Man");
    expect(m("movies", "B", "a bugs life")).toBe("A Bug's Life");
    expect(m("food", "S", "smores")).toBe("S'mores");
  });

  it("requires the prompt's letter after normalisation", () => {
    expect(startsWithLetter("simpsons", "S")).toBe(true);
    expect(startsWithLetter("", "S")).toBe(false);
    // "The Office" is an O answer, never a T answer.
    expect(matchBlitzAnswer("The Office", "T", [["The Office"]])).toBe(-1);
    expect(m("animals", "B", "Cat")).toBeNull();
    expect(m("places", "S", "Paris")).toBeNull();
  });

  it("accepts alternates as the same answer", () => {
    expect(m("tv", "S", "SNL")).toBe("Saturday Night Live");
    expect(m("tv", "S", "SpongeBob")).toBe("SpongeBob SquarePants");
    expect(m("food", "F", "fries")).toBe("French Fries");
    expect(m("places", "P", "Pyramids of Giza")).toBe("The Pyramids");
    expect(m("animals", "H", "hippopotamus")).toBe("Hippo");
  });

  it("forgives typos by length: exact up to 4, one for 5–8, two for longer", () => {
    expect([4, 5, 8, 9, 20].map(blitzTypos)).toEqual([0, 1, 1, 2, 2]);
    expect(m("animals", "B", "Baer")).toBeNull(); // Bear: 4 letters, exact only
    expect(m("music", "S", "Shakria")).toBe("Shakira"); // swap = 1 typo
    expect(m("music", "S", "Shkria")).toBeNull(); // 2 typos on 7 letters
    expect(m("places", "S", "Switzerlnd")).toBe("Switzerland");
    expect(m("places", "S", "Swtzerlnd")).toBe("Switzerland"); // 2 typos on 11 letters
    expect(m("places", "S", "Swtzrlnd")).toBeNull(); // 3 typos
    expect(m("places", "A", "Austrailia")).toBe("Australia");
  });

  it("never merges close but different names or titles", () => {
    // Both listed: exact matches stay apart.
    const pairs: [BuiltInBlitzCategoryId, string, string, string][] = [
      ["animals", "M", "Mouse", "Moose"],
      ["places", "N", "Niger", "Nigeria"],
      ["places", "S", "Slovakia", "Slovenia"],
      ["places", "A", "Austria", "Australia"],
      ["places", "I", "Ireland", "Iceland"],
      ["places", "G", "Granada", "Grenada"],
      ["places", "I", "India", "Indiana"],
      ["movies", "C", "Cars", "Cats"],
      ["movies", "A", "Alien", "Aliens"],
      ["food", "M", "Macaron", "Macaroni"],
      ["food", "S", "Salad", "Salsa"],
      ["food", "L", "Latte", "Latke"],
      ["memes", "G", "Gen Z", "Gen X"],
      ["memes", "C", "Clout", "Cloud"],
      ["music", "R", "Rush", "Russ"],
      ["music", "S", "Sia", "SZA"],
      ["music", "J", "John Legend", "John Lennon"],
    ];
    for (const [cat, letter, a, b] of pairs) {
      expect(m(cat, letter, a), `${a}`).toBe(a);
      expect(m(cat, letter, b), `${b}`).toBe(b);
    }
    // A typo equally close to two different answers matches neither.
    expect(m("animals", "M", "Moise")).toBeNull();
    expect(m("places", "N", "Nigera")).toBeNull();
    expect(m("places", "I", "Indian")).toBeNull();
    // Numbers must match: sequels and different titles aren't typos.
    expect(m("movies", "S", "Shrek 2")).toBeNull();
    expect(m("movies", "S", "Shrek")).toBe("Shrek");
    expect(matchBlitzAnswer("Scream 2", "S", [["Scream"]])).toBe(-1);
    expect(matchBlitzAnswer("Apollo 11", "A", [["Apollo 13"]])).toBe(-1);
    // Unlisted look-alikes aren't pulled in either.
    expect(matchBlitzAnswer("Supermen", "S", [["Superman"], ["Spider-Man"]])).toBe(0);
    expect(matchBlitzAnswer("Spiderwick", "S", [["Superman"], ["Spider-Man"]])).toBe(-1);
  });

  it("works with host-written answers too", () => {
    const answers = [["Milk"], ["Mustard"], ["Mayonnaise", "Mayo"]];
    expect(matchBlitzAnswer("mayo", "M", answers)).toBe(2);
    expect(matchBlitzAnswer("Mustrad", "M", answers)).toBe(1);
    expect(matchBlitzAnswer("Ketchup", "M", answers)).toBe(-1);
    expect(matchBlitzAnswer("Margarine", "M", answers)).toBe(-1);
  });
});
