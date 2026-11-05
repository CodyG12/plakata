/**
 * Server-authoritative game lifecycle. The browser displays the game; this module
 * decides everything: which questions, when a round opens and closes, whether an
 * answer is right, which tier it earns, and the total.
 *
 * Deadline policy: a submission counts if the server RECEIVES it no later than
 * expiresAt + LATENCY_GRACE_MS (750 ms), measured on the server clock only.
 * Answers received before opensAt (during the 3-second read) are rejected.
 *
 * One accepted answer per round is guaranteed by a conditional update
 * (`UPDATE rounds … WHERE status = 'active'`): of two simultaneous correct answers,
 * exactly one changes the row; the other sees the finished round.
 */
import { randomUUID } from "node:crypto";
import { and, asc, eq, gte, sql } from "drizzle-orm";
import { getPlayerIndex } from "@/lib/baseball/dataset";
import { noAnswerScore, tierConfig, isScoringTier } from "@/lib/baseball/scoring";
import { validateAnswer, type AnswerTarget } from "@/lib/baseball/validate-answer";
import {
  LATENCY_GRACE_MS,
  READ_SECONDS,
  ROUND_COUNT,
  ROUND_SECONDS,
  type GameMode,
} from "@/lib/game/config";
import { cryptoRng, selectBalanced, selectDaily, utcDay, type Rng } from "@/lib/questions/selection";
import { scoreFromSnapshot } from "@/lib/rarity/rarity";
import type { ScoreMethod, ScoreResult, ValidationResult } from "@/types/baseball";
import type { ActiveRoundView, GameView, RoundResultView, SubmitResponse } from "@/types/api";
import type { Db, Executor } from "./db/client";
import { dailyChallenges, games, participants, rarityObservations, rounds, submissions } from "./db/schema";
import { activeSnapshotIds, getEligibility, getSnapshot, getVersions, listActiveVersions } from "./question-store";
import { hit, LIMITS, MAX_OBSERVATIONS_PER_IP_PER_QUESTION_PER_DAY } from "./rate-limit";
import { signRoundToken, verifyRoundToken } from "./tokens";

export class GameError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type GameRow = typeof games.$inferSelect;
type RoundRow = typeof rounds.$inferSelect;

export interface Caller {
  participantId: string;
  ipHash: string | null;
}

const MAX_INPUT_LENGTH = 100;

// --- Participants ---------------------------------------------------------------

export async function ensureParticipant(db: Executor, caller: Caller): Promise<void> {
  await db.insert(participants).values({ id: caller.participantId, ipHash: caller.ipHash }).onConflictDoNothing();
}

// --- Create ---------------------------------------------------------------------

export async function createGame(
  db: Db,
  caller: Caller,
  mode: GameMode,
  now: number,
  rng: Rng = cryptoRng,
): Promise<GameView> {
  if (!(await hit(db, LIMITS.createGameParticipant, caller.participantId, now)) ||
      !(await hit(db, LIMITS.createGameIp, caller.ipHash, now))) {
    throw new GameError("rate_limited", 429, "Too many new games. Take a breather and try again soon.");
  }
  await ensureParticipant(db, caller);

  let versionIds: number[];
  let snapshotIds: number[];
  let dailyDay: string | null = null;
  if (mode === "daily") {
    dailyDay = utcDay(now);
    const daily = await getOrCreateDaily(db, dailyDay);
    versionIds = daily.questionVersionIds;
    snapshotIds = daily.snapshotIds;
  } else {
    versionIds = selectBalanced(await listActiveVersions(db), ROUND_COUNT, rng).map((q) => q.id);
    const snaps = await activeSnapshotIds(db, versionIds);
    snapshotIds = versionIds.map((id) => snaps.get(id)!);
  }
  return insertGame(db, caller, mode, dailyDay, versionIds, snapshotIds, now);
}

/**
 * Writes a game with an exact lineup of question versions and snapshots. Internal:
 * the API only reaches it through createGame, which picks the lineup server-side.
 * Tests call it directly to get a fixed question order.
 */
