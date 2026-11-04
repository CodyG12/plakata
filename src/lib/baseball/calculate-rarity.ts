import {
  FALLBACK_RARITY,
  PLAKATA_PICKS,
  PLAKATA_RARITY,
  RARITY_ESTIMATES,
  TIER_RARITY,
  type PopularityTier,
} from "@/data/rarity-estimates";
import type { ScoreMethod, ScoreResult, ValidationResult } from "@/types/baseball";
import { classifyRarity, strikeout } from "./scoring";

/**
 * A source of rarity estimates. The MVP chains three: the per-question Plákata
 * pick, curated tiers, then a neutral fallback. Future sources (community answer frequencies with Bayesian
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

export const plakataEstimator: RarityEstimator = {
  estimate(questionId, playerId) {
    if (PLAKATA_PICKS[questionId as keyof typeof PLAKATA_PICKS] !== playerId) return null;
    return { rarityScore: PLAKATA_RARITY, method: "curated", label: "The deepest cut" };
  },
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

export const DEFAULT_ESTIMATORS: readonly RarityEstimator[] = [plakataEstimator, curatedEstimator, fallbackEstimator];

/** Score for anything that isn't a valid answer: a Strikeout, 0 points. */
export function noAnswerScore(): ScoreResult {
  return { valid: false, ...strikeout(), method: "none", estimateNote: null };
}

/**
 * Scores a validated answer: estimate its rarity, then map that estimate to a
 * fixed-point tier (scoring.ts). Invalid/unresolved answers are a Strikeout.
 */
export function calculateScore(
  validation: ValidationResult,
  questionId: string,
  estimators: readonly RarityEstimator[] = DEFAULT_ESTIMATORS,
): ScoreResult {
  if (validation.status !== "valid" || !validation.playerId) return noAnswerScore();
  for (const estimator of estimators) {
    const estimate = estimator.estimate(questionId, validation.playerId);
    if (estimate) {
      return { valid: true, ...classifyRarity(estimate.rarityScore), method: estimate.method, estimateNote: estimate.label };
    }
  }
  throw new Error("No rarity estimator produced a score — the fallback estimator should always apply.");
}
