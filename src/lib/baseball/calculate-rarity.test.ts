import { describe, expect, it } from "vitest";
import { QUESTIONS } from "@/data/questions";
import { FALLBACK_RARITY, RARITY_ESTIMATES, TIER_RARITY } from "@/data/rarity-estimates";
import type { ValidationResult } from "@/types/baseball";
import { calculateScore, type RarityEstimator } from "./calculate-rarity";
import { checkCriteria } from "./criteria";
import { getPlayerIndex } from "./dataset";

const valid = (playerId: string): ValidationResult => ({ status: "valid", playerId, message: "" });

describe("calculateScore", () => {
  it("uses curated tiers when available", () => {
    expect(calculateScore(valid("ruthba01"), "hr-300")).toMatchObject({
      valid: true,
      points: TIER_RARITY.iconic,
      rarityScore: TIER_RARITY.iconic,
      method: "curated",
    });
  });

  it("scores the same player differently per question", () => {
    const yankees = calculateScore(valid("buhneja01"), "yankees");
    const mariners = calculateScore(valid("buhneja01"), "mariners");
    expect(mariners.rarityScore).toBeLessThan(yankees.rarityScore);
  });

  // Ben Gamel (Mariners outfielder, 2017–18) has no curated estimate for that question.
  const uncuratedMariner = "gamelbe01";
  it("test fixture is a real, uncurated Mariner", () => {
    expect(getPlayerIndex().getById(uncuratedMariner)?.teams).toContain("SEA");
    expect(RARITY_ESTIMATES.mariners[uncuratedMariner]).toBeUndefined();
  });

  it("uses the documented fallback for uncurated valid players", () => {
    const result = calculateScore(valid(uncuratedMariner), "mariners");
    expect(result).toMatchObject({ points: FALLBACK_RARITY, method: "fallback" });
  });

  it("gives obscure answers more points than famous ones", () => {
    const famous = calculateScore(valid("griffke02"), "mariners").points;
    const recognizable = calculateScore(valid("putzjj01"), "mariners").points;
    const obscure = calculateScore(valid(uncuratedMariner), "mariners").points;
    expect(recognizable).toBeGreaterThan(famous);
    expect(obscure).toBeGreaterThan(recognizable);
  });

  it("awards zero for invalid or unresolved answers", () => {
    const invalid: ValidationResult = { status: "ineligible", message: "" };
    expect(calculateScore(invalid, "cy-young")).toMatchObject({ points: 0, rarityScore: 0, method: "none" });
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
    expect(calculateScore(valid("ruthba01"), "hr-300", [community]).points).toBe(100);
  });

  it("keeps every score within 0–100", () => {
    for (const value of [...Object.values(TIER_RARITY), FALLBACK_RARITY]) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
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