export async function insertGame(
  db: Db,
  caller: Caller,
  mode: GameMode,
  dailyDay: string | null,
  versionIds: readonly number[],
  snapshotIds: readonly number[],
  now: number,
): Promise<GameView> {
  if (versionIds.length !== ROUND_COUNT || snapshotIds.length !== ROUND_COUNT) {
    throw new Error(`A game needs exactly ${ROUND_COUNT} questions and snapshots`);
  }
  await ensureParticipant(db, caller);
  const gameId = randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(games).values({ id: gameId, participantId: caller.participantId, mode, dailyDay, createdAt: new Date(now) });
    await tx.insert(rounds).values(
      versionIds.map((questionVersionId, position) => ({
        id: randomUUID(),
        gameId,
        position,
        questionVersionId,
        snapshotId: snapshotIds[position],
      })),
    );
  });
  return getGameView(db, caller, gameId, now);
}

/**
 * The daily challenge is created once per UTC day (first request wins, via the
 * primary key) and then read back, so every player gets the same questions,
 * order and frozen snapshots all day.
 */
export async function getOrCreateDaily(db: Db, day: string) {
  const existing = await db.select().from(dailyChallenges).where(eq(dailyChallenges.day, day));
  if (existing[0]) return existing[0];
  const active = await listActiveVersions(db);
  const picked = selectDaily(active, day, ROUND_COUNT).map((q) => q.id);
  const snaps = await activeSnapshotIds(db, picked);
  await db
    .insert(dailyChallenges)
    .values({ day, questionVersionIds: picked, snapshotIds: picked.map((id) => snaps.get(id)!) })
    .onConflictDoNothing();
  const [row] = await db.select().from(dailyChallenges).where(eq(dailyChallenges.day, day));
  return row;
}

// --- Read ---------------------------------------------------------------------------

async function loadGame(db: Executor, caller: Caller, gameId: string, lock = false): Promise<GameRow> {
  if (!/^[0-9a-f-]{36}$/.test(gameId)) throw new GameError("not_found", 404, "Game not found.");
  const query = db.select().from(games).where(eq(games.id, gameId));
  const [game] = lock ? await query.for("update") : await query;
  // Someone else's game looks exactly like a missing one.
  if (!game || game.participantId !== caller.participantId) throw new GameError("not_found", 404, "Game not found.");
  return game;
}

async function loadRounds(db: Executor, gameId: string): Promise<RoundRow[]> {
  return db.select().from(rounds).where(eq(rounds.gameId, gameId)).orderBy(asc(rounds.position));
}

export async function getGameView(db: Db, caller: Caller, gameId: string, now: number): Promise<GameView> {
  const game = await loadGame(db, caller, gameId);
  const roundRows = await loadRounds(db, gameId);
  // A round that ran out while nobody was asking is settled lazily, here.
  const stale = roundRows.find((r) => r.status === "active" && isPastDeadline(r, now));
  if (stale) {
    await db.transaction((tx) => expireRound(tx, stale, now));
    return buildView(db, await loadGame(db, caller, gameId), await loadRounds(db, gameId), now);
  }
  return buildView(db, game, roundRows, now);
}

function isPastDeadline(round: RoundRow, now: number): boolean {
  return round.expiresAt !== null && now > round.expiresAt.getTime() + LATENCY_GRACE_MS;
}

async function buildView(db: Executor, game: GameRow, roundRows: RoundRow[], now: number): Promise<GameView> {
  const versions = await getVersions(db, roundRows.map((r) => r.questionVersionId));
  const completed = roundRows.filter((r) => r.status === "answered" || r.status === "expired");
  const active = roundRows.find((r) => r.status === "active");
  return {
    gameId: game.id,
    mode: game.mode,
    dailyDay: game.dailyDay,
    status: game.status,
    totalScore: game.totalScore,
    roundCount: roundRows.length,
    rounds: completed.map((r) => toResultView(r, versions.get(r.questionVersionId)!.prompt)),
    activeRound: active ? await toActiveView(game, active, versions.get(active.questionVersionId)!.prompt) : null,
    serverNow: now,
  };
}

