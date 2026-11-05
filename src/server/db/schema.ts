/**
 * PostgreSQL schema (Drizzle ORM). Migrations live in /drizzle and are generated
 * with `npm run db:generate`; apply them with `npm run plakata -- db:migrate`.
 *
 * Five things are kept apart on purpose (see README "Data integrity"):
 *   submissions          every attempt, right or wrong (an audit log)
 *   rounds               the one accepted answer per round, and its awarded points
 *   rarity_observations  at most one per participant per question version: the ONLY input to rarity
 *   rarity_stats         aggregated, smoothed probabilities (rebuilt on refresh)
 *   scoring_snapshots    frozen distributions that rounds are scored against
 */
import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { SnapshotDistribution } from "@/lib/rarity/rarity";
import type { QuestionCriteria } from "@/types/baseball";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/** Anonymous player identity, issued by the server in a signed HttpOnly cookie. */
export const participants = pgTable("participants", {
  id: uuid("id").primaryKey(),
  createdAt: ts("created_at").notNull().defaultNow(),
  /** HMAC of the first IP seen (never the raw IP). Used only for abuse limits. */
  ipHash: text("ip_hash"),
});

/** Lahman players (imported from players.json) plus curated aliases. */
export const players = pgTable("players", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  lastName: text("last_name").notNull(),
  aliases: text("aliases").array().notNull().default(sql`'{}'::text[]`),
  /** The full BaseballPlayer record (stats, teams, birthplace…), for reference and reporting. */
  attributes: jsonb("attributes").notNull(),
  dataRelease: text("data_release").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** A stable question identity. Its wording and rules live in versions. */
export const questions = pgTable("questions", {
  slug: text("slug").primaryKey(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** An immutable question version: prompt + criteria + the data release it was computed from. */
export const questionVersions = pgTable(
  "question_versions",
  {
    id: serial("id").primaryKey(),
    slug: text("slug")
      .notNull()
      .references(() => questions.slug),
    version: integer("version").notNull(),
    prompt: text("prompt").notNull(),
    category: text("category").notNull(),
    criteriaType: text("criteria_type").notNull(),
    criteria: jsonb("criteria").$type<QuestionCriteria>().notNull(),
    /** sha256 of prompt + criteria + data release: a change means a new version. */
    contentHash: text("content_hash").notNull(),
    dataRelease: text("data_release").notNull(),
    eligibleCount: integer("eligible_count").notNull(),
    /** Only one version per slug is active; disabled questions have none active. */
    active: boolean("active").notNull().default(true),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("question_versions_slug_version").on(t.slug, t.version),
    uniqueIndex("question_versions_one_active").on(t.slug).where(sql`${t.active}`),
  ],
);

/** Precomputed answer set for a question version (never edited after creation). */
export const questionEligibility = pgTable(
  "question_eligibility",
  {
    questionVersionId: integer("question_version_id")
      .notNull()
      .references(() => questionVersions.id),
    playerId: text("player_id")
      .notNull()
      .references(() => players.id),
  },
  (t) => [primaryKey({ columns: [t.questionVersionId, t.playerId] })],
);

/** A frozen scoring distribution. Rounds reference the snapshot they were scored with. */
export const scoringSnapshots = pgTable(
  "scoring_snapshots",
  {
    id: serial("id").primaryKey(),
    questionVersionId: integer("question_version_id")
      .notNull()
      .references(() => questionVersions.id),
    calcVersion: text("calc_version").notNull(),
    alpha: doublePrecision("alpha").notNull(),
    plakataPick: text("plakata_pick")
      .notNull()
      .references(() => players.id),
    totalObservations: integer("total_observations").notNull(),
    distribution: jsonb("distribution").$type<SnapshotDistribution>().notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    /** The newest activated snapshot of a version is the one new games use. */
    activatedAt: ts("activated_at"),
  },
  (t) => [index("scoring_snapshots_active").on(t.questionVersionId, t.activatedAt)],
);

/** Aggregated per-answer statistics as of the last refresh. */
export const rarityStats = pgTable(
  "rarity_stats",
  {
    questionVersionId: integer("question_version_id")
      .notNull()
      .references(() => questionVersions.id),
    playerId: text("player_id")
      .notNull()
      .references(() => players.id),
    /** n_aq: eligible observations of this answer. */
    eligibleCount: integer("eligible_count").notNull(),
    /** N_q: eligible observations of the question. */
    totalResponses: integer("total_responses").notNull(),
    priorProbability: doublePrecision("prior_probability").notNull(),
    observedProbability: doublePrecision("observed_probability").notNull(),
    smoothedProbability: doublePrecision("smoothed_probability").notNull(),
    calibratedRarity: doublePrecision("calibrated_rarity").notNull(),
    snapshotId: integer("snapshot_id").references(() => scoringSnapshots.id),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.questionVersionId, t.playerId] })],
);

/** One per UTC day: the same seven questions, order, and snapshots for everyone. */
export const dailyChallenges = pgTable("daily_challenges", {
  day: date("day", { mode: "string" }).primaryKey(),
  questionVersionIds: integer("question_version_ids").array().notNull(),
  snapshotIds: integer("snapshot_ids").array().notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const games = pgTable(
  "games",
  {
    id: uuid("id").primaryKey(),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => participants.id),
    mode: text("mode", { enum: ["daily", "random"] }).notNull(),
    dailyDay: date("daily_day", { mode: "string" }).references(() => dailyChallenges.day),
    status: text("status", { enum: ["active", "complete"] }).notNull().default("active"),
    totalScore: integer("total_score").notNull().default(0),
    createdAt: ts("created_at").notNull().defaultNow(),
    completedAt: ts("completed_at"),
  },
  (t) => [index("games_participant").on(t.participantId, t.createdAt)],
);

export const rounds = pgTable(
  "rounds",
  {
    id: uuid("id").primaryKey(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id),
    position: smallint("position").notNull(),
    questionVersionId: integer("question_version_id")
      .notNull()
      .references(() => questionVersions.id),
    snapshotId: integer("snapshot_id")
      .notNull()
      .references(() => scoringSnapshots.id),
    status: text("status", { enum: ["pending", "active", "answered", "expired"] })
      .notNull()
      .default("pending"),
    startedAt: ts("started_at"),
    /** startedAt + read period: submissions before this are rejected. */
    opensAt: ts("opens_at"),
    expiresAt: ts("expires_at"),
    /** jti of the round token; a token for any other jti is rejected. */
    tokenId: text("token_id"),
    acceptedPlayerId: text("accepted_player_id").references(() => players.id),
    acceptedText: text("accepted_text"),
    explanation: text("explanation"),
    tier: text("tier"),
    points: integer("points"),
    rarity: doublePrecision("rarity"),
    scoreMethod: text("score_method"),
    estimateNote: text("estimate_note"),
    attempts: integer("attempts").notNull().default(0),
    completedAt: ts("completed_at"),
  },
  (t) => [
    uniqueIndex("rounds_game_position").on(t.gameId, t.position),
    check("rounds_points_fixed", sql`${t.points} IS NULL OR ${t.points} IN (0, 10, 25, 50, 75, 100)`),
  ],
);

/** Every answer attempt, including wrong, ambiguous, unrecognized, late and duplicate ones. */
export const submissions = pgTable(
  "submissions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    roundId: uuid("round_id")
      .notNull()
      .references(() => rounds.id),
    questionVersionId: integer("question_version_id")
      .notNull()
      .references(() => questionVersions.id),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => participants.id),
    rawText: text("raw_text").notNull(),
    chosenPlayerId: text("chosen_player_id"),
    resolvedPlayerId: text("resolved_player_id").references(() => players.id),
    /** valid | ineligible | ambiguous | unrecognized | suggestion | choose | expired | not_open | closed */
    outcome: text("outcome").notNull(),
    accepted: boolean("accepted").notNull(),
    receivedAt: ts("received_at").notNull(),
  },
  (t) => [index("submissions_round").on(t.roundId)],
);

/**
 * The community answer distribution's raw input. Policy: the FIRST accepted answer
 * a participant gives to a question version counts; later games (practice, replays)
 * still score but add nothing. Enforced by the unique index.
 */
export const rarityObservations = pgTable(
  "rarity_observations",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    questionVersionId: integer("question_version_id")
      .notNull()
      .references(() => questionVersions.id),
    playerId: text("player_id")
      .notNull()
      .references(() => players.id),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => participants.id),
    roundId: uuid("round_id")
      .notNull()
      .references(() => rounds.id),
    ipHash: text("ip_hash"),
    observedAt: ts("observed_at").notNull(),
  },
  (t) => [
    uniqueIndex("rarity_observations_one_per_participant").on(t.participantId, t.questionVersionId),
    uniqueIndex("rarity_observations_round").on(t.roundId),
    index("rarity_observations_question").on(t.questionVersionId, t.playerId),
    index("rarity_observations_ip").on(t.ipHash, t.questionVersionId, t.observedAt),
  ],
);

/** Fixed-window counters for rate limiting (no Redis needed at this scale). */
export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    windowStart: ts("window_start").notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);
