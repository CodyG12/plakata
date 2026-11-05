import { adminHandle, readBody } from "@/server/admin-http";
import { createDraft, listQuestions } from "@/server/admin-questions";

/** GET /api/admin/questions: custom drafts plus the (read-only) bank questions. */
export async function GET(request: Request) {
  return adminHandle(request, ({ db, index }) => listQuestions(db, index));
}

/** POST /api/admin/questions {prompt, criteria, plakataPick, topFiveOverride}: new draft. */
export async function POST(request: Request) {
  return adminHandle(request, async ({ db, index, now }) => createDraft(db, await readBody(request), index, now));
}
