/**
 * Community rarity: curated prior + real answers, Bayesian-smoothed, frozen into
 * snapshots. Pure and deterministic, with no I/O. See README "How rarity is calculated".
 *
 *   p_prior(a|q)    curated popularity tiers converted to a normalized distribution
 *   p_smoothed(a|q) = (n_aq + α·p_prior(a|q)) / (N_q + α)
 *   rawRarity       = 100 · (1 − p_smoothed)            (kept for reference)
 *   rarity          = 100 · (share of answers MORE common than a + ½ share of answers tied with a)
 *
 * The raw formula compresses badly: with 1,800 eligible Yankees, even the most
 * popular answer has p ≈ 0.02, so every answer scores 98–100. The calibrated
 * `rarity` is a monotonic transform of p_smoothed (more common → never rarer) that
 * reads as a percentile: "rarer than X% of the answers fans actually give".
 */
import { RARITY_ESTIMATES, type PopularityTier } from "@/data/rarity-estimates";
import { classifyRarity, tierConfig } from "@/lib/baseball/scoring";
import type { ScoreResult } from "@/types/baseball";

/** Bump when the math changes; stored on every snapshot so old scores stay explainable. */
export const RARITY_CALC_VERSION = "smoothed-cumulative-v1";

/**
 * Prior strength α, in equivalent observations. 100 is a starting point, not a
 * fitted value: after 100 real answers the community data and the prior weigh
 * equally; after 1,000 the data carries ~91% of the weight.
 */
export const DEFAULT_ALPHA = 100;

/**
 * Relative naming likelihood for each curated tier: an "iconic" player is assumed
 * 3× as likely to be named as a "famous" one, and so on. Ordinal judgments made
 * into ratios. This is an assumption, which is why α keeps it weak.
 */
export const TIER_WEIGHTS: Record<PopularityTier, number> = { iconic: 27, famous: 9, wellKnown: 3, known: 1 };

/**
 * Share of prior mass given to uncurated eligible players together. The curated lists
 * are assumed to cover 60% of what fans actually say, which keeps a 1,800-player pool
 * from swamping the curated names, or a 50-player remainder from ranking above them.
 */
export const UNCURATED_SHARE = 0.4;
/** An uncurated player is never assumed likelier than half a "known" player. */
export const UNCURATED_MAX_WEIGHT = TIER_WEIGHTS.known / 2;

/** One player's rarity numbers inside a snapshot. */
export interface AnswerStat {
  /** Eligible community observations of this answer. */
  n: number;
  prior: number;
  /** n / N (0 when N = 0). */
  observed: number;
  smoothed: number;
  rawRarity: number;
  /** Calibrated 0–100 (see header). */
  rarity: number;
}

/** A frozen scoring distribution for one question version. JSON-serializable. */
export interface SnapshotDistribution {
  calcVersion: string;
  alpha: number;
  eligibleCount: number;
  totalObservations: number;
  /** Always scores a Plákata (product decision: one hand-picked Plákata per question). */
  plakataPick: string;
  /** Stats shared by every eligible player not listed in `players` (uncurated, never named). */
  default: AnswerStat | null;
  players: Record<string, AnswerStat>;
}

export interface DistributionInput {
  /** Every eligible player for the question version. */
  eligible: readonly string[];
  /** Curated tier per player (question-specific); missing = uncurated. */
  curated?: Readonly<Record<string, PopularityTier>>;
  /** Eligible observation counts per player. Keys outside `eligible` are ignored. */
  counts?: ReadonlyMap<string, number>;
  alpha?: number;
  plakataPick: string;
}

/**
 * Prior weight per player, normalized later. Exposed for tests and the admin preview.
 * With no curated list every eligible player gets the same weight (uniform prior).
 */
export function priorWeights(
  eligible: readonly string[],
  curated: Readonly<Record<string, PopularityTier>> = {},
): Map<string, number> {
  const weights = new Map<string, number>();
  let curatedTotal = 0;
  let uncuratedCount = 0;
  for (const id of eligible) {
    const tier = curated[id];
    if (tier) curatedTotal += TIER_WEIGHTS[tier];
    else uncuratedCount++;
  }
  const uncuratedWeight =
    curatedTotal === 0
      ? 1
      : uncuratedCount === 0
        ? 0
        : Math.min(UNCURATED_MAX_WEIGHT, (UNCURATED_SHARE * curatedTotal) / ((1 - UNCURATED_SHARE) * uncuratedCount));
  for (const id of eligible) {
    const tier = curated[id];
    weights.set(id, tier ? TIER_WEIGHTS[tier] : uncuratedWeight);
  }
  return weights;
}

/**
 * Builds the smoothed, calibrated distribution. Deterministic: players are grouped
 * by identical (prior weight, count), and groups are ordered by probability, then by key.
 */
