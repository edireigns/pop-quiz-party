import { describe, expect, it } from "vitest";
import { PROMPT_BANK } from "@/data/prompts";
import { isBlocked, validatePrompt, validateWwiAnswer } from "@/lib/moderation";

const packs = Object.keys(PROMPT_BANK) as (keyof typeof PROMPT_BANK)[];

// Off-limits for Who Wrote It?: secrets, health, mental health, sexuality, gender, race,
// religion, immigration, money, body shape, trauma, relationships, crimes.
const OFF_LIMITS =
  /\b(secrets?|confess\w*|embarrassing|money|cash|rich|broke|debt|salary|paid|dollars?|lottery|bank|loans?|date|dating|first date|ex|exes|crush|kiss\w*|marr(y|ied|iage)|wedding|boyfriend|girlfriend|partner|divorce|sex|sexy|gay|lesbian|gender|race|racist|religio\w*|church|god|pray|immigra\w*|visa|deport\w*|arrest\w*|jail|prison|crime|criminal|illegal|steal|stole|rob|police|cops?|sick|ill|hospital|doctor|therap\w*|depress\w*|anxi\w*|diet|fat|skinny|weight|body|drunk|alcohol|beer|wine|vodka|shots?|drugs?|weed|trauma|cry|crying|die|death|dead|kill\w*|fight|stupid|ugly|dumb)\b/i;

describe("Who Wrote It? question bank", () => {
  it("has the five packs", () => {
    expect([...packs].sort()).toEqual(["chaos", "college", "friends", "habits", "hypotheticals"]);
  });

  it.each(packs)("%s has at least 30 questions (and enough Clean ones)", (pack) => {
    expect(PROMPT_BANK[pack].length).toBeGreaterThanOrEqual(30);
    expect(PROMPT_BANK[pack].filter((e) => e.content === "clean").length).toBeGreaterThanOrEqual(28);
  });

  it("every question is short, playful, and avoids off-limits topics", () => {
    for (const pack of packs)
      for (const e of PROMPT_BANK[pack]) {
        expect(e.text.length, e.text).toBeGreaterThanOrEqual(10);
        expect(e.text.length, e.text).toBeLessThanOrEqual(120);
        expect(e.text, e.text).toMatch(/\?"?$/);
        expect(["clean", "pg13"]).toContain(e.content);
        expect(OFF_LIMITS.test(e.text), `off-limits topic in: ${e.text}`).toBe(false);
        expect(isBlocked(e.text, e.content), e.text).toBe(false);
      }
  });

  it("has no duplicate questions", () => {
    const keys = packs.flatMap((p) => PROMPT_BANK[p].map((e) => e.text.toLowerCase().replace(/[^a-z0-9]/g, "")));
    expect(keys.filter((k, i) => keys.indexOf(k) !== i)).toEqual([]);
  });
});

describe("Who Wrote It? validation", () => {
  it("custom questions: 10-120 characters, content filter, shown as a question", () => {
    expect(validatePrompt("what would you name a llama", "clean")).toEqual({ ok: true, value: "What would you name a llama?" });
    expect(validatePrompt("too short", "clean").ok).toBe(false);
    expect(validatePrompt("x".repeat(121), "clean").ok).toBe(false);
    const r13 = (s: string) => s.replace(/[a-z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 97 + 13) % 26) + 97));
    expect(validatePrompt(`What is the ${r13("fuvg")}iest snack?`, "clean").ok).toBe(false);
  });
  it("answers: 1-80 characters, and the content level decides how strict the filter is", () => {
    expect(validateWwiAnswer("  a llama named   Kevin ", "clean")).toEqual({ ok: true, value: "a llama named Kevin" });
    expect(validateWwiAnswer("", "clean").ok).toBe(false);
    expect(validateWwiAnswer("x".repeat(81), "clean").ok).toBe(false);
    expect(validateWwiAnswer("🦙🦙🦙", "clean").ok).toBe(true);
    const r13 = (s: string) => s.replace(/[a-z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 97 + 13) % 26) + 97));
    expect(validateWwiAnswer(`holy ${r13("fuvg")}`, "clean").ok).toBe(false);
    expect(validateWwiAnswer(`holy ${r13("fuvg")}`, "pg13").ok).toBe(true);
    expect(validateWwiAnswer(`${r13("snttbg")}`, "pg13").ok).toBe(false);
  });
});
