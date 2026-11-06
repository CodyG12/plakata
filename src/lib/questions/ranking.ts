/**
 * Top-5 Bunt rule: statistical rankings for a question.
 *
 * For a statistical question, the five best performers AMONG THAT QUESTION'S
 * ELIGIBLE PLAYERS always score a Bunt (10), whatever their community rarity.
 * Rankings are computed from the dataset, never hand-entered, and are frozen
 * per question version (see question-store.ts), so a data update can't change
 * scores that were already awarded.
 *
 * Ranking policy (documented in the README):
 *  - Metric: the question's own statistic. Career questions rank by career total;
 *    single-season questions rank DISTINCT players by their best season.
 *  - Era floor: single-season PITCHING rankings (wins, strikeouts, saves) count only
 *    seasons from 1893 on, when the pitching distance became 60'6". Pre-1893 seasons
 *    (50-foot pitching, 60-win workloads) would otherwise fill every leaderboard.
 *    The floor only decides who gets the Bunt: eligibility still uses every season.
 *  - Population: only players eligible for the question version, so any filters in
 *    the criteria are respected automatically.
 *  - Ties: standard competition ranking ("1224"). Everyone whose rank is ≤ 5 gets
 *    the override, so a tie at fifth place includes every tied player.
 *  - Direction: configurable per statistic (higher-is-better for every counting
 *    stat in the dataset). Lower-is-better stats must declare a qualification
 *    minimum, so a 1-inning pitcher can't top an ERA leaderboard.
 *  - Only `stat_threshold` criteria have a ranking. Team, position, era, award,
 *    All-Star, World Series and birthplace questions never get the override.
 */
import type { BaseballPlayer, QuestionCriteria, StatKey } from "@/types/baseball";

export const TOP_N = 5;

export type RankingDirection = "desc" | "asc";

export interface StatMeta {
  label: string;
  direction: RankingDirection;
  /**
   * Required for "asc" (rate) stats: the player needs at least `min` of `stat`
   * in the same scope to be ranked (e.g. 1,000 innings for ERA).
   */
  qualifier?: { stat: StatKey; min: number };
  /** Single-season rankings count only seasons from this year on. */
  seasonFloor?: typeof PITCHING_SEASON_FLOOR;
}

/** The year the pitching distance became 60'6" (see the dataset's bestPitchingSeasonFrom1893). */
export const PITCHING_SEASON_FLOOR = 1893;

/** Every stat the dataset carries is a counting stat: higher is better, no qualifier needed. */
export const STAT_META: Record<StatKey, StatMeta> = {
  homeRuns: { label: "Home runs", direction: "desc" },
  hits: { label: "Hits", direction: "desc" },
  runsBattedIn: { label: "RBIs", direction: "desc" },
  stolenBases: { label: "Stolen bases", direction: "desc" },
  wins: { label: "Pitching wins", direction: "desc", seasonFloor: PITCHING_SEASON_FLOOR },
  pitcherStrikeouts: { label: "Strikeouts (pitching)", direction: "desc", seasonFloor: PITCHING_SEASON_FLOOR },
  saves: { label: "Saves", direction: "desc", seasonFloor: PITCHING_SEASON_FLOOR },
};

export interface RankingConfig {
  stat: StatKey;
  scope: "career" | "season";
  direction: RankingDirection;
  qualifier?: { stat: StatKey; min: number };
  /** Season scope only: count seasons from this year on. */
  seasonFloor?: number;
}

/** The ranking a question uses, or null if the question isn't statistical. */
export function rankingConfigFor(criteria: QuestionCriteria): RankingConfig | null {
  if (criteria.type !== "stat_threshold") return null;
  const meta = STAT_META[criteria.stat];
  const config: RankingConfig = { stat: criteria.stat, scope: criteria.scope, direction: meta.direction, qualifier: meta.qualifier };
  if (criteria.scope === "season" && meta.seasonFloor) config.seasonFloor = meta.seasonFloor;
  return config;
}

export function statValue(player: BaseballPlayer, stat: StatKey, scope: "career" | "season"): number | undefined {
  return (scope === "career" ? player.career : player.bestSeason)[stat];
}

/** The value a ranking uses: like statValue, but honouring the config's season floor. */
export function rankingValue(player: BaseballPlayer, stat: StatKey, config: Pick<RankingConfig, "scope" | "seasonFloor">): number | undefined {
  if (config.scope === "season" && config.seasonFloor !== undefined) {
    if (config.seasonFloor !== PITCHING_SEASON_FLOOR) throw new Error(`No dataset field for a season floor of ${config.seasonFloor}`);
    const fromFloor = player.bestPitchingSeasonFrom1893;
    if (fromFloor) return fromFloor[stat];
  }
  return statValue(player, stat, config.scope);
}

export interface RankedPlayer {
  playerId: string;
  value: number;
  /** Competition rank: tied values share a rank, and the next rank skips ("1224"). */
  rank: number;
  /** rank ≤ TOP_N: this answer always scores a Bunt. */
  buntOverride: boolean;
}

/**
 * Ranks the given (eligible) players. Players without a value — or below a rate
 * stat's qualifier — are left out. Deterministic: ties are ordered by player id.
 */
export function rankPlayers(
  players: readonly BaseballPlayer[],
  config: RankingConfig,
  topN: number = TOP_N,
): RankedPlayer[] {
  if (config.direction === "asc" && !config.qualifier) {
    throw new Error(`A lower-is-better ranking (${config.stat}) needs a qualification minimum`);
  }
  const rows: { playerId: string; value: number }[] = [];
  for (const p of players) {
    const value = rankingValue(p, config.stat, config);
    if (value === undefined) continue;
    if (config.qualifier) {
      const q = rankingValue(p, config.qualifier.stat, config);
      if (q === undefined || q < config.qualifier.min) continue;
    }
    rows.push({ playerId: p.id, value });
  }
  const sign = config.direction === "desc" ? -1 : 1;
  rows.sort((a, b) => sign * (a.value - b.value) || a.playerId.localeCompare(b.playerId));

  const ranked: RankedPlayer[] = [];
  for (let i = 0; i < rows.length; i++) {
    const rank = i > 0 && rows[i].value === rows[i - 1].value ? ranked[i - 1].rank : i + 1;
    ranked.push({ ...rows[i], rank, buntOverride: rank <= topN });
  }
  return ranked;
}

/** Player ids that receive the Bunt override (sorted, for a stable snapshot). */
export function topFiveIds(ranked: readonly RankedPlayer[]): string[] {
  return ranked.filter((r) => r.buntOverride).map((r) => r.playerId).sort();
}
