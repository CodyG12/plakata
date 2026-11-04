import { FALLBACK_RARITY, RARITY_ESTIMATES, TIER_RARITY, type PopularityTier } from "@/data/rarity-estimates";
import type { ScoreMethod, ScoreResult, ValidationResult } from "@/types/baseball";

/**
 * A source of rarity estimates. The MVP chains two: curated tiers, then a
 * neutral fallback. Future sources (community answer frequencies with Bayesian
 * smoothing, pageviews, etc.) can implement this interface and be inserted
 * ahead of the curated estimator without touching the UI or validation code.
 */
export interface RarityEstimator {
  estimate(questionId: string, playerId: string): RarityEstimate | null;
}

export interface RarityEstimate {
  rarityScore: number;
  method: Exclude<ScoreMethod, "none">;
  label: string;
}

const TIER_LABELS: Record<PopularityTier, string> = {
  iconic: "Iconic answer",
  famous: "Famous answer",
  wellKnown: "Well-known answer",
  known: "Recognizable answer",
};

export const curatedEstimator: RarityEstimator = {
  estimate(questionId, playerId) {
    const tiers = RARITY_ESTIMATES[questionId as keyof typeof RARITY_ESTIMATES];
    const tier = tiers?.[playerId];
    if (!tier) return null;
    return { rarityScore: TIER_RARITY[tier], method: "curated", label: TIER_LABELS[tier] };
  },
};

export const fallbackEstimator: RarityEstimator = {
  estimate: () => ({
    rarityScore: FALLBACK_RARITY,
    method: "fallback",
    label: "Deep cut (provisional estimate)",
  }),
};

export const DEFAULT_ESTIMATORS: readonly RarityEstimator[] = [curatedEstimator, fallbackEstimator];

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/** Scores a validated answer. Invalid/unresolved answers always score 0. */
export function calculateScore(
  validation: ValidationResult,
  questionId: string,
  estimators: readonly RarityEstimator[] = DEFAULT_ESTIMATORS,
): ScoreResult {
  if (!validation.valid || !validation.playerId) {
    return { valid: false, points: 0, rarityScore: 0, method: "none", label: "No points" };
  }
  for (const estimator of estimators) {
    const estimate = estimator.estimate(questionId, validation.playerId);
    if (estimate) {
      const rarityScore = clamp(estimate.rarityScore);
      return { valid: true, points: rarityScore, rarityScore, method: estimate.method, label: estimate.label };
    }
  }
  throw new Error("No rarity estimator produced a score — the fallback estimator should always apply.");
}