function toScore(r: RoundRow): ScoreResult {
  if (r.status !== "answered" || !r.tier || !isScoringTier(r.tier) || r.points === null) return noAnswerScore();
  const { label } = tierConfig(r.tier);
  return {
    valid: true,
    tier: r.tier,
    label,
    points: r.points,
    estimatedRarity: r.rarity === null ? null : Math.round(r.rarity),
    method: (r.scoreMethod ?? "community") as ScoreMethod,
    estimateNote: r.estimateNote,
  };
}

function toResultView(r: RoundRow, prompt: string): RoundResultView {
  return {
    position: r.position,
    prompt,
    status: r.status as "answered" | "expired",
    acceptedName: r.acceptedText,
    explanation: r.explanation,
    score: toScore(r),
    timedOut: r.status === "expired",
    attempts: r.attempts,
  };
}

async function toActiveView(game: GameRow, r: RoundRow, prompt: string): Promise<ActiveRoundView> {
  const startedAt = r.startedAt!.getTime();
  const expiresAt = r.expiresAt!.getTime();
  // Re-signing yields an equivalent token (same jti), so refreshing the page is harmless.
  const token = await signRoundToken(
    { gameId: game.id, roundId: r.id, questionVersionId: r.questionVersionId, position: r.position, startedAt, expiresAt, jti: r.tokenId! },
    LATENCY_GRACE_MS,
  );
  return {
    roundId: r.id,
    position: r.position,
    prompt,
    startedAt,
    opensAt: r.opensAt!.getTime(),
    expiresAt,
    token,
    attempts: r.attempts,
  };
}

// --- Start ------------------------------------------------------------------------------

/**
 * Starts the next round. Idempotent: if a round is already running it is returned
 * unchanged (refresh, second tab, retried request). Rounds start strictly in order,
 * and only after the previous one has finished.
 */
export async function startNextRound(db: Db, caller: Caller, gameId: string, now: number): Promise<GameView> {
  await db.transaction(async (tx) => {
    const game = await loadGame(tx, caller, gameId, true); // row lock serializes concurrent starts
    if (game.status !== "active") throw new GameError("game_complete", 409, "This game is already over.");
    const roundRows = await loadRounds(tx, gameId);
    const running = roundRows.find((r) => r.status === "active");
    if (running) {
      if (isPastDeadline(running, now)) await expireRound(tx, running, now);
      return; // either still running, or just settled: the client shows its result first
    }
    const next = roundRows.find((r) => r.status === "pending");
    if (!next) throw new GameError("game_complete", 409, "No rounds left.");
    const opensAt = now + READ_SECONDS * 1000;
    await tx
      .update(rounds)
      .set({
        status: "active",
        startedAt: new Date(now),
        opensAt: new Date(opensAt),
        expiresAt: new Date(opensAt + ROUND_SECONDS * 1000),
        tokenId: randomUUID(),
      })
      .where(and(eq(rounds.id, next.id), eq(rounds.status, "pending")));
  });
  return getGameView(db, caller, gameId, now);
}

// --- Finish ----------------------------------------------------------------------------------

/** Settles an active round as a Strikeout if it is still active. */
async function expireRound(tx: Executor, round: RoundRow, now: number): Promise<boolean> {
  const changed = await tx
    .update(rounds)
    .set({ status: "expired", tier: "strikeout", points: 0, scoreMethod: "none", completedAt: new Date(now) })
    .where(and(eq(rounds.id, round.id), eq(rounds.status, "active")))
    .returning({ id: rounds.id });
  if (changed.length > 0) await recomputeGame(tx, round.gameId, now);
  return changed.length > 0;
}

