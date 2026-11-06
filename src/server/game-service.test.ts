/**
 * Integration tests: the full server-authoritative lifecycle against a real
 * PostgreSQL engine (in-memory PGlite) with the real migrations and dataset.
 * Time is passed in explicitly, so deadlines are tested exactly.
 */
import { randomUUID } from "node:crypto";
import { count, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPlayerIndex } from "@/lib/baseball/dataset";
import { LATENCY_GRACE_MS, READ_SECONDS, ROUND_COUNT, ROUND_SECONDS } from "@/lib/game/config";
import { categoryOf } from "@/lib/questions/selection";
import { curatedTiersFor } from "@/lib/rarity/rarity";
import type { GameView } from "@/types/api";
import type { Db } from "./db/client";
import { games, rarityObservations, rounds, statRankings, submissions } from "./db/schema";
import {
  completeRound,
  createGame,
  GameError,
  getOrCreateDaily,
  getGameView,
  insertGame,
  startNextRound,
  submitAnswer,
  type Caller,
} from "./game-service";
import { activeSnapshotIds, getEligibility, getSnapshot, getVersions, listActiveVersions, refreshSnapshots } from "./question-store";
import { createTestDb, ORIGINAL_SLUGS, testBank } from "./test-support";
import { signRoundToken, verifyRoundToken } from "./tokens";

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
}, 120_000);
afterAll(() => close?.());

const T0 = Date.UTC(2026, 10, 4, 12, 0, 0);
const OPEN = READ_SECONDS * 1000;
const DEADLINE = OPEN + ROUND_SECONDS * 1000;
const newCaller = (ipHash: string | null = null): Caller => ({ participantId: randomUUID(), ipHash });

/** A random-mode game with a fixed lineup (hr-300, mvp, yankees, hits-2000, cy-young, mariners, hall-of-fame), round 1 started. */
async function fixedGame(caller: Caller, now = T0) {
  const active = await listActiveVersions(db);
  const versionIds = ORIGINAL_SLUGS.map((slug) => active.find((v) => v.slug === slug)!.id);
  const snaps = await activeSnapshotIds(db, versionIds);
  const game = await insertGame(db, caller, "random", null, versionIds, versionIds.map((id) => snaps.get(id)!), now);
  return startNextRound(db, caller, game.gameId, now);
}

function submit(caller: Caller, view: GameView, input: string, now: number, extra: { token?: string; roundId?: string; playerId?: string } = {}) {
  const round = view.activeRound!;
  return submitAnswer(
    db,
    caller,
    {
      gameId: view.gameId,
      roundId: extra.roundId ?? round.roundId,
      token: extra.token ?? round.token,
      input,
      chosenPlayerId: extra.playerId,
    },
    now,
  );
}

async function expectGameError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toSatisfy((e: unknown) => e instanceof GameError && e.code === code);
}

