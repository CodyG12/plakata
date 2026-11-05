import { adminHandle, readBody } from "@/server/admin-http";
import { testAnswer } from "@/server/admin-questions";

/** POST /api/admin/questions/:id/test-answer {input}: how the game would judge and score a name. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return adminHandle(request, async ({ db, index }) => {
    const body = (await readBody(request)) as { input?: unknown };
    return testAnswer(db, id, typeof body?.input === "string" ? body.input : "", index);
  });
}