/** The total is always recomputed from the rounds, never accumulated from client input. */
async function recomputeGame(tx: Executor, gameId: string, now: number): Promise<void> {
  await tx
    .update(games)
    .set({
      totalScore: sql`(SELECT coalesce(sum(${rounds.points}), 0) FROM ${rounds} WHERE ${rounds.gameId} = ${gameId})`,
      status: sql`CASE WHEN (SELECT count(*) FROM ${rounds} WHERE ${rounds.gameId} = ${gameId} AND ${rounds.status} IN ('pending', 'active')) = 0 THEN 'complete' ELSE 'active' END`,
      completedAt: sql`CASE WHEN (SELECT count(*) FROM ${rounds} WHERE ${rounds.gameId} = ${gameId} AND ${rounds.status} IN ('pending', 'active')) = 0 THEN ${new Date(now)}::timestamptz ELSE NULL END`,
    })
    .where(eq(games.id, gameId));
}

/**
 * Settles a round whose time is up (called by the client when its countdown ends).
 * If the server still considers the round open, it says so and changes nothing.
 */
export async function completeRound(db: Db, caller: Caller, gameId: string, roundId: string, now: number): Promise<GameView> {
  await loadGame(db, caller, gameId);
  const [round] = await db.select().from(rounds).where(and(eq(rounds.id, roundId), eq(rounds.gameId, gameId)));
  if (!round) throw new GameError("not_found", 404, "Round not found.");
  if (round.status === "active") {
    if (!isPastDeadline(round, now)) throw new GameError("round_in_progress", 409, "This round is still open.");
    await db.transaction((tx) => expireRound(tx, round, now));
  }
  return getGameView(db, caller, gameId, now);
}

// --- Submit ------------------------------------------------------------------------------------

export interface SubmitInput {
  gameId: string;
  roundId: string;
  token: string;
  input: string;
  chosenPlayerId?: string;
}

/** Statuses that count as a wrong guess (suggestions and namesake choices don't). */
const COUNTED_REJECTIONS = new Set<ValidationResult["status"]>(["ineligible", "ambiguous", "unrecognized"]);

