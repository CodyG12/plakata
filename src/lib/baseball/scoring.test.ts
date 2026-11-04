import { describe, expect, it } from "vitest";
import { MAX_GAME_SCORE, ROUND_COUNT } from "@/data/questions";
import { MAX_POINTS_PER_ROUND, SCORING_TIERS, classifyRarity, isScoringTier, strikeout, tierConfig } from "./scoring";

const ALLOWED_POINTS = [0, 10, 25, 50, 75, 100];

describe("scoring tiers", () => {
  it("defines exactly the six official tiers, names and points", () => {
    expect(SCORING_TIERS.map((t) => [t.tier, t.label, t.points])).toEqual([
      ["strikeout", "Strikeout", 0],
      ["bunt", "Bunt", 10],
      ["single", "Single", 25],
      ["double", "Double", 50],
      ["triple", "Triple", 75],
      ["plakata", "Plákata", 100],
    ]);
  });

  it("only the Strikeout is worth zero, and it can't be reached by rarity", () => {
    expect(tierConfig("strikeout")).toMatchObject({ points: 0, minRarity: null });
    for (const t of SCORING_TIERS.filter((t) => t.tier !== "strikeout")) expect(t.points).toBeGreaterThan(0);
  });

  it("hit thresholds start at 0 and increase strictly", () => {
    const mins = SCORING_TIERS.flatMap((t) => (t.minRarity === null ? [] : [t.minRarity]));
    expect(mins[0]).toBe(0);
    for (let i = 1; i < mins.length; i++) expect(mins[i]).toBeGreaterThan(mins[i - 1]);
  });

  it("a Strikeout is always 0 points with no rarity", () => {
    expect(strikeout()).toEqual({ tier: "strikeout", label: "Strikeout", points: 0, estimatedRarity: null });
  });

  it("caps a round at 100 and a seven-round game at 700", () => {
    expect(MAX_POINTS_PER_ROUND).toBe(100);
    expect(ROUND_COUNT).toBe(7);
    expect(MAX_GAME_SCORE).toBe(700);
  });

  it("recognizes only known tier ids", () => {
    expect(isScoringTier("triple")).toBe(true);
    expect(isScoringTier("deep-cut")).toBe(false);
    expect(isScoringTier(undefined)).toBe(false);
  });
});

describe("classifyRarity", () => {
  it.each([
    [0, "bunt", 10],
    [19, "bunt", 10],
    [20, "single", 25],
    [39, "single", 25],
    [40, "double", 50],
    [59, "double", 50],
    [60, "triple", 75],
    [79, "triple", 75],
    [80, "plakata", 100],
    [100, "plakata", 100],
  ])("rarity %i → %s (+%i)", (rarity, tier, points) => {
    expect(classifyRarity(rarity)).toMatchObject({ tier, points, estimatedRarity: rarity });
  });

  it("maps every rarity 0–100 to exactly one hit worth an approved, non-zero amount", () => {
    for (let r = 0; r <= 100; r += 0.5) {
      const result = classifyRarity(r);
      expect(SCORING_TIERS.filter((t) => t.tier === result.tier)).toHaveLength(1);
      expect(result.tier).not.toBe("strikeout");
      expect(ALLOWED_POINTS).toContain(result.points);
      expect(result.points).toBeGreaterThanOrEqual(10);
    }
  });

  it("rounds, then clamps out-of-range and non-finite estimates", () => {
    expect(classifyRarity(19.6)).toMatchObject({ tier: "single", estimatedRarity: 20 });
    expect(classifyRarity(-30)).toMatchObject({ tier: "bunt", points: 10, estimatedRarity: 0 });
    expect(classifyRarity(150)).toMatchObject({ tier: "plakata", points: 100, estimatedRarity: 100 });
    expect(classifyRarity(Number.NaN)).toMatchObject({ tier: "bunt", points: 10, estimatedRarity: 0 });
  });

  it("uses the tier's display label", () => {
    expect(classifyRarity(90).label).toBe("Plákata");
    expect(classifyRarity(65).label).toBe("Triple");
  });
});
