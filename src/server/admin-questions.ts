/**
 * Question Builder service (admin only; routes check the session first).
 *
 * Lifecycle of a custom question:
 *   draft      → saved, not yet validated (or edited since validation)
 *   validated  → current content passed validation; publishable
 *   published  → its content is a live question version (random games, future dailies)
 *   disabled   → its version is inactive; never picked for new games
 *
 * Everything that decides answers reuses the game's own engines: checkCriteria for
 * eligibility, resolvePlayerName for typed names, rankPlayers for the Top-5 rule,
 * buildDistribution/scoreFromSnapshot for the expected tier, and createQuestionVersion
 * for publishing. There is no second implementation that could disagree with play.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { checkCriteria } from "@/lib/baseball/criteria";
import type { PlayerIndex } from "@/lib/baseball/dataset";
import { resolvePlayerName } from "@/lib/baseball/resolve-player";
import { normalizeName } from "@/lib/baseball/normalize-name";
import { rankingConfigFor, statValue, STAT_META } from "@/lib/questions/ranking";
import { categoryOf } from "@/lib/questions/selection";
import { computeEligible, validateQuestion, type ValidationReport } from "@/lib/questions/validate-question";
import { buildDistribution, scoreFromSnapshot } from "@/lib/rarity/rarity";
import { questionCriteriaSchema, type QuestionCriteria, type ScoreResult } from "@/types/baseball";
import type { Db, Executor } from "./db/client";
import { questionDrafts, questions, questionVersions, scoringSnapshots } from "./db/schema";
import { GameError } from "./game-service";
import { clearQuestionCaches, createQuestionVersion, effectiveTopFive } from "./question-store";

type DraftRow = typeof questionDrafts.$inferSelect;

export interface DraftInput {
  prompt: string;
  /** Untrusted JSON from the Builder; validated with the criteria schema. */
  criteria: unknown;
  plakataPick: string | null;
  topFiveOverride: boolean;
}

export interface DraftView {
  id: string;
  slug: string;
  prompt: string;
  criteria: unknown;
  category: string | null;
  plakataPick: string | null;
  topFiveOverride: boolean;
  status: DraftRow["status"];
  validation: ValidationReport | null;
  /** The validation report is for the current content. */
  validationCurrent: boolean;
  live: { versionId: number; version: number; active: boolean } | null;
  updatedAt: string;
}

const notFound = () => new GameError("not_found", 404, "Question not found.");

function draftHash(d: Pick<DraftRow, "prompt" | "criteria" | "plakataPick" | "topFiveOverride">, release: string): string {
  return createHash("sha256")
    .update(JSON.stringify([d.prompt.trim(), d.criteria, d.plakataPick, d.topFiveOverride, release]))
    .digest("hex");
}

