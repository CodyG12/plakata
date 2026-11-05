/**
 * Question Builder: service lifecycle against a real PostgreSQL engine (in-memory
 * PGlite), plus the admin API's access control through the actual route handlers.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as getQuestionsRoute, POST as createQuestionRoute } from "@/app/api/admin/questions/route";
import { GET as eligibleRoute } from "@/app/api/admin/questions/[id]/eligible/route";
import { POST as publishRoute } from "@/app/api/admin/questions/[id]/publish/route";
import { POST as testAnswerRoute } from "@/app/api/admin/questions/[id]/test-answer/route";
import { POST as loginRoute } from "@/app/api/admin/session/route";
import { checkCriteria } from "@/lib/baseball/criteria";
import { getPlayerIndex } from "@/lib/baseball/dataset";
import { seededRng, selectBalanced } from "@/lib/questions/selection";
import { UNSUPPORTED_MESSAGE } from "@/lib/questions/validate-question";
import { ADMIN_COOKIE } from "./admin-auth";
import {
  createDraft,
  eligiblePreview,
  getDraft,
  listQuestions,
  publishDraft,
  setPublished,
  testAnswer,
  updateDraft,
  validateDraft,
} from "./admin-questions";
import { setDbForTesting, type Db } from "./db/client";
import { questions, rounds } from "./db/schema";
import { createGame, getOrCreateDaily, type Caller } from "./game-service";
import { listActiveVersions, syncQuestionBank } from "./question-store";
import { createTestDb, testBank } from "./test-support";

const index = getPlayerIndex();
const TEST_PASSWORD = `test-admin-${randomUUID()}`; // a generated test value, never a real password
let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  setDbForTesting({ db, ready: Promise.resolve(), close });
  process.env.ADMIN_PASSWORD = TEST_PASSWORD;
}, 120_000);
afterAll(async () => {
  setDbForTesting(undefined);
  delete process.env.ADMIN_PASSWORD;
  await close?.();
});

const now = () => new Date();
const RBI = { type: "stat_threshold", stat: "runsBattedIn", scope: "career", operator: ">=", value: 1500 } as const;
const rbiDraft = (pick: string | null = null, value = 1500) => ({
  prompt: `Name an MLB player with at least ${value.toLocaleString("en-US")} career RBIs.`,
  criteria: { ...RBI, value },
  plakataPick: pick,
  topFiveOverride: true,
});

/**
 * Creates a draft, validates once to get the suggested pick, then sets it and
 * re-validates. Each published question needs its own text and pick (both are
 * single-use), so tests that publish pass their own threshold.
 */
async function readyRbiDraft(value = 1500) {
  const draft = await createDraft(db, rbiDraft(null, value), index, now());
  const first = await validateDraft(db, draft.id, index, now());
  const pick = first.validation!.suggestedPick!.playerId;
  await updateDraft(db, draft.id, rbiDraft(pick, value), index, now());
  return validateDraft(db, draft.id, index, now());
}

