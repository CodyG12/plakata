/**
 * Questions, eligibility sets and scoring snapshots in the database.
 *
 * Versions, eligibility sets and snapshots are immutable once written, so they're
 * cached in memory forever by id. A question change creates a new version; a rarity
 * refresh creates new snapshots. Nothing a past round depends on is rewritten.
 */
import { createHash } from "node:crypto";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { PLAYER_ALIASES } from "@/data/aliases";
import { QUESTION_BANK, type QuestionDefinition } from "@/data/question-bank";
import { checkCriteria } from "@/lib/baseball/criteria";
import type { PlayerIndex } from "@/lib/baseball/dataset";
import { categoryOf } from "@/lib/questions/selection";
import { buildDistribution, curatedTiersFor, DEFAULT_ALPHA, type SnapshotDistribution } from "@/lib/rarity/rarity";
import { questionCriteriaSchema, type QuestionCriteria } from "@/types/baseball";
import type { Db, Executor } from "./db/client";
import {
  players,
  questionEligibility,
  questions,
  questionVersions,
  rarityObservations,
  rarityStats,
  scoringSnapshots,
} from "./db/schema";

export interface QuestionVersionRow {
  id: number;
  slug: string;
  version: number;
  prompt: string;
  category: string;
  criteria: QuestionCriteria;
  eligibleCount: number;
  active: boolean;
}

export interface SnapshotRow {
  id: number;
  questionVersionId: number;
  distribution: SnapshotDistribution;
}

// --- In-memory caches of immutable rows -------------------------------------------
const cache = globalThis as unknown as {
  __plakataVersions?: Map<number, QuestionVersionRow>;
  __plakataEligibility?: Map<number, Promise<ReadonlySet<string>>>;
  __plakataSnapshots?: Map<number, SnapshotRow>;
};
const versionCache = (cache.__plakataVersions ??= new Map());
const eligibilityCache = (cache.__plakataEligibility ??= new Map());
const snapshotCache = (cache.__plakataSnapshots ??= new Map());

/** Tests use a fresh database per suite, where ids repeat. */
export function clearQuestionCaches(): void {
  versionCache.clear();
  eligibilityCache.clear();
  snapshotCache.clear();
}

export function eligiblePlayerIds(criteria: QuestionCriteria, index: PlayerIndex): string[] {
  return index
    .all()
    .filter((p) => checkCriteria(p, criteria, index).met)
    .map((p) => p.id)
    .sort();
}

function contentHash(def: Pick<QuestionDefinition, "prompt" | "criteria">, dataRelease: string): string {
  return createHash("sha256").update(JSON.stringify([def.prompt, def.criteria, dataRelease])).digest("hex");
}

async function insertChunked<T>(rows: T[], size: number, insert: (chunk: T[]) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < rows.length; i += size) await insert(rows.slice(i, i + size));
}

// --- Import --------------------------------------------------------------------------

/** Upserts every player (and curated aliases) from the bundled Lahman dataset. */
export async function importPlayers(db: Db, index: PlayerIndex): Promise<number> {
  const aliases = new Map<string, string[]>();
  for (const [name, id] of PLAYER_ALIASES) aliases.set(id, [...(aliases.get(id) ?? []), name]);
  const rows = index.all().map((p) => ({
    id: p.id,
    name: p.name,
    lastName: p.lastName,
    aliases: aliases.get(p.id) ?? [],
    attributes: p,
    dataRelease: index.meta.release,
  }));
  await insertChunked(rows, 500, (chunk) =>
    db
      .insert(players)
      .values(chunk)
      .onConflictDoUpdate({
        target: players.id,
        set: {
          name: sql`excluded.name`,
          lastName: sql`excluded.last_name`,
          aliases: sql`excluded.aliases`,
          attributes: sql`excluded.attributes`,
          dataRelease: sql`excluded.data_release`,
          updatedAt: sql`now()`,
        },
      }),
  );
  return rows.length;
}

export interface SyncReport {
  slug: string;
  action: "created" | "unchanged" | "reactivated" | "disabled";
  version: number;
  eligibleCount: number;
}

/**
 * Makes the database match the question bank: new or changed questions become new
 * versions (with eligibility sets and a zero-observation snapshot), and removed or
 * `active: false` questions are disabled. Old versions are never edited.
 */
