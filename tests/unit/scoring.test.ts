import { describe, expect, it } from "vitest";
import { applyDelta, POINTS, rankMap, solveBonus, speedBonus } from "@/lib/game/scoring";

describe("scoring constants", () => {
  it("match the published rules", () => {
    expect(POINTS).toEqual({
      correctLetter: 10,
      solve: 50,
      perLifeLeft: 10,
      speedMax: 30,
      hintPenalty: 20,
      authorPerFail: 15,
    });
  });
});

describe("speedBonus", () => {
  it("is +30 instantly and 0 at the buzzer", () => {
    expect(speedBonus(60_000, 60_000)).toBe(30);
    expect(speedBonus(0, 60_000)).toBe(0);
  });
  it("scales linearly and rounds", () => {
    expect(speedBonus(30_000, 60_000)).toBe(15);
    expect(speedBonus(45_000, 90_000)).toBe(15);
    expect(speedBonus(10_000, 60_000)).toBe(5);
  });
  it("clamps out-of-range input", () => {
    expect(speedBonus(-5, 60_000)).toBe(0);
    expect(speedBonus(999_999, 60_000)).toBe(30);
    expect(speedBonus(10, 0)).toBe(0);
  });
});

describe("solveBonus", () => {
  it("adds solve + 10 per life + speed", () => {
    // 6 lives, half the time left of 60s -> 50 + 60 + 15
    expect(solveBonus(6, 30_000, 60_000)).toBe(125);
    expect(solveBonus(1, 0, 60_000)).toBe(60);
  });
});

describe("applyDelta", () => {
  it("never lets a score go below zero", () => {
    expect(applyDelta(0, -20)).toEqual({ score: 0, applied: 0 });
    expect(applyDelta(15, -20)).toEqual({ score: 0, applied: -15 });
    expect(applyDelta(40, -20)).toEqual({ score: 20, applied: -20 });
    expect(applyDelta(10, 30)).toEqual({ score: 40, applied: 30 });
  });
});

describe("rankMap", () => {
  it("uses competition ranking for ties", () => {
    const r = rankMap([
      { id: "a", score: 100 },
      { id: "b", score: 80 },
      { id: "c", score: 100 },
      { id: "d", score: 10 },
    ]);
    expect(r.get("a")).toBe(1);
    expect(r.get("c")).toBe(1);
    expect(r.get("b")).toBe(3);
    expect(r.get("d")).toBe(4);
  });
});
