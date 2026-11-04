/**
 * Baseball-themed scoring: the single source of truth for tier names,
 * thresholds and point values.
 *
 * Every round ends in exactly one tier. A round with no valid answer is a
 * Strikeout (0). A valid answer is always a hit, and the tier comes from its
 * estimated rarity (0–100, see calculate-rarity.ts). The estimate is kept
 * separate from the points, so the rarity model can change without touching
 * this table or the UI.
 */

export type ScoringTier = "strikeout" | "bunt" | "single" | "double" | "triple" | "plakata";

export interface ScoringResult {
  tier: ScoringTier;
  /** Display name, e.g. "Triple" or "Plákata". */
  label: string;
  /** Fixed points for the tier. */
  points: number;
  /** The rarity estimate the tier was derived from; null for a Strikeout. */
  estimatedRarity: number | null;
}

export interface TierConfig {
  tier: ScoringTier;
  label: string;
  points: number;
  /**
   * Lowest estimated rarity (inclusive) that earns this tier. Null for the
   * Strikeout, which no valid answer can get.
   */
  minRarity: number | null;
}

/**
 * PROVISIONAL thresholds; adjust freely. Ordered from lowest to highest.
 * Hits must start at minRarity 0 (so every valid answer earns at least a Bunt)
 * and increase strictly.
 */
export const SCORING_TIERS: readonly TierConfig[] = [
  { tier: "strikeout", label: "Strikeout", points: 0, minRarity: null },
  { tier: "bunt", label: "Bunt", points: 10, minRarity: 0 },
  { tier: "single", label: "Single", points: 25, minRarity: 20 },
  { tier: "double", label: "Double", points: 50, minRarity: 40 },
  { tier: "triple", label: "Triple", points: 75, minRarity: 60 },
  { tier: "plakata", label: "Plákata", points: 100, minRarity: 80 },
];

const HITS = SCORING_TIERS.filter((t): t is TierConfig & { minRarity: number } => t.minRarity !== null);

/** Most points one round can award. */
export const MAX_POINTS_PER_ROUND = Math.max(...SCORING_TIERS.map((t) => t.points));

export function tierConfig(tier: ScoringTier): TierConfig {
  const config = SCORING_TIERS.find((t) => t.tier === tier);
  if (!config) throw new Error(`Unknown scoring tier: ${tier}`);
  return config;
}

export function isScoringTier(value: unknown): value is ScoringTier {
  return SCORING_TIERS.some((t) => t.tier === value);
}

/** The result for a round that ended without a valid answer. */
export function strikeout(): ScoringResult {
  const { tier, label, points } = tierConfig("strikeout");
  return { tier, label, points, estimatedRarity: null };
}

/**
 * Classifies a VALID answer by its estimated rarity. The estimate is rounded
 * and clamped to 0–100 first (non-finite → 0), so the result is always a hit:
 * never a Strikeout, never zero points.
 */
export function classifyRarity(rarity: number): ScoringResult {
  const estimatedRarity = Number.isFinite(rarity) ? Math.max(0, Math.min(100, Math.round(rarity))) : 0;
  let match = HITS[0];
  for (const hit of HITS) if (estimatedRarity >= hit.minRarity) match = hit;
  return { tier: match.tier, label: match.label, points: match.points, estimatedRarity };
}