describe("starting a game", () => {
  it("creates seven server-selected rounds, none started", async () => {
    const caller = newCaller();
    const game = await createGame(db, caller, "random", T0);
    expect(game).toMatchObject({ status: "active", totalScore: 0, roundCount: ROUND_COUNT, rounds: [], activeRound: null });
    const rows = await db.select().from(rounds).where(eq(rounds.gameId, game.gameId));
    expect(rows).toHaveLength(7);
    expect(rows.every((r) => r.status === "pending" && r.snapshotId > 0)).toBe(true);
  });

  it("random mode picks seven distinct questions from seven different categories", async () => {
    const caller = newCaller();
    const game = await createGame(db, caller, "random", T0);
    const rows = await db.select().from(rounds).where(eq(rounds.gameId, game.gameId));
    const versions = await getVersions(db, rows.map((r) => r.questionVersionId));
    expect(new Set(rows.map((r) => r.questionVersionId)).size).toBe(7);
    expect(new Set([...versions.values()].map((v) => v.category)).size).toBe(7);
  });

  it("starts round one with a 3s read period and a 30s server clock, and a valid signed token", async () => {
    const view = await fixedGame(newCaller());
    const r = view.activeRound!;
    expect(r).toMatchObject({ position: 0, startedAt: T0, opensAt: T0 + OPEN, expiresAt: T0 + DEADLINE });
    expect(r.prompt).toBe(testBank()[0].prompt);
    const check = await verifyRoundToken(r.token, T0 + 1000);
    expect(check.ok && check.claims).toMatchObject({ gameId: view.gameId, roundId: r.roundId, position: 0, expiresAt: T0 + DEADLINE });
  });

  it("refreshing or re-starting doesn't reset the timer or skip ahead", async () => {
    const caller = newCaller();
    const view = await fixedGame(caller);
    const again = await startNextRound(db, caller, view.gameId, T0 + 20_000);
    const refreshed = await getGameView(db, caller, view.gameId, T0 + 25_000);
    for (const v of [again, refreshed]) {
      expect(v.activeRound).toMatchObject({ roundId: view.activeRound!.roundId, position: 0, expiresAt: T0 + DEADLINE });
    }
  });

  it("restarting creates a clean new game", async () => {
    const caller = newCaller();
    const first = await fixedGame(caller);
    await submit(caller, first, "Babe Ruth", T0 + OPEN + 1000);
    const second = await fixedGame(caller, T0 + 60_000);
    expect(second.gameId).not.toBe(first.gameId);
    expect(second).toMatchObject({ totalScore: 0, rounds: [] });
  });
});

describe("answering", () => {
  it("rejects answers during the read period", async () => {
    const caller = newCaller();
    const view = await fixedGame(caller);
    await expectGameError(submit(caller, view, "Babe Ruth", T0 + 1000), "not_open");
    const logged = await db.select().from(submissions).where(eq(submissions.roundId, view.activeRound!.roundId));
    expect(logged.map((s) => s.outcome)).toEqual(["not_open"]);
  });

  it("wrong, ambiguous and unknown guesses keep the round open and count as attempts", async () => {
    const caller = newCaller();
    const view = await fixedGame(caller);
    const t = T0 + OPEN + 1000;
    const wrong = await submit(caller, view, "Ichiro Suzuki", t); // 117 career HR
    expect(wrong.outcome).toMatchObject({ kind: "feedback", attempts: 1, validation: { status: "ineligible" } });
    const unknown = await submit(caller, view, "Zzzyx Qwertyuiop", t + 1000);
    expect(unknown.outcome).toMatchObject({ kind: "feedback", attempts: 2, validation: { status: "unrecognized" } });
    expect(unknown.game.activeRound?.roundId).toBe(view.activeRound!.roundId);
    expect(unknown.game.totalScore).toBe(0);
    // Feedback never names candidate players.
    expect(JSON.stringify(wrong.outcome)).not.toMatch(/Ruth|Aaron|Bonds/);
  });

  it("a valid answer ends the round and the server awards the tier's fixed points", async () => {
    const caller = newCaller();
    const view = await fixedGame(caller);
    const res = await submit(caller, view, "Babe Ruth", T0 + OPEN + 2000);
    expect(res.outcome.kind).toBe("round-complete");
    expect(res.game.activeRound).toBeNull();
    expect(res.game.rounds[0]).toMatchObject({ acceptedName: "Babe Ruth", status: "answered", score: { tier: "bunt", points: 10, valid: true } });
    expect(res.game.rounds[0].explanation).toContain("714");
    expect(res.game.totalScore).toBe(10);
  });

  it("the hand-picked answer scores a Plákata", async () => {
    const caller = newCaller();
    const view = await fixedGame(caller);
    const res = await submit(caller, view, "Richie Sexson", T0 + OPEN + 2000);
    expect(res.game.rounds[0].score).toMatchObject({ tier: "plakata", points: 100, method: "plakata" });
  });

  it("two simultaneous correct answers award points once", async () => {
    const caller = newCaller();
    const view = await fixedGame(caller);
    const t = T0 + OPEN + 2000;
    const results = await Promise.all([
      submit(caller, view, "Richie Sexson", t),
      submit(caller, view, "Babe Ruth", t),
      submit(caller, view, "Babe Ruth", t),
    ]);
    const final = await getGameView(db, caller, view.gameId, t + 10);
    expect(final.rounds).toHaveLength(1);
    expect([10, 100]).toContain(final.totalScore);
    for (const r of results) expect(r.outcome.kind).toBe("round-complete");
    const [{ n }] = await db
      .select({ n: count() })
      .from(submissions)
      .where(eq(submissions.roundId, view.activeRound!.roundId));
    const accepted = await db.select().from(submissions).where(eq(submissions.roundId, view.activeRound!.roundId));
    expect(Number(n)).toBe(3);
    expect(accepted.filter((s) => s.accepted)).toHaveLength(1);
  });

  it("replaying a token after the round ended changes nothing", async () => {
    const caller = newCaller();
    const view = await fixedGame(caller);
    await submit(caller, view, "Babe Ruth", T0 + OPEN + 2000);
    const replay = await submit(caller, view, "Richie Sexson", T0 + OPEN + 3000);
    expect(replay.outcome.kind === "round-complete" && replay.outcome.round.score.points).toBe(10);
    expect(replay.game.totalScore).toBe(10);
  });
});

