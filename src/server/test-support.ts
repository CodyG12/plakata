/**
 * Test-only helpers: a fresh in-memory PostgreSQL (PGlite) with the real
 * migrations, players and a small question bank. Not imported by app code.
 */
import { QUESTION_BANK, type QuestionDefinition } from "@/data/question-bank";
import { getPlayerIndex } from "@/lib/baseball/dataset";
import { openPglite, type Db } from "./db/client";
import { clearQuestionCaches, importPlayers, syncQuestionBank } from "./question-store";

/** The original seven (v1) questions, in their v1 order: the fixed lineup integration tests play. */
export const ORIGINAL_SLUGS = ["hr-300", "mvp", "yankees", "hits-2000", "cy-young", "mariners", "hall-of-fame"];

/** The original seven plus one small question from each other category (keeps setup fast). */
export const TEST_SLUGS = [
  ...ORIGINAL_SLUGS,
  "hr-500",
  "team-expos",
  "pos-catcher-100",
  "season-1975",
  "all-star-1998",
  "ws-2004-red-sox",
  "born-japan",
];

export function testBank(): QuestionDefinition[] {
  return QUESTION_BANK.filter((q) => TEST_SLUGS.includes(q.slug));
}

export async function createTestDb(): Promise<{ db: Db; close(): Promise<void> }> {
  clearQuestionCaches();
  const handle = await openPglite(undefined);
  await handle.ready;
  const index = getPlayerIndex();
  await importPlayers(handle.db, index);
  await syncQuestionBank(handle.db, index, testBank(), new Date("2026-01-01T00:00:00Z"));
  return { db: handle.db, close: handle.close };
}
