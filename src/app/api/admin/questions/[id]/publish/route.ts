import { adminHandle } from "@/server/admin-http";
import { publishDraft } from "@/server/admin-questions";

/** POST /api/admin/questions/:id/publish: Re-validate on the server and publish as a new, immutable question version. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return adminHandle(request, ({ db, index, now }) => publishDraft(db, id, index, now));
}