function slugFor(prompt: string): string {
  const base = prompt
    .toLowerCase()
    .replace(/^name (an mlb player|a player|a pitcher)\s*/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `custom-${base || "question"}-${randomBytes(3).toString("hex")}`;
}

function parseInput(raw: unknown): DraftInput {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (typeof r.prompt !== "string" || r.prompt.length > 300) throw new GameError("invalid_request", 400, "Question text is required.");
  if (r.plakataPick !== null && r.plakataPick !== undefined && (typeof r.plakataPick !== "string" || r.plakataPick.length > 20)) {
    throw new GameError("invalid_request", 400, "Invalid Plákata pick.");
  }
  if (typeof r.topFiveOverride !== "boolean") throw new GameError("invalid_request", 400, "topFiveOverride must be true or false.");
  if (typeof r.criteria !== "object" || r.criteria === null || JSON.stringify(r.criteria).length > 2000) {
    throw new GameError("invalid_request", 400, "Invalid criteria.");
  }
  return { prompt: r.prompt, criteria: r.criteria, plakataPick: (r.plakataPick as string | undefined) || null, topFiveOverride: r.topFiveOverride };
}

async function loadDraft(db: Executor, id: string): Promise<DraftRow> {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw notFound();
  const [row] = await db.select().from(questionDrafts).where(eq(questionDrafts.id, id));
  if (!row) throw notFound();
  return row;
}

async function liveVersion(db: Executor, row: DraftRow) {
  if (row.publishedVersionId === null) return null;
  const [v] = await db.select().from(questionVersions).where(eq(questionVersions.id, row.publishedVersionId));
  return v ?? null;
}

async function toView(db: Executor, row: DraftRow, index: PlayerIndex): Promise<DraftView> {
  const live = await liveVersion(db, row);
  const parsed = questionCriteriaSchema.safeParse(row.criteria);
  return {
    id: row.id,
    slug: row.slug,
    prompt: row.prompt,
    criteria: row.criteria,
    category: parsed.success ? categoryOf(parsed.data.type) : null,
    plakataPick: row.plakataPick,
    topFiveOverride: row.topFiveOverride,
    status: row.status,
    validation: (row.validation as ValidationReport | null) ?? null,
    validationCurrent: row.validatedHash !== null && row.validatedHash === draftHash(row, index.meta.release),
    live: live ? { versionId: live.id, version: live.version, active: live.active } : null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

// --- List / create / update ------------------------------------------------------------

export interface QuestionList {
  drafts: DraftView[];
  /** Read-only: the questions from src/data/question-bank.ts (edit that file to change them). */
  bank: { slug: string; prompt: string; version: number; category: string; eligibleCount: number; topFiveOverride: boolean }[];
}

export async function listQuestions(db: Db, index: PlayerIndex): Promise<QuestionList> {
  const drafts = await db.select().from(questionDrafts).orderBy(desc(questionDrafts.updatedAt));
  const bank = await db
    .select({
      slug: questionVersions.slug,
      prompt: questionVersions.prompt,
      version: questionVersions.version,
      category: questionVersions.category,
      eligibleCount: questionVersions.eligibleCount,
      topFiveOverride: questionVersions.topFiveOverride,
    })
    .from(questionVersions)
    .innerJoin(questions, eq(questions.slug, questionVersions.slug))
    .where(and(eq(questionVersions.active, true), eq(questions.source, "bank")))
    .orderBy(questionVersions.category, questionVersions.slug);
  return { drafts: await Promise.all(drafts.map((d) => toView(db, d, index))), bank };
}

export async function getDraft(db: Db, id: string, index: PlayerIndex): Promise<DraftView> {
  return toView(db, await loadDraft(db, id), index);
}

export async function createDraft(db: Db, raw: unknown, index: PlayerIndex, now: Date): Promise<DraftView> {
  const input = parseInput(raw);
  const [row] = await db
    .insert(questionDrafts)
    .values({
      id: randomUUID(),
      slug: slugFor(input.prompt),
      prompt: input.prompt.trim(),
      criteria: input.criteria as QuestionCriteria,
      plakataPick: input.plakataPick,
      topFiveOverride: input.topFiveOverride,
      status: "draft",
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return toView(db, row, index);
}

/**
 * Saves edits. A published question keeps serving its live version until the edits
 * are validated and published as a NEW version; past rounds keep their version.
 */
export async function updateDraft(db: Db, id: string, raw: unknown, index: PlayerIndex, now: Date): Promise<DraftView> {
  const input = parseInput(raw);
  const row = await loadDraft(db, id);
  const next = {
    prompt: input.prompt.trim(),
    criteria: input.criteria as QuestionCriteria,
    plakataPick: input.plakataPick,
    topFiveOverride: input.topFiveOverride,
  };
  const changed = draftHash(next, index.meta.release) !== draftHash(row, index.meta.release);
  const [saved] = await db
    .update(questionDrafts)
    .set({ ...next, ...(changed && row.status !== "disabled" ? { status: "draft" as const } : {}), updatedAt: now })
    .where(eq(questionDrafts.id, id))
    .returning();
  return toView(db, saved, index);
}

// --- Validation -------------------------------------------------------------------------

/** Picks and prompts of every OTHER active question (picks and prompts are single-use). */
async function otherActive(db: Executor, ownSlug: string) {
  const active = await db
    .select({ id: questionVersions.id, slug: questionVersions.slug, prompt: questionVersions.prompt })
    .from(questionVersions)
    .where(eq(questionVersions.active, true));
  const others = active.filter((v) => v.slug !== ownSlug);
  const picks = new Map<string, string>();
  if (others.length > 0) {
    const snaps = await db
      .selectDistinctOn([scoringSnapshots.questionVersionId], {
        versionId: scoringSnapshots.questionVersionId,
        pick: scoringSnapshots.plakataPick,
      })
      .from(scoringSnapshots)
      .where(and(inArray(scoringSnapshots.questionVersionId, others.map((o) => o.id)), isNotNull(scoringSnapshots.activatedAt)))
      .orderBy(scoringSnapshots.questionVersionId, desc(scoringSnapshots.activatedAt), desc(scoringSnapshots.id));
    const promptOf = new Map(others.map((o) => [o.id, o.prompt]));
    for (const s of snaps) picks.set(s.pick, promptOf.get(s.versionId) ?? "another question");
  }
  return { otherPicks: picks, otherPrompts: new Set(others.map((o) => o.prompt.trim().toLowerCase())) };
}

async function runValidation(db: Executor, row: DraftRow, index: PlayerIndex, now: Date): Promise<ValidationReport> {
  const ctx = await otherActive(db, row.slug);
  return validateQuestion(
    { prompt: row.prompt, criteria: row.criteria, plakataPick: row.plakataPick, topFiveOverride: row.topFiveOverride },
    { index, ...ctx },
    now,
  );
}

export async function validateDraft(db: Db, id: string, index: PlayerIndex, now: Date): Promise<DraftView> {
  const row = await loadDraft(db, id);
  const report = await runValidation(db, row, index, now);
  const live = await liveVersion(db, row);
  const unchangedFromLive = live !== null && live.contentHash === liveHashFor(row, index);
  const status: DraftRow["status"] = unchangedFromLive
    ? live.active
      ? "published"
      : "disabled"
    : report.status === "ready"
      ? "validated"
      : "draft";
  const [saved] = await db
    .update(questionDrafts)
    .set({ validation: report, validatedHash: draftHash(row, index.meta.release), status, updatedAt: now })
    .where(eq(questionDrafts.id, id))
    .returning();
  return toView(db, saved, index);
}

/** The question-version content hash this draft would publish as (null if unpublishable). */
function liveHashFor(row: DraftRow, index: PlayerIndex): string | null {
  const parsed = questionCriteriaSchema.safeParse(row.criteria);
  if (!parsed.success) return null;
  try {
    const topFive = effectiveTopFive(parsed.data, row.topFiveOverride);
    return createVersionHash(row.prompt.trim(), parsed.data, index.meta.release, topFive);
  } catch {
    return null;
  }
}

function createVersionHash(prompt: string, criteria: QuestionCriteria, release: string, topFive: boolean): string {
  const parts: unknown[] = [prompt, criteria, release];
  if (topFive) parts.push("top-five-bunt");
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

// --- Answer preview and test --------------------------------------------------------------

/** The draft's verified answers, ranking and a zero-observation scoring preview. */
function previewFor(row: DraftRow, index: PlayerIndex) {
  const parsed = questionCriteriaSchema.safeParse(row.criteria);
  if (!parsed.success) throw new GameError("unsupported", 422, "This question requires a criteria type that is not currently supported.");
  const criteria = parsed.data;
  const topFive = row.topFiveOverride && rankingConfigFor(criteria) !== null;
  const set = computeEligible(criteria, topFive, index);
  const ids = set.players.map((p) => p.id);
  const pick = row.plakataPick && ids.includes(row.plakataPick) && !set.buntOverride.includes(row.plakataPick) ? row.plakataPick : null;
  // The same scoring as a freshly published version: uniform prior, no observations yet.
  const dist = ids.length > 0 ? buildDistribution({ eligible: ids, plakataPick: pick ?? ids[0], buntOverride: set.buntOverride }) : null;
  const expected = (id: string): ScoreResult | null => {
    if (!dist) return null;
    if (!pick && id === ids[0] && !set.buntOverride.includes(id)) return null; // placeholder pick, not a real Plákata
    return scoreFromSnapshot(dist, id, true);
  };
  return { criteria, set, expected, rankOf: new Map(set.ranked.map((r) => [r.playerId, r])) };
}

export interface EligibleRow {
  playerId: string;
  name: string;
  years: string;
  games: number;
  evidence: string;
  stat: { label: string; value: number | null } | null;
  rank: number | null;
  topFive: boolean;
  plakataPick: boolean;
  expectedTier: string | null;
}

export async function eligiblePreview(
  db: Db,
  id: string,
  opts: { q?: string; page?: number; pageSize?: number; sort?: "stat" | "name" | "games" },
  index: PlayerIndex,
): Promise<{ total: number; page: number; pageSize: number; sort: string; rows: EligibleRow[] }> {
  const row = await loadDraft(db, id);
  const { criteria, set, expected, rankOf } = previewFor(row, index);
  const config = criteria.type === "stat_threshold" ? { stat: criteria.stat, scope: criteria.scope } : null;
  const q = opts.q ? normalizeName(opts.q) : "";
  let players = q ? set.players.filter((p) => normalizeName(p.name).includes(q) || p.id.includes(q)) : [...set.players];
  const sort = opts.sort ?? (config ? "stat" : "name");
  if (sort === "stat" && config) {
    players.sort((a, b) => (statValue(b, config.stat, config.scope) ?? -1) - (statValue(a, config.stat, config.scope) ?? -1) || a.id.localeCompare(b.id));
  } else if (sort === "games") players.sort((a, b) => b.games - a.games || a.id.localeCompare(b.id));
  else players.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const pageSize = Math.min(100, Math.max(5, opts.pageSize ?? 25));
  const page = Math.max(1, opts.page ?? 1);
  const total = players.length;
  players = players.slice((page - 1) * pageSize, page * pageSize);
  return {
    total,
    page,
    pageSize,
    sort,
    rows: players.map((p) => {
      const r = rankOf.get(p.id);
      return {
        playerId: p.id,
        name: p.name,
        years: p.firstYear === p.lastYear ? `${p.firstYear}` : `${p.firstYear}–${p.lastYear}`,
        games: p.games,
        evidence: checkCriteria(p, criteria, index).explanation,
        stat: config ? { label: STAT_META[config.stat].label, value: statValue(p, config.stat, config.scope) ?? null } : null,
        rank: r?.rank ?? null,
        topFive: set.buntOverride.includes(p.id),
        plakataPick: p.id === row.plakataPick,
        expectedTier: expected(p.id)?.label ?? null,
      };
    }),
  };
}

export interface AnswerTest {
  input: string;
  recognized: boolean;
  resolution: "resolved" | "namesakes" | "suggestion" | "ambiguous" | "unrecognized";
  message: string;
  suggestion?: string;
  players: {
    playerId: string;
    name: string;
    years: string;
    qualifies: boolean;
    evidence: string;
    stat: { label: string; value: number | null } | null;
    rank: number | null;
    topFive: boolean;
    expected: Pick<ScoreResult, "tier" | "label" | "points" | "method" | "overrideApplied"> | null;
  }[];
}

/** "Would this name be accepted, and how would it score?" Same resolver and criteria as play. */
export async function testAnswer(db: Db, id: string, input: string, index: PlayerIndex): Promise<AnswerTest> {
  if (typeof input !== "string" || input.trim().length === 0 || input.length > 100) {
    throw new GameError("invalid_request", 400, "Enter a player name to test.");
  }
  const row = await loadDraft(db, id);
  const { criteria, set, expected, rankOf } = previewFor(row, index);
  const resolution = resolvePlayerName(input, index);
  const config = criteria.type === "stat_threshold" ? { stat: criteria.stat, scope: criteria.scope } : null;
  const eligibleIds = new Set(set.players.map((p) => p.id));
  const describe = (p: NonNullable<ReturnType<PlayerIndex["getById"]>>) => {
    const qualifies = eligibleIds.has(p.id);
    const score = qualifies ? expected(p.id) : null;
    return {
      playerId: p.id,
      name: p.name,
      years: p.firstYear === p.lastYear ? `${p.firstYear}` : `${p.firstYear}–${p.lastYear}`,
      qualifies,
      evidence: checkCriteria(p, criteria, index).explanation,
      stat: config ? { label: STAT_META[config.stat].label, value: statValue(p, config.stat, config.scope) ?? null } : null,
      rank: rankOf.get(p.id)?.rank ?? null,
      topFive: set.buntOverride.includes(p.id),
      expected: score
        ? { tier: score.tier, label: score.label, points: score.points, method: score.method, overrideApplied: score.overrideApplied }
        : null,
    };
  };
  switch (resolution.kind) {
    case "resolved":
      return { input, recognized: true, resolution: "resolved", message: `Recognized as ${resolution.player.name}.`, players: [describe(resolution.player)] };
    case "namesakes":
      return {
        input,
        recognized: true,
        resolution: "namesakes",
        message: "Several players share this name. In a game, any one that fits counts; if several fit, the player picks one.",
        players: resolution.players.map(describe),
      };
    case "suggestion":
      return { input, recognized: false, resolution: "suggestion", suggestion: resolution.suggestion, message: `Not an exact match. The game would ask "Did you mean ${resolution.suggestion}?"`, players: [] };
    case "ambiguous":
      return { input, recognized: false, resolution: "ambiguous", message: "Matches several players; the game asks for a full name.", players: [] };
    case "unrecognized":
      return { input, recognized: false, resolution: "unrecognized", message: "No player by that name in the dataset.", players: [] };
  }
}

// --- Publish / disable ---------------------------------------------------------------------

/**
 * Publishes the draft's CURRENT content as a new, immutable question version.
 * Re-validates on the server first; never trusts a stored report.
 */
export async function publishDraft(db: Db, id: string, index: PlayerIndex, now: Date): Promise<DraftView> {
  const row = await loadDraft(db, id);
  if (row.validatedHash !== draftHash(row, index.meta.release) || (row.status !== "validated" && row.status !== "published")) {
    throw new GameError("not_validated", 409, "Validate the current version of this question before publishing.");
  }
  const report = await runValidation(db, row, index, now);
  if (report.status !== "ready") {
    throw new GameError("validation_failed", 422, `This question can't be published: ${report.errors[0] ?? "validation failed"}`);
  }
  const live = await liveVersion(db, row);
  if (live?.active && live.contentHash === liveHashFor(row, index)) {
    throw new GameError("already_published", 409, "This exact version is already published.");
  }
  const criteria = questionCriteriaSchema.parse(row.criteria);
  const saved = await db.transaction(async (tx) => {
    const created = await createQuestionVersion(
      tx,
      {
        slug: row.slug,
        source: "custom",
        prompt: row.prompt.trim(),
        criteria,
        plakataPick: row.plakataPick!,
        topFiveOverride: effectiveTopFive(criteria, row.topFiveOverride),
        active: true,
        validation: report,
      },
      index,
      now,
    );
    const [updated] = await tx
      .update(questionDrafts)
      .set({ status: "published", publishedVersionId: created.versionId, validation: report, updatedAt: now })
      .where(eq(questionDrafts.id, id))
      .returning();
    return updated;
  });
  return toView(db, saved, index);
}

/** Takes the live version out of rotation. Games already created keep their questions. */
export async function setPublished(db: Db, id: string, enabled: boolean, index: PlayerIndex, now: Date): Promise<DraftView> {
  const row = await loadDraft(db, id);
  if (row.publishedVersionId === null) throw new GameError("not_published", 409, "This question hasn't been published.");
  const saved = await db.transaction(async (tx) => {
    if (enabled) {
      await tx.update(questionVersions).set({ active: false }).where(eq(questionVersions.slug, row.slug));
    }
    await tx.update(questionVersions).set({ active: enabled }).where(eq(questionVersions.id, row.publishedVersionId!));
    const live = await liveVersion(tx, row);
    const status: DraftRow["status"] = enabled
      ? live?.contentHash === liveHashFor(row, index)
        ? "published"
        : row.validatedHash === draftHash(row, index.meta.release) && (row.validation as ValidationReport | null)?.status === "ready"
          ? "validated"
          : "draft"
      : "disabled";
    const [updated] = await tx.update(questionDrafts).set({ status, updatedAt: now }).where(eq(questionDrafts.id, id)).returning();
    return updated;
  });
  clearQuestionCaches();
  return toView(db, saved, index);
}

// --- Builder form options --------------------------------------------------------------

export function builderOptions(index: PlayerIndex) {
  const players = index.all();
  const countries = new Map<string, number>();
  const states = new Map<string, number>();
  for (const p of players) {
    if (p.birthCountry) countries.set(p.birthCountry, (countries.get(p.birthCountry) ?? 0) + 1);
    if (p.birthCountry === "USA" && p.birthState) states.set(p.birthState, (states.get(p.birthState) ?? 0) + 1);
  }
  const usedTeams = new Set(players.flatMap((p) => p.teams));
  const usedFranchises = new Set(players.flatMap((p) => p.franchises));
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  return {
    dataset: index.meta,
    lastSeason: Math.max(...players.map((p) => p.lastYear)),
    firstSeason: Math.min(...players.map((p) => p.firstYear)),
    stats: Object.entries(STAT_META).map(([key, m]) => ({ key, label: m.label })),
    teams: [...usedTeams].map((id) => ({ id, name: `${index.teamName(id)} (${id})` })).sort(byName),
    franchises: [...usedFranchises].map((id) => ({ id, name: `${index.franchiseName(id)} (${id})` })).sort(byName),
    countries: [...countries].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    usStates: [...states].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}