describe("the server clock", () => {
  it("accepts an answer received within the latency grace", async () => {
    const caller = newCaller();
    const view = await fixedGame(caller);
    const res = await submit(caller, view, "Babe Ruth", T0 + DEADLINE + LATENCY_GRACE_MS);
    expect(res.game.rounds[0].status).toBe("answered");
  });

  it("rejects a late answer and settles the round as a Strikeout", async () => {
    const caller = newCaller();
    const view = await fixedGame(caller);
    const res = await submit(caller, view, "Richie Sexson", T0 + DEADLINE + LATENCY_GRACE_MS + 1);
    expect(res.game.rounds[0]).toMatchObject({ status: "expired", timedOut: true, score: { tier: "strikeout", points: 0 } });
    expect(res.game.totalScore).toBe(0);
  });

  it("an expired token is still tied to its round (late = Strikeout, never points)", async () => {
    const caller = newCaller();
    const view = await fixedGame(caller);
    const res = await submit(caller, view, "Richie Sexson", T0 + DEADLINE + 60_000);
    expect(res.game.rounds[0].score.points).toBe(0);
  });

  it("completing a round before time is up is refused; after, it's a Strikeout", async () => {
    const caller = newCaller();
    const view = await fixedGame(caller);
    const roundId = view.activeRound!.roundId;
    await expectGameError(completeRound(db, caller, view.gameId, roundId, T0 + DEADLINE), "round_in_progress");
    const done = await completeRound(db, caller, view.gameId, roundId, T0 + DEADLINE + LATENCY_GRACE_MS + 1);
    expect(done.rounds[0]).toMatchObject({ status: "expired", score: { points: 0 } });
  });

  it("a round that ran out while the page was closed is settled on the next read", async () => {
    const caller = newCaller();
    const view = await fixedGame(caller);
    const later = await getGameView(db, caller, view.gameId, T0 + 10 * 60_000);
    expect(later.activeRound).toBeNull();
    expect(later.rounds[0].timedOut).toBe(true);
  });
});