describe("drafts and validation", () => {
  it("creates a draft that isn't playable", async () => {
    const draft = await createDraft(db, rbiDraft(), index, now());
    expect(draft).toMatchObject({ status: "draft", live: null, category: "stats" });
    expect(draft.slug).toMatch(/^custom-/);
    expect((await listActiveVersions(db)).some((v) => v.slug === draft.slug)).toBe(false);
  });

  it("validates against the dataset: exact count, Top-5 leaders, a pick suggestion", async () => {
    const v = await readyRbiDraft();
    const expected = index.all().filter((p) => checkCriteria(p, RBI, index).met);
    expect(v.status).toBe("validated");
    expect(v.validation).toMatchObject({ status: "ready", eligibleCount: expected.length, errors: [] });
    const byRbi = [...expected].sort((a, b) => b.career.runsBattedIn! - a.career.runsBattedIn!);
    expect(v.validation!.topFive.leaders.map((l) => l.playerId).sort()).toEqual(byRbi.slice(0, 5).map((p) => p.id).sort());
    expect(v.validation!.coverage.join(" ")).toMatch(/no recorded rbis/i);
    expect(v.validationCurrent).toBe(true);
  });

  it("blocks a missing pick, and a pick that is a top-five leader or another question's pick", async () => {
    const d = await createDraft(db, rbiDraft(), index, now());
    expect((await validateDraft(db, d.id, index, now())).validation!.errors.join(" ")).toMatch(/Plákata pick/);
    await updateDraft(db, d.id, rbiDraft("aaronha01"), index, now());
    expect((await validateDraft(db, d.id, index, now())).validation!.errors.join(" ")).toMatch(/top-five leader/);
    const hr = { prompt: "Name an MLB player with at least 400 career home runs.", criteria: { ...RBI, stat: "homeRuns", value: 400 }, plakataPick: "sexsori01", topFiveOverride: true };
    const taken = await createDraft(db, hr, index, now());
    const report = (await validateDraft(db, taken.id, index, now())).validation!;
    // Sexson (306 HR) doesn't reach 400, so he fails eligibility; use a 300+ question to hit the single-use rule.
    expect(report.errors.join(" ")).toMatch(/doesn't satisfy/);
    const same = await createDraft(db, { ...hr, prompt: "Name a player with 300+ career home runs.", criteria: { ...hr.criteria, value: 300 } }, index, now());
    expect((await validateDraft(db, same.id, index, now())).validation!.errors.join(" ")).toMatch(/already the Plákata pick/);
  });

  it("refuses unsupported criteria with a clear message", async () => {
    const d = await createDraft(db, { prompt: "Name a player with a .400 batting average.", criteria: { type: "batting_average", min: 0.4 }, plakataPick: null, topFiveOverride: false }, index, now());
    const v = await validateDraft(db, d.id, index, now());
    expect(v.validation!.errors).toContain(UNSUPPORTED_MESSAGE);
    await expect(publishDraft(db, d.id, index, now())).rejects.toMatchObject({ code: "not_validated" });
  });

  it("catches criteria the dataset can't answer, not just empty queries", async () => {
    const cases: [unknown, RegExp][] = [
      [{ type: "all_star", minimumSelections: 1, year: 1920 }, /No All-Star selections are recorded for 1920/],
      [{ type: "world_series_champion", minimumTitles: 1, year: 1994 }, /No modern World Series champion is recorded for 1994/],
      [{ type: "season", from: 2031, to: 2031 }, /outside the dataset/],
      [{ type: "birthplace", country: "Atlantis" }, /No player in the dataset was born in "Atlantis"/],
      [{ type: "franchise", franchiseId: "ZZZ" }, /Unknown franchise id/],
    ];
    for (const [criteria, error] of cases) {
      const d = await createDraft(db, { prompt: "Name a player who fits this rule for a test.", criteria, plakataPick: null, topFiveOverride: false }, index, now());
      const v = await validateDraft(db, d.id, index, now());
      expect(v.validation!.errors.join(" "), JSON.stringify(criteria)).toMatch(error);
      expect(v.status).toBe("draft");
    }
  });

  it("refuses the Top-5 rule on a non-statistical question", async () => {
    const d = await createDraft(db, { prompt: "Name an MLB player born in Japan, again.", criteria: { type: "birthplace", country: "Japan" }, plakataPick: null, topFiveOverride: true }, index, now());
    const v = await validateDraft(db, d.id, index, now());
    expect(v.validation!.errors.join(" ")).toMatch(/only applies to statistical questions/);
    expect(v.validation!.topFive.supported).toBe(false);
  });

  it("warns when the prompt doesn't mention the rule's number", async () => {
    const d = await createDraft(db, { ...rbiDraft(), prompt: "Name a great run producer with lots of RBIs." }, index, now());
    expect((await validateDraft(db, d.id, index, now())).validation!.warnings.join(" ")).toMatch(/doesn't mention 1,500/);
  });
});

describe("answer preview and testing (same engines as the game)", () => {
  it("lists verified answers with evidence, rank, and expected tier, paginated and searchable", async () => {
    const d = await readyRbiDraft();
    const page = await eligiblePreview(db, d.id, { page: 1, pageSize: 5 }, index);
    expect(page.total).toBe(d.validation!.eligibleCount);
    expect(page.rows).toHaveLength(5);
    expect(page.rows[0]).toMatchObject({ rank: 1, topFive: true, expectedTier: "Bunt" });
    expect(page.rows[0].stat!.value).toBeGreaterThan(page.rows[4].stat!.value!);
    const search = await eligiblePreview(db, d.id, { q: "ruth" }, index);
    expect(search.rows.map((r) => r.name)).toContain("Babe Ruth");
    const pick = await eligiblePreview(db, d.id, { q: d.plakataPick! }, index);
    expect(pick.rows[0]).toMatchObject({ plakataPick: true, expectedTier: "Plákata" });
  });

  it("tests typed names: leader → Bunt override, non-qualifier with evidence, ambiguous, unknown", async () => {
    const d = await readyRbiDraft();
    const aaron = await testAnswer(db, d.id, "Hank Aaron", index);
    expect(aaron.players[0]).toMatchObject({ qualifies: true, topFive: true, expected: { tier: "bunt", overrideApplied: true } });
    const ichiro = await testAnswer(db, d.id, "Ichiro Suzuki", index);
    expect(ichiro.players[0].qualifies).toBe(false);
    expect(ichiro.players[0].evidence).toMatch(/drove in/);
    expect((await testAnswer(db, d.id, "Griffey", index)).resolution).toBe("ambiguous");
    expect((await testAnswer(db, d.id, "Zzzyx Qwertyuiop", index)).resolution).toBe("unrecognized");
    expect((await testAnswer(db, d.id, "Derek Jeeter", index)).resolution).toBe("suggestion");
  });
});

describe("publishing", () => {
  const caller = (): Caller => ({ participantId: randomUUID(), ipHash: null });

  it("publishes into the active bank (random games can pick it) and keeps today's daily unchanged", async () => {
    const day = new Date().toISOString().slice(0, 10);
    const dailyBefore = await getOrCreateDaily(db, day);
    const d = await readyRbiDraft();
    const published = await publishDraft(db, d.id, index, now());
    expect(published).toMatchObject({ status: "published", live: { version: 1, active: true } });
    const active = await listActiveVersions(db);
    const v = active.find((x) => x.slug === d.slug)!;
    expect(v).toMatchObject({ topFiveOverride: true, eligibleCount: d.validation!.eligibleCount });
    const [{ source }] = await db.select({ source: questions.source }).from(questions).where(eq(questions.slug, d.slug));
    expect(source).toBe("custom");
    expect(Array.from({ length: 50 }, (_, i) => selectBalanced(active, 7, seededRng(`r${i}`))).flat().some((q) => q.slug === d.slug)).toBe(true);
    expect(await getOrCreateDaily(db, day)).toEqual(dailyBefore);
    await expect(publishDraft(db, d.id, index, now())).rejects.toMatchObject({ code: "already_published" });
  });

  it("won't publish content that changed after validation", async () => {
    const d = await readyRbiDraft(1400);
    await updateDraft(db, d.id, { ...rbiDraft(d.plakataPick, 1400), prompt: "Name an MLB player with 1,500 or more career RBIs." }, index, now());
    await expect(publishDraft(db, d.id, index, now())).rejects.toMatchObject({ code: "not_validated" });
  });

  it("disabled questions leave rotation; edits publish a new version and old games keep theirs", async () => {
    const d = await readyRbiDraft(1300);
    await publishDraft(db, d.id, index, now());
    const v1 = (await listActiveVersions(db)).find((x) => x.slug === d.slug)!;
    // A game created now freezes v1 for its rounds (random lineup includes v1 if selected).
    const game = await createGame(db, caller(), "random", Date.now(), () => 0);
    const gameVersions = (await db.select().from(rounds).where(eq(rounds.gameId, game.gameId))).map((r) => r.questionVersionId);

    const disabled = await setPublished(db, d.id, false, index, now());
    expect(disabled.status).toBe("disabled");
    expect((await listActiveVersions(db)).some((x) => x.slug === d.slug)).toBe(false);
    expect((await setPublished(db, d.id, true, index, now())).status).toBe("published");

    await updateDraft(db, d.id, rbiDraft(d.plakataPick, 1250), index, now());
    const revalidated = await validateDraft(db, d.id, index, now());
    expect(revalidated.status).toBe("validated");
    const v2 = await publishDraft(db, d.id, index, now());
    expect(v2.live).toMatchObject({ version: 2, active: true });
    const active = (await listActiveVersions(db)).filter((x) => x.slug === d.slug);
    expect(active).toHaveLength(1);
    expect(active[0].id).not.toBe(v1.id);
    // The earlier game's rounds still point at the versions they were created with.
    expect((await db.select().from(rounds).where(eq(rounds.gameId, game.gameId))).map((r) => r.questionVersionId)).toEqual(gameVersions);
  });

  it("the bank sync never disables custom questions", async () => {
    const d = await readyRbiDraft(1200);
    await publishDraft(db, d.id, index, now());
    await syncQuestionBank(db, index, testBank(), now());
    expect((await listActiveVersions(db)).some((x) => x.slug === d.slug)).toBe(true);
    const list = await listQuestions(db, index);
    expect(list.bank.every((b) => !b.slug.startsWith("custom-"))).toBe(true);
    expect((await getDraft(db, d.id, index)).status).toBe("published");
  });
});

describe("admin API access control (route handlers)", () => {
  const base = "http://localhost/api/admin";
  const json = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const params = (id: string) => ({ params: Promise.resolve({ id }) });

  async function signIn(): Promise<string> {
    const res = await loginRoute(new Request(`${base}/session`, json({ password: TEST_PASSWORD })));
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    return cookie.split(";")[0];
  }

  it("rejects every admin endpoint without a valid session", async () => {
    const d = await createDraft(db, rbiDraft(), index, now());
    expect((await getQuestionsRoute(new Request(`${base}/questions`))).status).toBe(401);
    expect((await createQuestionRoute(new Request(`${base}/questions`, json(rbiDraft())))).status).toBe(401);
    expect((await eligibleRoute(new Request(`${base}/questions/${d.id}/eligible`), params(d.id))).status).toBe(401);
    expect((await testAnswerRoute(new Request(`${base}/questions/${d.id}/test-answer`, json({ input: "Hank Aaron" })), params(d.id))).status).toBe(401);
    expect((await publishRoute(new Request(`${base}/questions/${d.id}/publish`, json({})), params(d.id))).status).toBe(401);
    const forged = { headers: { cookie: `${ADMIN_COOKIE}=${Date.now() + 1e6}.forged` } };
    expect((await getQuestionsRoute(new Request(`${base}/questions`, forged))).status).toBe(401);
  });

  it("rejects a wrong password, and works with the right one", async () => {
    expect((await loginRoute(new Request(`${base}/session`, json({ password: "not-the-password" })))).status).toBe(401);
    const cookie = await signIn();
    const res = await getQuestionsRoute(new Request(`${base}/questions`, { headers: { cookie } }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect((await res.json()).bank.length).toBeGreaterThan(0);
  });

  it("requires JSON on writes (CSRF defence)", async () => {
    const cookie = await signIn();
    const res = await createQuestionRoute(new Request(`${base}/questions`, { method: "POST", headers: { cookie, "content-type": "application/x-www-form-urlencoded" }, body: "prompt=x" }));
    expect(res.status).toBe(415);
  });

  it("is switched off entirely without ADMIN_PASSWORD", async () => {
    const cookie = await signIn();
    delete process.env.ADMIN_PASSWORD;
    try {
      expect((await getQuestionsRoute(new Request(`${base}/questions`, { headers: { cookie } }))).status).toBe(503);
      expect((await loginRoute(new Request(`${base}/session`, json({ password: TEST_PASSWORD })))).status).toBe(503);
    } finally {
      process.env.ADMIN_PASSWORD = TEST_PASSWORD;
    }
  });

  it("changing the password logs existing sessions out", async () => {
    const cookie = await signIn();
    process.env.ADMIN_PASSWORD = `${TEST_PASSWORD}-rotated`;
    try {
      expect((await getQuestionsRoute(new Request(`${base}/questions`, { headers: { cookie } }))).status).toBe(401);
    } finally {
      process.env.ADMIN_PASSWORD = TEST_PASSWORD;
    }
  });
});