export async function syncQuestionBank(
  db: Db,
  index: PlayerIndex,
  bank: readonly QuestionDefinition[] = QUESTION_BANK,
  now: Date = new Date(),
): Promise<SyncReport[]> {
  const reports: SyncReport[] = [];
  const slugs = new Set<string>();
  for (const def of bank) {
    if (slugs.has(def.slug)) throw new Error(`Duplicate question slug: ${def.slug}`);
    slugs.add(def.slug);
    const criteria = questionCriteriaSchema.parse(def.criteria);
    const hash = contentHash(def, index.meta.release);
    const wantActive = def.active !== false;

    const [latest] = await db
      .select()
      .from(questionVersions)
      .where(eq(questionVersions.slug, def.slug))
      .orderBy(desc(questionVersions.version))
      .limit(1);

    if (latest && latest.contentHash === hash) {
      if (latest.active !== wantActive) {
        await db.update(questionVersions).set({ active: wantActive }).where(eq(questionVersions.id, latest.id));
        versionCache.delete(latest.id);
      }
      reports.push({
        slug: def.slug,
        action: latest.active === wantActive ? "unchanged" : wantActive ? "reactivated" : "disabled",
        version: latest.version,
        eligibleCount: latest.eligibleCount,
      });
      continue;
    }

    const eligible = eligiblePlayerIds(criteria, index);
    if (eligible.length === 0) throw new Error(`${def.slug}: no eligible players. Check the criteria`);
    if (!eligible.includes(def.plakataPick)) throw new Error(`${def.slug}: Plákata pick ${def.plakataPick} is not eligible`);
    const version = (latest?.version ?? 0) + 1;

    await db.transaction(async (tx) => {
      await tx.insert(questions).values({ slug: def.slug }).onConflictDoNothing();
      await tx.update(questionVersions).set({ active: false }).where(eq(questionVersions.slug, def.slug));
      const [row] = await tx
        .insert(questionVersions)
        .values({
          slug: def.slug,
          version,
          prompt: def.prompt,
          category: categoryOf(criteria.type),
          criteriaType: criteria.type,
          criteria,
          contentHash: hash,
          dataRelease: index.meta.release,
          eligibleCount: eligible.length,
          active: wantActive,
        })
        .returning({ id: questionVersions.id });
      await insertChunked(eligible, 2000, (chunk) =>
        tx.insert(questionEligibility).values(chunk.map((playerId) => ({ questionVersionId: row.id, playerId }))),
      );
      await writeSnapshot(tx, row.id, def.slug, eligible, def.plakataPick, new Map(), DEFAULT_ALPHA, now);
    });
    if (latest) versionCache.delete(latest.id);
    reports.push({ slug: def.slug, action: "created", version, eligibleCount: eligible.length });
  }

  // Questions removed from the bank are disabled, never deleted (old rounds point at them).
  const removed = await db
    .select({ id: questionVersions.id, slug: questionVersions.slug, version: questionVersions.version, n: questionVersions.eligibleCount })
    .from(questionVersions)
    .where(eq(questionVersions.active, true));
  for (const row of removed) {
    if (slugs.has(row.slug)) continue;
    await db.update(questionVersions).set({ active: false }).where(eq(questionVersions.id, row.id));
    versionCache.delete(row.id);
    reports.push({ slug: row.slug, action: "disabled", version: row.version, eligibleCount: row.n });
  }
  return reports;
}

// --- Reads (cached) -------------------------------------------------------------------

export async function listActiveVersions(db: Executor): Promise<QuestionVersionRow[]> {
  const rows = await db.select().from(questionVersions).where(eq(questionVersions.active, true));
  return rows.map(toVersionRow);
}

function toVersionRow(r: typeof questionVersions.$inferSelect): QuestionVersionRow {
  return {
    id: r.id,
    slug: r.slug,
    version: r.version,
    prompt: r.prompt,
    category: r.category,
    criteria: r.criteria,
    eligibleCount: r.eligibleCount,
    active: r.active,
  };
}

/** Prompt, criteria and category never change for a version id, so this is cached. */
export async function getVersions(db: Executor, ids: readonly number[]): Promise<Map<number, QuestionVersionRow>> {
  const missing = [...new Set(ids)].filter((id) => !versionCache.has(id));
  if (missing.length > 0) {
    const rows = await db.select().from(questionVersions).where(inArray(questionVersions.id, missing));
    for (const r of rows) versionCache.set(r.id, toVersionRow(r));
  }
  const out = new Map<number, QuestionVersionRow>();
  for (const id of ids) {
    const row = versionCache.get(id);
    if (!row) throw new Error(`Unknown question version ${id}`);
    out.set(id, row);
  }
  return out;
}

/** The precomputed eligibility set (one query per version per server process). */
export function getEligibility(db: Executor, versionId: number): Promise<ReadonlySet<string>> {
  let pending = eligibilityCache.get(versionId);
  if (!pending) {
    pending = db
      .select({ playerId: questionEligibility.playerId })
      .from(questionEligibility)
      .where(eq(questionEligibility.questionVersionId, versionId))
      .then((rows) => new Set(rows.map((r) => r.playerId)) as ReadonlySet<string>);
    pending.catch(() => eligibilityCache.delete(versionId));
    eligibilityCache.set(versionId, pending);
  }
  return pending;
}

export async function getSnapshot(db: Executor, id: number): Promise<SnapshotRow> {
  const cached = snapshotCache.get(id);
  if (cached) return cached;
  const [row] = await db
    .select({ id: scoringSnapshots.id, questionVersionId: scoringSnapshots.questionVersionId, distribution: scoringSnapshots.distribution })
    .from(scoringSnapshots)
    .where(eq(scoringSnapshots.id, id));
  if (!row) throw new Error(`Unknown scoring snapshot ${id}`);
  snapshotCache.set(id, row);
  return row;
}

