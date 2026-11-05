import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/server/db/client";
import { refreshSnapshots } from "@/server/question-store";
import { pruneRateLimits } from "@/server/rate-limit";

/**
 * GET /api/cron/refresh-rarity: rebuilds scoring snapshots from community answers.
 * Called by Vercel Cron (see vercel.json) with "Authorization: Bearer $CRON_SECRET".
 * Disabled unless CRON_SECRET is set.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (!secret || given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = await getDb();
  const reports = await refreshSnapshots(db);
  await pruneRateLimits(db, Date.now());
  return Response.json({ refreshed: reports.length, observations: reports.reduce((n, r) => n + r.observations, 0) });
}