describe("tokens and ownership", () => {
  it("rejects a forged or tampered token", async () => {
    const caller = newCaller();
    const view = await fixedGame(caller);
    const t = view.activeRound!.token;
    const tampered = t.slice(0, -4) + (t.endsWith("AAAA") ? "BBBB" : "AAAA");
    await expectGameError(submit(caller, view, "Babe Ruth", T0 + OPEN + 1000, { token: tampered }), "invalid_token");
    await expectGameError(submit(caller, view, "Babe Ruth", T0 + OPEN + 1000, { token: "not.a.jwt" }), "invalid_token");
  });

  it("rejects a genuine token used for a different round or question", async () => {
    const caller = newCaller();
    const view = await fixedGame(caller);
    const r = view.activeRound!;
    const rows = await db.select().from(rounds).where(eq(rounds.gameId, view.gameId));
    const other = rows.find((x) => x.position === 1)!;
    await expectGameError(submit(caller, view, "Mike Trout", T0 + OPEN + 1000, { roundId: other.id }), "invalid_token");
    const forgedQuestion = await signRoundToken(
      { gameId: view.gameId, roundId: r.roundId, questionVersionId: other.questionVersionId, position: 0, startedAt: r.startedAt, expiresAt: r.expiresAt, jti: randomUUID() },
      LATENCY_GRACE_MS,
    );
    await expectGameError(submit(caller, view, "Babe Ruth", T0 + OPEN + 1000, { token: forgedQuestion }), "invalid_token");
  });

  it("another participant can't see or play someone else's game", async () => {
    const owner = newCaller();
    const view = await fixedGame(owner);
    const intruder = newCaller();
    await expectGameError(getGameView(db, intruder, view.gameId, T0), "not_found");
    await expectGameError(submit(intruder, view, "Babe Ruth", T0 + OPEN + 1000), "not_found");
  });
});

describe("a full seven-round game", () => {
  it("plays out in order; the server computes the total and closes the game", async () => {
    const caller = newCaller();
    let view = await fixedGame(caller);
    const answers = ["Babe Ruth", null, "Hensley Meulens", "Pete Rose", null, "Ken Griffey", "Frank Grant"];
    let t = T0;
    for (let i = 0; i < ROUND_COUNT; i++) {
      expect(view.activeRound?.position).toBe(i);
      const answer = answers[i];
      if (answer) {
        const res = await submit(caller, view, answer, t + OPEN + 1000);
        expect(res.game.rounds[i].status, answer).toBe("answered");
        view = res.game;
      } else {
        view = await completeRound(db, caller, view.gameId, view.activeRound!.roundId, t + DEADLINE + LATENCY_GRACE_MS + 1);
      }
      t += 60_000;
      if (i < ROUND_COUNT - 1) view = await startNextRound(db, caller, view.gameId, t);
    }
    expect(view.status).toBe("complete");
    expect(view.rounds).toHaveLength(7);
    expect(view.totalScore).toBe(view.rounds.reduce((s, r) => s + r.score.points, 0));
    expect(view.rounds[2].score.points).toBe(100); // Meulens: the Yankees pick
    const [row] = await db.select().from(games).where(eq(games.id, view.gameId));
    expect(row.completedAt).not.toBeNull();
    await expectGameError(startNextRound(db, caller, view.gameId, t), "game_complete");
  });
});

describe("community observations", () => {
  const observationsFor = async (participantId: string) =>
    db.select().from(rarityObservations).where(eq(rarityObservations.participantId, participantId));

  it("only the accepted answer counts; wrong guesses add nothing", async () => {
    const caller = newCaller();
    const view = await fixedGame(caller);
    await submit(caller, view, "Ichiro Suzuki", T0 + OPEN + 500);
    await submit(caller, view, "Babe Ruth", T0 + OPEN + 1000);
    const obs = await observationsFor(caller.participantId);
    expect(obs.map((o) => o.playerId)).toEqual(["ruthba01"]);
  });

  it("one observation per participant per question, however many games they play", async () => {
    const caller = newCaller();
    for (let g = 0; g < 3; g++) {
      const view = await fixedGame(caller, T0 + g * 3_600_000);
      await submit(caller, view, g === 0 ? "Babe Ruth" : "Hank Aaron", T0 + g * 3_600_000 + OPEN + 1000);
    }
    const obs = await observationsFor(caller.participantId);
    expect(obs.map((o) => o.playerId)).toEqual(["ruthba01"]); // the first answer only
  });

  it("caps observations from one IP per question per day", async () => {
    const ip = `ip-${randomUUID()}`;
    for (let i = 0; i < 7; i++) {
      const caller = newCaller(ip);
      const view = await fixedGame(caller, T0 + i * 1000);
      await submit(caller, view, "Babe Ruth", T0 + i * 1000 + OPEN + 1000);
    }
    const [{ n }] = await db.select({ n: count() }).from(rarityObservations).where(eq(rarityObservations.ipHash, ip));
    expect(Number(n)).toBe(5);
  });
});

