/**
 * Fixed-window rate limiting stored in Postgres (one upsert per check). Simple
 * and good enough for a small public game. No Redis needed until traffic says so.
 */
import { sql } from "drizzle-orm";
import type { Executor } from "./db/client";
import { rateLimits } from "./db/schema";

export interface Limit {
  /** Stable name, e.g. "submit:participant". */
  name: string;
  max: number;
  windowMs: number;
}

/** Normal play never comes close: a fast typist manages about one guess per second. */
export const LIMITS = {
  createGameParticipant: { name: "game:participant", max: 30, windowMs: 60 * 60 * 1000 },
  createGameIp: { name: "game:ip", max: 120, windowMs: 60 * 60 * 1000 },
  submitParticipant: { name: "submit:participant", max: 25, windowMs: 10 * 1000 },
  submitIp: { name: "submit:ip", max: 120, windowMs: 10 * 1000 },
  /** Admin login attempts per IP hash: slows password guessing to a crawl. */
  adminLoginIp: { name: "admin-login:ip", max: 10, windowMs: 15 * 60 * 1000 },
} as const satisfies Record<string, Limit>;

/**
 * Most eligible rarity observations one IP hash may add per question version per day.
 * Past this, answers still score; they just stop counting toward rarity.
 */
export const MAX_OBSERVATIONS_PER_IP_PER_QUESTION_PER_DAY = 5;

/** Counts one hit; returns false if the caller is over the limit for this window. */
export async function hit(db: Executor, limit: Limit, subject: string | null, now: number): Promise<boolean> {
  if (!subject) return true;
  const windowStart = new Date(Math.floor(now / limit.windowMs) * limit.windowMs);
  const [row] = await db
    .insert(rateLimits)
    .values({ key: `${limit.name}:${subject}`, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [rateLimits.key, rateLimits.windowStart],
      set: { count: sql`${rateLimits.count} + 1` },
    })
    .returning({ count: rateLimits.count });
  return row.count <= limit.max;
}

/** Deletes windows older than a day (called opportunistically by the refresh job). */
export async function pruneRateLimits(db: Executor, now: number): Promise<void> {
  await db.delete(rateLimits).where(sql`${rateLimits.windowStart} < ${new Date(now - 24 * 60 * 60 * 1000)}`);
}
