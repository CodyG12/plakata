import { createHash, randomInt } from "node:crypto";
import type { CriteriaType } from "@/types/baseball";

/** Categories used to balance a game: no two rounds from one category while others are left. */
export type QuestionCategory = "team" | "position" | "era" | "stats" | "honors" | "all_star" | "world_series" | "birthplace";

const CATEGORY_OF: Record<CriteriaType, QuestionCategory> = {
  franchise: "team",
  team: "team",
  position: "position",
  season: "era",
  debut: "era",
  stat_threshold: "stats",
  award: "honors",
  hall_of_fame: "honors",
  all_star: "all_star",
  world_series_champion: "world_series",
  birthplace: "birthplace",
};

export const categoryOf = (type: CriteriaType): QuestionCategory => CATEGORY_OF[type];

export interface SelectableQuestion {
  id: number;
  slug: string;
  category: string;
}

/** Random integer in [0, n). */
export type Rng = (n: number) => number;

export const cryptoRng: Rng = (n) => randomInt(n);

/** Deterministic generator for a seed string (mulberry32 over a SHA-256 of the seed). */
export function seededRng(seed: string): Rng {
  let state = createHash("sha256").update(seed).digest().readUInt32LE(0);
  return (n) => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const x = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    return Math.floor(x * n);
  };
}

function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** A Daily question doesn't come back within this many days while its category has an alternative. */
export const DAILY_COOLDOWN_DAYS = 30;

/** Slug → the most recent day (YYYY-MM-DD) it ran, for questions still on cooldown. */
export type RecentUse = ReadonlyMap<string, string>;

/** Fresh questions keep their shuffled order; questions on cooldown follow, the longest-ago first. */
function byFreshness(recent: RecentUse) {
  return (a: SelectableQuestion, b: SelectableQuestion) => (recent.get(a.slug) ?? "").localeCompare(recent.get(b.slug) ?? "");
}

/**
 * Picks `count` distinct questions, round-robin across shuffled categories, so
 * every category is used once before any repeats. Input order doesn't matter:
 * questions are sorted by slug first, which keeps a seeded pick reproducible.
 *
 * Questions in `recent` are on cooldown: within a category they come after every
 * fresh question (oldest use first), and a category with nothing fresh comes after
 * every category that has something fresh. An empty `recent` changes nothing,
 * since the sorts are stable and the RNG is consumed the same way.
 */
export function selectBalanced(
  questions: readonly SelectableQuestion[],
  count: number,
  rng: Rng,
  recent: RecentUse = new Map(),
): SelectableQuestion[] {
  if (questions.length < count) throw new Error(`Need ${count} active questions, only ${questions.length} available`);
  const byCategory = new Map<string, SelectableQuestion[]>();
  for (const q of [...questions].sort((a, b) => a.slug.localeCompare(b.slug))) {
    const list = byCategory.get(q.category);
    if (list) list.push(q);
    else byCategory.set(q.category, [q]);
  }
  const fresher = byFreshness(recent);
  const pools = shuffle([...byCategory.keys()].sort(), rng)
    .map((c) => shuffle(byCategory.get(c)!, rng).sort(fresher))
    .sort((a, b) => fresher(a[0], b[0]));
  const picked: SelectableQuestion[] = [];
  while (picked.length < count) {
    for (const pool of pools) {
      const next = pool.shift();
      if (next) picked.push(next);
      if (picked.length === count) break;
    }
  }
  return picked;
}

/** The daily seven for a UTC date, e.g. "2026-11-04", avoiding questions in `recent`. */
export function selectDaily(
  questions: readonly SelectableQuestion[],
  day: string,
  count: number,
  recent: RecentUse = new Map(),
): SelectableQuestion[] {
  return selectBalanced(questions, count, seededRng(`plakata:daily:${day}`), recent);
}

export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** A UTC date `n` days after `day` (negative goes back). */
export function addDays(day: string, n: number): string {
  return utcDay(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000);
}