/** The newest activated snapshot for each version. */
export async function activeSnapshotIds(db: Executor, versionIds: readonly number[]): Promise<Map<number, number>> {
  if (versionIds.length === 0) return new Map();
  const rows = await db
    .selectDistinctOn([scoringSnapshots.questionVersionId], {
      versionId: scoringSnapshots.questionVersionId,
      id: scoringSnapshots.id,
    })
    .from(scoringSnapshots)
    .where(and(inArray(scoringSnapshots.questionVersionId, [...versionIds]), isNotNull(scoringSnapshots.activatedAt)))
    .orderBy(scoringSnapshots.questionVersionId, desc(scoringSnapshots.activatedAt), desc(scoringSnapshots.id));
  const out = new Map(rows.map((r) => [r.versionId, r.id]));
  for (const id of versionIds) if (!out.has(id)) throw new Error(`Question version ${id} has no active scoring snapshot`);
  return out;
}

// --- Rarity snapshots ------------------------------------------------------------------

async function writeSnapshot(
  db: Executor,
  versionId: number,
  slug: string,
  eligible: readonly string[],
  plakataPick: string,
  counts: ReadonlyMap<string, number>,
  alpha: number,
  now: Date,
): Promise<number> {
  const distribution = buildDistribution({ eligible, curated: curatedTiersFor(slug), counts, alpha, plakataPick });
  const [snap] = await db
    .insert(scoringSnapshots)
    .values({
      questionVersionId: versionId,
      calcVersion: distribution.calcVersion,
      alpha,
      plakataPick,
      totalObservations: distribution.totalObservations,
      distribution,
      activatedAt: now,
    })
    .returning({ id: scoringSnapshots.id });

  // Per-answer statistics for every answer with its own entry (curated or named at least once).
  const stats = Object.entries(distribution.players).map(([playerId, s]) => ({
    questionVersionId: versionId,
    playerId,
    eligibleCount: s.n,
    totalResponses: distribution.totalObservations,
    priorProbability: s.prior,
    observedProbability: s.observed,
    smoothedProbability: s.smoothed,
    calibratedRarity: s.rarity,
    snapshotId: snap.id,
    updatedAt: now,
  }));
  await insertChunked(stats, 1000, (chunk) =>
    db
      .insert(rarityStats)
      .values(chunk)
      .onConflictDoUpdate({
        target: [rarityStats.questionVersionId, rarityStats.playerId],
        set: {
          eligibleCount: sql`excluded.eligible_count`,
          totalResponses: sql`excluded.total_responses`,
          priorProbability: sql`excluded.prior_probability`,
          observedProbability: sql`excluded.observed_probability`,
          smoothedProbability: sql`excluded.smoothed_probability`,
          calibratedRarity: sql`excluded.calibrated_rarity`,
          snapshotId: sql`excluded.snapshot_id`,
          updatedAt: sql`excluded.updated_at`,
        },
      }),
  );
  return snap.id;
}

export interface RefreshReport {
  slug: string;
  versionId: number;
  snapshotId: number;
  observations: number;
}

/**
 * Rebuilds a scoring snapshot for every active question version from the current
 * observations. New games use the new snapshots; games already created, and today's
 * daily challenge, keep the snapshots they froze.
 */
export async function refreshSnapshots(
  db: Db,
  opts: { alpha?: number; now?: Date; bank?: readonly QuestionDefinition[] } = {},
): Promise<RefreshReport[]> {
  const alpha = opts.alpha ?? Number(process.env.RARITY_ALPHA ?? DEFAULT_ALPHA);
  const now = opts.now ?? new Date();
  const bank = new Map((opts.bank ?? QUESTION_BANK).map((d) => [d.slug, d]));
  const reports: RefreshReport[] = [];
  for (const version of await listActiveVersions(db)) {
    const eligible = [...(await getEligibility(db, version.id))];
    const countRows = await db
      .select({ playerId: rarityObservations.playerId, n: sql<number>`count(*)::int` })
      .from(rarityObservations)
      .where(eq(rarityObservations.questionVersionId, version.id))
      .groupBy(rarityObservations.playerId);
    const counts = new Map(countRows.map((r) => [r.playerId, Number(r.n)]));
    const pick = bank.get(version.slug)?.plakataPick ?? (await previousPick(db, version.id));
    const snapshotId = await db.transaction((tx) =>
      writeSnapshot(tx, version.id, version.slug, eligible, pick, counts, alpha, now),
    );
    reports.push({
      slug: version.slug,
      versionId: version.id,
      snapshotId,
      observations: [...counts.values()].reduce((a, b) => a + b, 0),
    });
  }
  return reports;
}

async function previousPick(db: Executor, versionId: number): Promise<string> {
  const [row] = await db
    .select({ pick: scoringSnapshots.plakataPick })
    .from(scoringSnapshots)
    .where(eq(scoringSnapshots.questionVersionId, versionId))
    .orderBy(desc(scoringSnapshots.id))
    .limit(1);
  if (!row) throw new Error(`Question version ${versionId} has no Plákata pick`);
  return row.pick;
}