describe("frozen scoring snapshots", () => {
  it("a refresh changes scores for new games only; old games and the daily keep theirs", async () => {
    const index = getPlayerIndex();
    const hr = (await listActiveVersions(db)).find((v) => v.slug === "hr-300")!;
    const eligible = await getEligibility(db, hr.id);
    const curated = curatedTiersFor("hr-300");
    // An uncurated, uniquely named 300-HR hitter (chosen from the data, not hard-coded).
    const target = [...eligible]
      .map((id) => index.getById(id)!)
      .find((p) => !curated[p.id] && p.id !== "sexsori01" && index.byCanonicalName(p.name.toLowerCase()).size <= 1 &&
        index.all().filter((q) => q.name === p.name).length === 1)!;

    const dailyBefore = await createGame(db, newCaller(), "daily", T0);
    const oldCaller = newCaller();
    const oldGame = await fixedGame(oldCaller, T0);

    // Real plays: more fans name this uncurated answer than every earlier hr-300 answer combined.
    const [{ n: earlier }] = await db
      .select({ n: count() })
      .from(rarityObservations)
      .where(eq(rarityObservations.questionVersionId, hr.id));
    for (let i = 0; i < Number(earlier) + 3; i++) {
      const c = newCaller();
      const v = await fixedGame(c, T0 + i);
      const res = await submit(c, v, target.name, T0 + i + OPEN + 1000);
      expect(res.game.rounds[0].score.tier).toBe("triple"); // before refresh: uncurated → Triple
    }
    await refreshSnapshots(db, { alpha: 1, bank: testBank(), now: new Date(T0 + 5000) });

    const newCaller2 = newCaller();
    const fresh = await fixedGame(newCaller2, T0 + 10_000);
    const freshScore = (await submit(newCaller2, fresh, target.name, T0 + 10_000 + OPEN + 1000)).game.rounds[0].score;
    const oldScore = (await submit(oldCaller, oldGame, target.name, T0 + OPEN + 2000)).game.rounds[0].score;
    expect(oldScore.tier).toBe("triple"); // frozen snapshot from before the refresh
    expect(freshScore.points).toBeLessThan(oldScore.points); // now a common answer

    const dailyAfter = await createGame(db, newCaller(), "daily", T0 + 20_000);
    const snaps = async (gameId: string) =>
      (await db.select().from(rounds).where(eq(rounds.gameId, gameId))).sort((a, b) => a.position - b.position).map((r) => [r.questionVersionId, r.snapshotId]);
    expect(await snaps(dailyAfter.gameId)).toEqual(await snaps(dailyBefore.gameId));
  });

  it("daily games give everyone the same seven questions in the same order", async () => {
    const a = await createGame(db, newCaller(), "daily", Date.UTC(2026, 10, 9, 1));
    const b = await createGame(db, newCaller(), "daily", Date.UTC(2026, 10, 9, 23));
    const order = async (gameId: string) =>
      (await db.select().from(rounds).where(eq(rounds.gameId, gameId))).sort((x, y) => x.position - y.position).map((r) => r.questionVersionId);
    const qa = await order(a.gameId);
    expect(qa).toEqual(await order(b.gameId));
    expect(new Set(qa).size).toBe(7);
    const versions = await getVersions(db, qa);
    expect(new Set(qa.map((id) => categoryOf(versions.get(id)!.criteria.type))).size).toBe(7);
  });

  it("the next day's Daily only repeats a question when its whole category ran the day before", async () => {
    const yesterday = await getOrCreateDaily(db, "2026-12-01");
    const today = await getOrCreateDaily(db, "2026-12-02");
    const active = await listActiveVersions(db);
    const slugOf = new Map(active.map((v) => [v.id, v.slug]));
    const ranYesterday = new Set(yesterday.questionVersionIds.map((id) => slugOf.get(id)));
    const repeats = active.filter((v) => today.questionVersionIds.includes(v.id) && ranYesterday.has(v.slug));
    for (const r of repeats) {
      const sameCategory = active.filter((v) => v.category === r.category);
      expect(sameCategory.every((v) => ranYesterday.has(v.slug)), `${r.slug} repeated with a fresh alternative`).toBe(true);
    }
    // The test bank has spare questions in team, stats and honors, so some must rotate.
    expect(repeats.length).toBeLessThan(ROUND_COUNT);
  });
});

