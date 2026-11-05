import { describe, expect, it } from "vitest";
import {
  allowedTypos,
  answerLetters,
  clueKey,
  hostHintText,
  isCorrectAnswer,
  isEmojiClue,
  normalizeAnswer,
  typoDistance,
} from "@/lib/game/answers";

describe("normalizeAnswer", () => {
  it("ignores case, accents, punctuation and extra spaces", () => {
    expect(normalizeAnswer("  Beyoncé  ")).toBe("beyonce");
    expect(normalizeAnswer("Spider-Man")).toBe(normalizeAnswer("spider man"));
    expect(normalizeAnswer("Spider-Man")).toBe(normalizeAnswer("SPIDERMAN"));
    expect(normalizeAnswer("Grey's   Anatomy!")).toBe("greysanatomy");
    expect(normalizeAnswer("Mac & Cheese")).toBe(normalizeAnswer("mac and cheese"));
  });
  it("drops a leading the / a / an", () => {
    expect(normalizeAnswer("The Lion King")).toBe("lionking");
    expect(normalizeAnswer("a Quiet Place")).toBe("quietplace");
    expect(normalizeAnswer("An Officer")).toBe("officer");
    // only a whole leading word, not part of a word
    expect(normalizeAnswer("Theory")).toBe("theory");
    expect(normalizeAnswer("Anatomy")).toBe("anatomy");
  });
});

describe("typo allowance", () => {
  it("scales with answer length", () => {
    expect(allowedTypos(3)).toBe(0);
    expect(allowedTypos(4)).toBe(1);
    expect(allowedTypos(8)).toBe(1);
    expect(allowedTypos(9)).toBe(2);
  });
  it("counts a swap of neighbouring letters as one typo", () => {
    expect(typoDistance("shrek", "sherk")).toBe(1);
    expect(typoDistance("titanic", "titnaic")).toBe(1);
    expect(typoDistance("kitten", "sitting")).toBe(3);
  });
});

describe("isCorrectAnswer", () => {
  it("accepts exact, normalized and alternate answers", () => {
    expect(isCorrectAnswer("the lion king", "The Lion King")).toBe(true);
    expect(isCorrectAnswer("Lion King", "The Lion King")).toBe(true);
    expect(isCorrectAnswer("spiderman", "Spider-Man")).toBe(true);
    expect(isCorrectAnswer("Fries", "French Fries", ["Fries", "Chips"])).toBe(true);
    expect(isCorrectAnswer("boba", "Bubble Tea", ["Boba"])).toBe(true);
    expect(isCorrectAnswer("BEYONCE", "Beyonce")).toBe(true);
  });

  it("forgives one typo for 4-8 letters and two for longer answers", () => {
    expect(isCorrectAnswer("Shrk", "Shrek")).toBe(true); // 5 letters, 1 typo
    expect(isCorrectAnswer("Titnaic", "Titanic")).toBe(true); // swap
    expect(isCorrectAnswer("Interstelar", "Interstellar")).toBe(true); // 12 letters, 1 typo
    expect(isCorrectAnswer("Intrstelar", "Interstellar")).toBe(true); // 2 typos
    expect(isCorrectAnswer("Gangam Styl", "Gangnam Style")).toBe(true); // 2 typos on 12 letters
  });

  it("rejects close-but-wrong answers", () => {
    // short answers (<4) must be exact
    expect(isCorrectAnswer("Us", "Up")).toBe(false);
    expect(isCorrectAnswer("Ux", "Up")).toBe(false);
    expect(isCorrectAnswer("Pha", "Pho")).toBe(false);
    expect(isCorrectAnswer("BTX", "BTS")).toBe(false);
    expect(isCorrectAnswer("ET2", "E.T.")).toBe(false);
    // 4-8 letters: two typos is too many
    expect(isCorrectAnswer("Shark", "Shrek")).toBe(false);
    expect(isCorrectAnswer("Frozn 2", "Frozen")).toBe(false);
    expect(isCorrectAnswer("Coca", "Coco")).toBe(true); // one typo on 4 letters is allowed...
    expect(isCorrectAnswer("Cola", "Coco")).toBe(false); // ...two is not
    expect(isCorrectAnswer("Lostt", "Lost")).toBe(true);
    expect(isCorrectAnswer("Last", "Lost")).toBe(true);
    expect(isCorrectAnswer("Lust", "Glee")).toBe(false);
    // long answers: three typos is too many
    expect(isCorrectAnswer("Interstallor", "Interstellar")).toBe(true);
    expect(isCorrectAnswer("Intarstallor", "Interstellar")).toBe(false);
    // a different, shorter title is not a typo
    expect(isCorrectAnswer("Toy", "Toy Story")).toBe(false);
    expect(isCorrectAnswer("Story", "Toy Story")).toBe(false);
    expect(isCorrectAnswer("Harry", "Harry Potter")).toBe(false);
    expect(isCorrectAnswer("Star Trek", "Star Wars")).toBe(false);
    expect(isCorrectAnswer("Breaking Dawn", "Breaking Bad")).toBe(false);
  });

  it("rejects empty or punctuation-only guesses and never matches an empty alternate", () => {
    expect(isCorrectAnswer("", "Up")).toBe(false);
    expect(isCorrectAnswer("   ", "Pizza")).toBe(false);
    expect(isCorrectAnswer("!!!", "Pizza")).toBe(false);
    expect(isCorrectAnswer("the", "The Office")).toBe(false);
    expect(isCorrectAnswer("x", "Pizza", [""])).toBe(false);
  });

  it("checks typos against each alternate with its own length rule", () => {
    // "1D" is a 2-char alternate: must be exact
    expect(isCorrectAnswer("1D", "One Direction", ["1D"])).toBe(true);
    expect(isCorrectAnswer("2D", "One Direction", ["1D"])).toBe(false);
    expect(isCorrectAnswer("One Directon", "One Direction", ["1D"])).toBe(true);
  });
});

describe("emoji clues", () => {
  it("accepts only emojis and spaces", () => {
    for (const ok of ["🦁👑", "🚢 🧊 💔", "👨‍👩‍👧‍👦🍩", "🇬🇧", "9️⃣9️⃣", "#️⃣🏷️", "👩🏽‍💻", "Ⓜ️🍫Ⓜ️", "🏳️‍🌈", "❤️"]) {
      expect(isEmojiClue(ok), ok).toBe(true);
    }
    for (const bad of ["", "   ", "lion 🦁", "🦁1", "🦁:", "abc", "🇰", "<b>🦁</b>", "🦁\n👑", "🦁".repeat(13)]) {
      expect(isEmojiClue(bad), bad).toBe(false);
    }
  });
  it("builds a stable key ignoring spaces and variation selectors", () => {
    expect(clueKey("🚢 🧊 💔")).toBe(clueKey("🚢🧊💔"));
    expect(clueKey("☂️🌧️")).toBe(clueKey("☂🌧"));
  });
});

describe("host hints", () => {
  it("gives the first letter, then the word and letter counts", () => {
    expect(hostHintText("The Lion King", 0)).toBe("Starts with “T”");
    expect(hostHintText("The Lion King", 1)).toBe("3 words · 3 + 4 + 4 letters");
    expect(hostHintText("Titanic", 1)).toBe("1 word · 7 letters");
    expect(hostHintText("Spider-Man", 1)).toBe("1 word · 9 letters");
    expect(hostHintText("E.T.", 0)).toBe("Starts with “E”");
  });
  it("indexes letters and digits only", () => {
    expect(answerLetters("Mac & Cheese")).toEqual(["M", "A", "C", "C", "H", "E", "E", "S", "E"]);
  });
});