export async function submitAnswer(db: Db, caller: Caller, body: SubmitInput, now: number): Promise<SubmitResponse> {
  if (!(await hit(db, LIMITS.submitParticipant, caller.participantId, now)) ||
      !(await hit(db, LIMITS.submitIp, caller.ipHash, now))) {
    throw new GameError("rate_limited", 429, "Slow down: too many guesses at once.");
  }
  const text = body.input.trim();
  if (text.length === 0 || text.length > MAX_INPUT_LENGTH) throw new GameError("invalid_input", 400, "Invalid answer text.");

  const token = await verifyRoundToken(body.token, now);
  // A forged or malformed token is rejected outright. An authentic but expired one
  // still identifies its round; the round row then decides (late = Strikeout).
  if (!token.ok && token.reason === "invalid") throw new GameError("invalid_token", 401, "Invalid round token.");

  const game = await loadGame(db, caller, body.gameId);
  const [round] = await db.select().from(rounds).where(and(eq(rounds.id, body.roundId), eq(rounds.gameId, game.id)));
  if (!round) throw new GameError("not_found", 404, "Round not found.");
  const c = token.claims;
  if (c.roundId !== round.id || c.gameId !== game.id || c.jti !== round.tokenId || c.questionVersionId !== round.questionVersionId) {
    throw new GameError("invalid_token", 401, "This token belongs to a different round.");
  }

  const log = (outcome: string, accepted: boolean, resolvedPlayerId?: string) =>
    db.insert(submissions).values({
      roundId: round.id,
      questionVersionId: round.questionVersionId,
      participantId: caller.participantId,
      rawText: text,
      chosenPlayerId: body.chosenPlayerId ?? null,
      resolvedPlayerId: resolvedPlayerId ?? null,
      outcome,
      accepted,
      receivedAt: new Date(now),
    });

  // Already finished (double click, retry, second tab): report the result, change nothing.
  if (round.status === "answered" || round.status === "expired") {
    await log("closed", false);
    return finishedResponse(db, caller, game.id, round.id, now);
  }
  if (round.status !== "active") throw new GameError("round_not_started", 409, "This round hasn't started.");
  if (now < round.opensAt!.getTime()) {
    await log("not_open", false);
    throw new GameError("not_open", 409, "Answers open after the reading countdown.");
  }
  if (isPastDeadline(round, now)) {
    await log("expired", false);
    await db.transaction((tx) => expireRound(tx, round, now));
    return finishedResponse(db, caller, game.id, round.id, now);
  }

  const [versions, eligibility] = await Promise.all([
    getVersions(db, [round.questionVersionId]),
    getEligibility(db, round.questionVersionId),
  ]);
  const target: AnswerTarget = {
    criteria: versions.get(round.questionVersionId)!.criteria,
    isEligible: (id) => eligibility.has(id),
  };
  const validation = validateAnswer(text, target, getPlayerIndex(), body.chosenPlayerId);

  if (validation.status !== "valid" || !validation.playerId) {
    await log(validation.status, false);
    let attempts = round.attempts;
    if (COUNTED_REJECTIONS.has(validation.status)) {
      const [row] = await db
        .update(rounds)
        .set({ attempts: sql`${rounds.attempts} + 1` })
        .where(and(eq(rounds.id, round.id), eq(rounds.status, "active")))
        .returning({ attempts: rounds.attempts });
      attempts = row?.attempts ?? attempts;
    }
    return { outcome: { kind: "feedback", validation, attempts }, game: await getGameView(db, caller, game.id, now) };
  }

  const snapshot = await getSnapshot(db, round.snapshotId);
  const score = scoreFromSnapshot(snapshot.distribution, validation.playerId, true);
  const playerId = validation.playerId;

  const accepted = await db.transaction(async (tx) => {
    const changed = await tx
      .update(rounds)
      .set({
        status: "answered",
        acceptedPlayerId: playerId,
        acceptedText: validation.canonicalName ?? text,
        explanation: validation.message,
        tier: score.tier,
        points: score.points,
        rarity: score.estimatedRarity,
        scoreMethod: score.method,
        estimateNote: score.estimateNote,
        completedAt: new Date(now),
      })
      .where(and(eq(rounds.id, round.id), eq(rounds.status, "active")))
      .returning({ id: rounds.id });
    if (changed.length === 0) return false; // another request finished this round first
    await tx.insert(submissions).values({
      roundId: round.id,
      questionVersionId: round.questionVersionId,
      participantId: caller.participantId,
      rawText: text,
      chosenPlayerId: body.chosenPlayerId ?? null,
      resolvedPlayerId: playerId,
      outcome: "valid",
      accepted: true,
      receivedAt: new Date(now),
    });
    await recordObservation(tx, caller, round, playerId, now);
    await recomputeGame(tx, game.id, now);
    return true;
  });
  if (!accepted) await log("closed", false, playerId);
  return finishedResponse(db, caller, game.id, round.id, now);
}

/**
 * Adds the answer to the community distribution if this participant hasn't
 * answered this question version before (unique index), and the IP hash is under
 * its daily cap. Wrong guesses never reach this function.
 */
async function recordObservation(tx: Executor, caller: Caller, round: RoundRow, playerId: string, now: number) {
  if (caller.ipHash) {
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(rarityObservations)
      .where(
        and(
          eq(rarityObservations.ipHash, caller.ipHash),
          eq(rarityObservations.questionVersionId, round.questionVersionId),
          gte(rarityObservations.observedAt, new Date(now - 24 * 60 * 60 * 1000)),
        ),
      );
    if (Number(n) >= MAX_OBSERVATIONS_PER_IP_PER_QUESTION_PER_DAY) return;
  }
  await tx
    .insert(rarityObservations)
    .values({
      questionVersionId: round.questionVersionId,
      playerId,
      participantId: caller.participantId,
      roundId: round.id,
      ipHash: caller.ipHash,
      observedAt: new Date(now),
    })
    .onConflictDoNothing();
}

async function finishedResponse(db: Db, caller: Caller, gameId: string, roundId: string, now: number): Promise<SubmitResponse> {
  const game = await getGameView(db, caller, gameId, now);
  const [row] = await db.select().from(rounds).where(eq(rounds.id, roundId));
  const versions = await getVersions(db, [row.questionVersionId]);
  return { outcome: { kind: "round-complete", round: toResultView(row, versions.get(row.questionVersionId)!.prompt) }, game };
}
