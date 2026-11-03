import { describe, expect, it } from "vitest";
import { isBlocked, validateHint, validateNickname, validatePhrase } from "@/lib/moderation";

const r13 = (s: string) => s.replace(/[a-z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 97 + 13) % 26) + 97));
const SLUR = r13("snttbg");
const EXPLICIT = r13("cbea");
const MILD = r13("fuvg");

describe("content filter", () => {
  it("blocks slurs and explicit terms at both levels", () => {
    for (const lvl of ["clean", "pg13"] as const) {
      expect(isBlocked(SLUR, lvl)).toBe(true);
      expect(isBlocked(`My ${EXPLICIT} star`, lvl)).toBe(true);
    }
  });
  it("catches leetspeak and spacing tricks", () => {
    expect(isBlocked(SLUR.replace("a", "4").replace("o", "0"), "pg13")).toBe(true);
    expect(isBlocked(SLUR.split("").join(" "), "pg13")).toBe(true);
  });
  it("applies a stricter profanity filter in Clean mode", () => {
    expect(isBlocked(`Holy ${MILD}`, "clean")).toBe(true);
    expect(isBlocked(`Holy ${MILD}`, "pg13")).toBe(false);
  });
  it("avoids common false positives", () => {
    for (const ok of ["Scunthorpe", "Class assessment", "Analysis paralysis", "Cocktail party", "Hello there", "Peacock"]) {
      expect(isBlocked(ok, "clean"), ok).toBe(false);
    }
  });
});

describe("friend word validation", () => {
  it("accepts 2-40 chars of letters, numbers, spaces and basic punctuation", () => {
    expect(validatePhrase("  Taco   Tuesday! ", "clean")).toEqual({ ok: true, value: "Taco Tuesday!" });
    expect(validatePhrase("Room 101", "clean").ok).toBe(true);
    expect(validatePhrase("A", "clean").ok).toBe(false);
    expect(validatePhrase("x".repeat(41), "clean").ok).toBe(false);
    expect(validatePhrase("Emoji 🎉", "clean").ok).toBe(false);
    expect(validatePhrase("<script>", "clean").ok).toBe(false);
    expect(validatePhrase("123", "clean").ok).toBe(false);
  });
  it("hints are optional, short, and may not contain the answer", () => {
    expect(validateHint("", "clean")).toEqual({ ok: true, value: "" });
    expect(validateHint("Our trip", "clean", "Lisbon").ok).toBe(true);
    expect(validateHint("Lisbon trip", "clean", "Lisbon").ok).toBe(false);
  });
});

describe("nicknames", () => {
  it("validates length and content", () => {
    expect(validateNickname("Zoë", "clean").ok).toBe(true);
    expect(validateNickname("A", "clean").ok).toBe(false);
    expect(validateNickname("x".repeat(17), "clean").ok).toBe(false);
    expect(validateNickname(SLUR, "pg13").ok).toBe(false);
    expect(validateNickname(`${MILD}head`, "clean").ok).toBe(false);
  });
});