describe("Top-5 Bunt rule in a real game", () => {
  it("a top-five leader scores a Bunt with the override recorded, and still counts as an observation", async () => {
    const caller = newCaller();
    const view = await fixedGame(caller); // round 1: 300 career HR
    const res = await submit(caller, view, "Barry Bonds", T0 + OPEN + 1000);
    expect(res.game.rounds[0].score).toMatchObject({
      tier: "bunt",
      points: 10,
      method: "top_five",
      overrideApplied: true,
      overrideReason: "top_five_statistical",
    });
    const [row] = await db.select().from(rounds).where(eq(rounds.id, view.activeRound!.roundId));
    expect(row).toMatchObject({ tier: "bunt", points: 10, overrideApplied: true, overrideReason: "top_five_statistical" });
    const obs = await db.select().from(rarityObservations).where(eq(rarityObservations.roundId, row.id));
    expect(obs.map((o) => o.playerId)).toEqual(["bondsba01"]);
  });

  it("rankings are stored per version with the data release, and the snapshot freezes the Bunt list", async () => {
    const versions = await listActiveVersions(db);
    const hr = versions.find((v) => v.slug === "hr-300")!;
    expect(hr.topFiveOverride).toBe(true);
    const top = await db.select().from(statRankings).where(eq(statRankings.questionVersionId, hr.id));
    const bunts = top.filter((r) => r.buntOverride).sort((a, b) => a.rank - b.rank);
    expect(bunts.map((r) => [r.playerId, r.value, r.rank])).toEqual([
      ["bondsba01", 762, 1],
      ["aaronha01", 755, 2],
      ["ruthba01", 714, 3],
      ["pujolal01", 703, 4],
      ["rodrial01", 696, 5],
    ]);
    expect(new Set(top.map((r) => r.dataRelease)).size).toBe(1);
    const snaps = await activeSnapshotIds(db, [hr.id]);
    expect((await getSnapshot(db, snaps.get(hr.id)!)).distribution.buntOverride).toEqual(
      ["aaronha01", "bondsba01", "pujolal01", "rodrial01", "ruthba01"],
    );
  });

  it("non-statistical questions have no rankings and no override", async () => {
    const versions = await listActiveVersions(db);
    for (const slug of ["yankees", "mariners", "hall-of-fame", "born-japan"]) {
      const v = versions.find((x) => x.slug === slug)!;
      expect(v.topFiveOverride, slug).toBe(false);
      expect(await db.select().from(statRankings).where(eq(statRankings.questionVersionId, v.id)), slug).toHaveLength(0);
    }
    const caller = newCaller();
    let view = await fixedGame(caller, T0 + 7 * 3_600_000);
    view = (await submit(caller, view, "Richie Sexson", T0 + 7 * 3_600_000 + OPEN + 1000)).game;
    view = await startNextRound(db, caller, view.gameId, T0 + 7 * 3_600_000 + 60_000);
    view = (await submit(caller, view, "Barry Bonds", T0 + 7 * 3_600_000 + 60_000 + OPEN + 1000)).game; // MVP: no override
    expect(view.rounds[1].score.overrideApplied).toBe(false);
  });

  it("a refresh keeps the version's frozen leaders", async () => {
    const hr = (await listActiveVersions(db)).find((v) => v.slug === "hr-300")!;
    await refreshSnapshots(db, { bank: testBank(), now: new Date(T0 + 9_000_000) });
    const snaps = await activeSnapshotIds(db, [hr.id]);
    const dist = (await getSnapshot(db, snaps.get(hr.id)!)).distribution;
    expect(dist.buntOverride).toHaveLength(5);
    expect(dist.totalObservations).toBeGreaterThan(0);
  });
});
