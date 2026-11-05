import { adminHandle, readBody } from "@/server/admin-http";
import { getDraft, updateDraft } from "@/server/admin-questions";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return adminHandle(request, ({ db, index }) => getDraft(db, id, index));
}

/** PUT /api/admin/questions/:id: save edits (a published question keeps its live version). */
export async function PUT(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return adminHandle(request, async ({ db, index, now }) => updateDraft(db, id, await readBody(request), index, now));
}
