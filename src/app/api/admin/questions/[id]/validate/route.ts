import { adminHandle } from "@/server/admin-http";
import { validateDraft } from "@/server/admin-questions";

/** POST /api/admin/questions/:id/validate: Validate the saved content against the dataset and store the report. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return adminHandle(request, ({ db, index, now }) => validateDraft(db, id, index, now));
}
