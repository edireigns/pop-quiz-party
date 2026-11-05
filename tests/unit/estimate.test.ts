import { describe, expect, it } from "vitest";
import { createGame, updateSettings, upgradeState } from "@/lib/game/engine";
import { estimateMinutes, roundSeconds } from "@/lib/game/estimate";
import type { GameState } from "@/lib/game/types";

const game = () => createGame({ roomId: "r", code: "ABCD", now: 0 });

describe("Who Wrote It? settings", () => {
  it("has the spec defaults", () => {
    const s = game();
    expect(s.settings.writeSec).toBe(45);
    expect(s.settings.guessSec).toBe(15);
    expect(s.settings.answersShown).toBe(3);
    expect(s.settings.wwiPacks).toEqual(["hypotheticals", "college", "friends", "chaos", "habits"]);
    expect(s.settings.mode).toBe("hangman"); // Hangman stays the default
  });

  it("validates the new options", () => {
    const s = game();
    updateSettings(s, { mode: "wwi", writeSec: 60, guessSec: 10, answersShown: 5, wwiPacks: ["chaos"] });
    expect(s.settings).toMatchObject({ mode: "wwi", writeSec: 60, guessSec: 10, answersShown: 5, wwiPacks: ["chaos"] });
    expect(() => updateSettings(s, { writeSec: 50 as never })).toThrow(/30, 45 or 60/);
    expect(() => updateSettings(s, { guessSec: 30 as never })).toThrow(/10, 15 or 20/);
    expect(() => updateSettings(s, { answersShown: 2 as never })).toThrow(/1, 3 or 5/);
    expect(() => updateSettings(s, { wwiPacks: ["nope" as never] })).toThrow(/question pack/);
    updateSettings(s, { mixedModes: ["hangman", "wwi"] });
    expect(s.settings.mixedModes).toEqual(["hangman", "wwi"]);
  });

  it("upgrades rooms saved before Who Wrote It? existed", () => {
    const s = game() as unknown as Record<string, unknown>;
    const settings = s.settings as Record<string, unknown>;
    for (const k of ["writeSec", "guessSec", "answersShown", "wwiPacks"]) delete settings[k];
    for (const k of ["customPrompts", "promptSubs", "usedPrompts", "wwiRoundPlan", "wwiShownCount", "wwiWriters", "holdMin"]) delete s[k];
    const up = upgradeState(s as unknown as GameState);
    expect(up.settings).toMatchObject({ writeSec: 45, guessSec: 15, answersShown: 3 });
    expect(up.customPrompts).toEqual([]);
    expect(up.wwiShownCount).toEqual({});
    expect(up.holdMin).toBeNull();
  });
});

describe("estimated game length", () => {
  it("adds up the round timers", () => {
    const s = game();
    expect(roundSeconds(s.settings, "hangman")).toBe(80);
    updateSettings(s, { mode: "wwi", rounds: 5, writeSec: 45, guessSec: 15, answersShown: 3 });
    // 45 write + 5 review + 3 × (15 guess + 6 reveal) + 15 leaderboard = 128s
    expect(roundSeconds(s.settings, "wwi")).toBe(128);
    expect(estimateMinutes(s.settings)).toBe(Math.round((5 * 128 + 4 * 8) / 60));
  });

  it("grows with more answers and rounds", () => {
    const s = game();
    updateSettings(s, { mode: "wwi", answersShown: 1 });
    const short = estimateMinutes(s.settings);
    updateSettings(s, { answersShown: 5 });
    expect(estimateMinutes(s.settings)).toBeGreaterThan(short);
    updateSettings(s, { mode: "mixed", mixedModes: ["hangman", "emoji", "mlt", "wwi"], rounds: 20 });
    expect(estimateMinutes(s.settings)).toBeGreaterThan(20);
  });
});