export function buildDistribution(input: DistributionInput): SnapshotDistribution {
  const alpha = input.alpha ?? DEFAULT_ALPHA;
  if (!(alpha > 0) || !Number.isFinite(alpha)) throw new Error(`alpha must be a positive number, got ${alpha}`);
  const eligible = [...new Set(input.eligible)].sort();
  if (eligible.length === 0) throw new Error("A question needs at least one eligible answer");
  if (!eligible.includes(input.plakataPick)) throw new Error(`Plákata pick ${input.plakataPick} is not eligible`);

  const weights = priorWeights(eligible, input.curated);
  const totalWeight = eligible.reduce((sum, id) => sum + weights.get(id)!, 0);
  const counts = input.counts ?? new Map<string, number>();
  const n = (id: string) => {
    const c = counts.get(id) ?? 0;
    if (!Number.isInteger(c) || c < 0) throw new Error(`Invalid observation count for ${id}: ${c}`);
    return c;
  };
  const N = eligible.reduce((sum, id) => sum + n(id), 0);

  // Group identical players so 2,000 uncurated, never-named Dodgers are one entry.
  interface Group {
    key: string;
    ids: string[];
    n: number;
    prior: number;
    smoothed: number;
  }
  const groups = new Map<string, Group>();
  for (const id of eligible) {
    const w = weights.get(id)!;
    const c = n(id);
    const key = `${w}|${c}`;
    const g = groups.get(key);
    if (g) g.ids.push(id);
    else {
      const prior = w / totalWeight;
      groups.set(key, { key, ids: [id], n: c, prior, smoothed: (c + alpha * prior) / (N + alpha) });
    }
  }
  const ordered = [...groups.values()].sort((a, b) => b.smoothed - a.smoothed || a.key.localeCompare(b.key));

  // Calibrate: mass of strictly-more-common answers, plus half of the tied mass.
  // Ties are by exact probability, so groups with equal p_smoothed share a score.
  const players: Record<string, AnswerStat> = {};
  let fallback: AnswerStat | null = null;
  let above = 0;
  for (let i = 0; i < ordered.length; ) {
    let j = i;
    let tiedMass = 0;
    while (j < ordered.length && ordered[j].smoothed === ordered[i].smoothed) {
      tiedMass += ordered[j].smoothed * ordered[j].ids.length;
      j++;
    }
    const rarity = clamp(100 * (above + tiedMass / 2));
    for (const g of ordered.slice(i, j)) {
      const stat: AnswerStat = {
        n: g.n,
        prior: g.prior,
        observed: N === 0 ? 0 : g.n / N,
        smoothed: g.smoothed,
        rawRarity: clamp(100 * (1 - g.smoothed)),
        rarity,
      };
      // Uncurated players nobody has named all share one key, so they form at most
      // one group. It's stored once as the default entry, not 2,000 times.
      const isDefaultGroup = g.n === 0 && !g.ids.some((id) => input.curated?.[id]);
      if (isDefaultGroup) fallback = stat;
      else for (const id of g.ids) players[id] = stat;
    }
    above += tiedMass;
    i = j;
  }

  return {
    calcVersion: RARITY_CALC_VERSION,
    alpha,
    eligibleCount: eligible.length,
    totalObservations: N,
    plakataPick: input.plakataPick,
    default: fallback,
    players,
  };
}

function clamp(x: number): number {
  return Math.max(0, Math.min(100, x));
}

/** Highest rarity a non-pick answer can score: just under the Plákata threshold (a Triple). */
export const NON_PICK_RARITY_CAP = (tierConfig("plakata").minRarity ?? 80) - 1;

/** Looks up a player's stats in a snapshot; null if the player isn't eligible for it. */
export function statFor(dist: SnapshotDistribution, playerId: string, isEligible: boolean): AnswerStat | null {
  if (!isEligible) return null;
  return dist.players[playerId] ?? dist.default;
}

/**
 * Scores an eligible answer from a frozen snapshot. The hand-picked answer is
 * always a Plákata. Every other answer gets its tier from calibrated community
 * rarity, capped at a Triple.
 */
export function scoreFromSnapshot(dist: SnapshotDistribution, playerId: string, isEligible: boolean): ScoreResult {
  const stat = statFor(dist, playerId, isEligible);
  if (!stat) throw new Error(`${playerId} is not an eligible answer for this snapshot`);
  if (playerId === dist.plakataPick) {
    return { valid: true, ...classifyRarity(100), method: "plakata", estimateNote: "This question's hand-picked deep cut" };
  }
  const percent = Math.round(stat.rarity);
  const note =
    dist.totalObservations === 0
      ? `Curated estimate: rarer than ~${percent}% of answers`
      : `Rarer than ${percent}% of answers (${dist.totalObservations.toLocaleString("en-US")} fan answers, smoothed)`;
  return {
    valid: true,
    ...classifyRarity(Math.min(stat.rarity, NON_PICK_RARITY_CAP)),
    method: "community",
    estimateNote: note,
  };
}

/** Curated tiers for a question slug (only the original seven have them). */
export function curatedTiersFor(slug: string): Readonly<Record<string, PopularityTier>> {
  return (RARITY_ESTIMATES as Record<string, Record<string, PopularityTier>>)[slug] ?? {};
}
