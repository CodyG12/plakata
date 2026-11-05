import { adminHandle } from "@/server/admin-http";
import { setPublished } from "@/server/admin-questions";

/** POST /api/admin/questions/:id/disable: Take the live version out of rotation for new games. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return adminHandle(request, ({ db, index, now }) => setPublished(db, id, false, index, now));
}
