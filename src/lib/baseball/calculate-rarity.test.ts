import { describe, expect, it } from "vitest";
import { QUESTIONS } from "@/data/questions";
import { FALLBACK_RARITY, PLAKATA_PICKS, RARITY_ESTIMATES, TIER_RARITY } from "@/data/rarity-estimates";
import type { ValidationResult } from "@/types/baseball";
import { calculateScore, type RarityEstimator } from "./calculate-rarity";
import { checkCriteria } from "./criteria";
import { getPlayerIndex } from "./dataset";

const valid = (playerId: string): ValidationResult => ({ status: "valid", playerId, message: "" });

describe("calculateScore", () => {
  it("uses curated tiers when available", () => {
    expect(calculateScore(valid("ruthba01"), "hr-300")).toMatchObject({
      valid: true,
      tier: "bunt",
      points: 10,
      estimatedRarity: TIER_RARITY.iconic,
      method: "curated",
    });
  });

  it("scores the same player differently per question", () => {
    const yankees = calculateScore(valid("buhneja01"), "yankees");
    const mariners = calculateScore(valid("buhneja01"), "mariners");
    expect(mariners.estimatedRarity!).toBeLessThan(yankees.estimatedRarity!);
    expect(mariners.points).toBeLessThan(yankees.points);
  });

  // Ben Gamel (Mariners outfielder, 2017–18) has no curated estimate for that question.
  const uncuratedMariner = "gamelbe01";
  it("test fixture is a real, uncurated Mariner", () => {
    expect(getPlayerIndex().getById(uncuratedMariner)?.teams).toContain("SEA");
    expect(RARITY_ESTIMATES.mariners[uncuratedMariner]).toBeUndefined();
  });

  it("uses the documented fallback for uncurated valid players", () => {
    const result = calculateScore(valid(uncuratedMariner), "mariners");
    expect(result).toMatchObject({ estimatedRarity: FALLBACK_RARITY, tier: "triple", points: 75, method: "fallback" });
  });

  it("rates obscure answers rarer, and never awards them fewer points", () => {
    const famous = calculateScore(valid("griffke02"), "mariners");
    const recognizable = calculateScore(valid("putzjj01"), "mariners");
    const obscure = calculateScore(valid(uncuratedMariner), "mariners");
    expect(recognizable.estimatedRarity!).toBeGreaterThan(famous.estimatedRarity!);
    expect(obscure.estimatedRarity!).toBeGreaterThan(recognizable.estimatedRarity!);
    expect(recognizable.points).toBeGreaterThan(famous.points);
    // Known (60) and the uncurated fallback (75) are both Triples; only the one pick is a Plákata.
    expect(obscure.points).toBeGreaterThanOrEqual(recognizable.points);
    expect(calculateScore(valid(PLAKATA_PICKS.mariners), "mariners").points).toBeGreaterThan(obscure.points);
  });

  it("awards zero for invalid or unresolved answers", () => {
    const invalid: ValidationResult = { status: "ineligible", message: "" };
    expect(calculateScore(invalid, "cy-young")).toMatchObject({
      valid: false,
      tier: "strikeout",
      points: 0,
      estimatedRarity: null,
      method: "none",
    });
    const notFound: ValidationResult = { status: "unrecognized", message: "" };
    expect(calculateScore(notFound, "cy-young").points).toBe(0);
  });

  it("is deterministic", () => {
    const a = calculateScore(valid("ibanera01"), "hr-300");
    const b = calculateScore(valid("ibanera01"), "hr-300");
    expect(a).toEqual(b);
  });

  it("supports pluggable estimators and clamps to 0–100", () => {
    const community: RarityEstimator = { estimate: () => ({ rarityScore: 140, method: "curated", label: "x" }) };
    expect(calculateScore(valid("ruthba01"), "hr-300", [community])).toMatchObject({
      tier: "plakata",
      points: 100,
      estimatedRarity: 100,
    });
    const zero: RarityEstimator = { estimate: () => ({ rarityScore: 0, method: "curated", label: "x" }) };
    expect(calculateScore(valid("ruthba01"), "hr-300", [zero])).toMatchObject({ tier: "bunt", points: 10 });
  });

  it("maps each curated popularity tier (and the fallback) to a fixed-point hit", () => {
    expect(TIER_RARITY).toEqual({ iconic: 5, famous: 20, wellKnown: 40, known: 60 });
    const byRarity = (r: number) =>
      calculateScore(valid("x"), "q", [{ estimate: () => ({ rarityScore: r, method: "curated", label: "" }) }]).tier;
    expect(byRarity(TIER_RARITY.iconic)).toBe("bunt");
    expect(byRarity(TIER_RARITY.famous)).toBe("single");
    expect(byRarity(TIER_RARITY.wellKnown)).toBe("double");
    expect(byRarity(TIER_RARITY.known)).toBe("triple");
    expect(byRarity(FALLBACK_RARITY)).toBe("triple");
  });

  it("keeps every score within 0–100", () => {
    for (const value of [...Object.values(TIER_RARITY), FALLBACK_RARITY]) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });
});

describe("Plákata picks", () => {
  const index = getPlayerIndex();

  it("names exactly one real, qualifying, uncurated player per question", () => {
    for (const q of QUESTIONS) {
      const id = PLAKATA_PICKS[q.id];
      const player = index.getById(id);
      expect(player, `${q.id}: ${id} missing`).toBeDefined();
      expect(checkCriteria(player!, q.criteria).met, `${q.id}: ${player!.name} does not qualify`).toBe(true);
      expect(RARITY_ESTIMATES[q.id][id], `${q.id}: ${player!.name} is also curated`).toBeUndefined();
    }
  });

  it("awards Plákata to the pick only; every other uncurated answer is a Triple", () => {
    for (const q of QUESTIONS) {
      expect(calculateScore(valid(PLAKATA_PICKS[q.id]), q.id)).toMatchObject({ tier: "plakata", points: 100 });
    }
    expect(calculateScore(valid("gamelbe01"), "mariners")).toMatchObject({ tier: "triple", points: 75 });
    // A pick is per question: Richie Sexson is the 300-HR Plákata but a curated Mariner.
    expect(calculateScore(valid("sexsori01"), "hr-300").tier).toBe("plakata");
    expect(calculateScore(valid("sexsori01"), "mariners").tier).not.toBe("plakata");
  });

  it("keeps the fallback in the Triple band so no one else reaches Plákata", () => {
    expect(FALLBACK_RARITY).toBeGreaterThanOrEqual(60);
    expect(FALLBACK_RARITY).toBeLessThan(80);
  });
});

describe("curated rarity estimates", () => {
  const index = getPlayerIndex();

  it("has an entry for every question", () => {
    for (const q of QUESTIONS) expect(RARITY_ESTIMATES[q.id]).toBeDefined();
  });

  it("only lists real players who actually satisfy that question", () => {
    for (const q of QUESTIONS) {
      for (const playerId of Object.keys(RARITY_ESTIMATES[q.id])) {
        const player = index.getById(playerId);
        expect(player, `${q.id}: ${playerId} missing`).toBeDefined();
        expect(checkCriteria(player!, q.criteria).met, `${q.id}: ${player!.name} does not qualify`).toBe(true);
      }
    }
  });
});
