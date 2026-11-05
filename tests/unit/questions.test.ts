import { describe, expect, it } from "vitest";
import { QUESTION_BANK, questionText } from "@/data/questions";
import { isBlocked, renderQuestion, validateQuestion } from "@/lib/moderation";

const packs = Object.keys(QUESTION_BANK) as (keyof typeof QUESTION_BANK)[];

// Off-limits topics for Most Likely To (health, mental health, sexuality, gender,
// race, religion, immigration, money, body shape, trauma, relationships, crimes).
const OFF_LIMITS =
  /\b(money|cash|rich|broke|debt|salary|pay|paid|dollars?|lottery|bank|loans?|date|dating|ex|crush|kiss|marr(y|ied|iage)|wedding night|boyfriend|girlfriend|partner|divorce|sex|sexy|gay|lesbian|gender|race|racist|religio\w*|church|god|pray|immigra\w*|visa|deport\w*|arrest\w*|jail|prison|crime|criminal|steal|stole|rob|police|cops?|sick|ill|hospital|doctor|therap\w*|depress\w*|anxi\w*|diet|fat|skinny|weight|body|drunk|alcohol|beer|wine|vodka|shots?|drugs?|weed|trauma|cry|crying|die|death|dead|kill\w*|fight|stupid|ugly|dumb)\b/i;

describe("Most Likely To question bank", () => {
  it("has the five packs", () => {
    expect([...packs].sort()).toEqual(["chaos", "college", "friends", "future", "habits"]);
  });

  it.each(packs)("%s has at least 30 questions (and enough Clean ones)", (pack) => {
    expect(QUESTION_BANK[pack].length).toBeGreaterThanOrEqual(30);
    expect(QUESTION_BANK[pack].filter((e) => e.content === "clean").length).toBeGreaterThanOrEqual(28);
  });

  it("every question is well-formed, playful and within limits", () => {
    for (const pack of packs)
      for (const e of QUESTION_BANK[pack]) {
        const full = questionText(e);
        expect(full.length, full).toBeGreaterThanOrEqual(10);
        expect(full.length, full).toBeLessThanOrEqual(120);
        expect(["clean", "pg13"]).toContain(e.content);
        expect(e.text, full).not.toMatch(/^[A-Z]/); // reads naturally after "most likely to"
        expect(e.text, full).not.toMatch(/\?$/);
        expect(OFF_LIMITS.test(e.text), `off-limits topic in: ${full}`).toBe(false);
        expect(isBlocked(e.text, e.content), full).toBe(false);
      }
  });

  it("has no duplicate questions", () => {
    const keys = packs.flatMap((p) => QUESTION_BANK[p].map((e) => e.text.toLowerCase().replace(/[^a-z0-9]/g, "")));
    expect(keys.filter((k, i) => keys.indexOf(k) !== i)).toEqual([]);
  });
});

describe("custom question validation", () => {
  it("accepts 10-120 characters and renders a full question", () => {
    expect(validateQuestion("miss the bus", "clean")).toEqual({ ok: true, value: "Who is most likely to miss the bus?" });
    expect(validateQuestion("Who would win a staring contest with a cat?", "clean")).toEqual({
      ok: true,
      value: "Who would win a staring contest with a cat?",
    });
    expect(validateQuestion("most likely to adopt three goats", "clean").ok && renderQuestion("most likely to adopt three goats")).toBe(
      "Who is most likely to adopt three goats?",
    );
    expect(validateQuestion("Netflix and nap all day...", "clean")).toEqual({ ok: true, value: "Who is most likely to Netflix and nap all day?" });
  });
  it("rejects too short, too long, non-text and filtered questions", () => {
    expect(validateQuestion("nap", "clean").ok).toBe(false);
    expect(validateQuestion("x".repeat(121), "clean").ok).toBe(false);
    expect(validateQuestion(42, "clean").ok).toBe(false);
    expect(validateQuestion("🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂", "clean").ok).toBe(false);
    const r13 = (s: string) => s.replace(/[a-z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 97 + 13) % 26) + 97));
    expect(validateQuestion(`say ${r13("fuvg")} at dinner`, "clean").ok).toBe(false); // stricter Clean filter
    expect(validateQuestion(`say ${r13("fuvg")} at dinner`, "pg13").ok).toBe(true);
    expect(validateQuestion(`be a ${r13("snttbg")} at dinner`, "pg13").ok).toBe(false); // slurs blocked at both levels
  });
});
