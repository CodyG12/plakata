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

/**
 * Picks `count` distinct questions, round-robin across shuffled categories, so
 * every category is used once before any repeats. Input order doesn't matter:
 * questions are sorted by slug first, which keeps a seeded pick reproducible.
 */
export function selectBalanced(questions: readonly SelectableQuestion[], count: number, rng: Rng): SelectableQuestion[] {
  if (questions.length < count) throw new Error(`Need ${count} active questions, only ${questions.length} available`);
  const byCategory = new Map<string, SelectableQuestion[]>();
  for (const q of [...questions].sort((a, b) => a.slug.localeCompare(b.slug))) {
    const list = byCategory.get(q.category);
    if (list) list.push(q);
    else byCategory.set(q.category, [q]);
  }
  const pools = shuffle([...byCategory.keys()].sort(), rng).map((c) => shuffle(byCategory.get(c)!, rng));
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

/** The daily seven for a UTC date, e.g. "2026-11-04". */
export function selectDaily(questions: readonly SelectableQuestion[], day: string, count: number): SelectableQuestion[] {
  return selectBalanced(questions, count, seededRng(`plakata:daily:${day}`));
}

export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}
