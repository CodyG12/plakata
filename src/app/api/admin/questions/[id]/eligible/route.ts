import { adminHandle } from "@/server/admin-http";
import { eligiblePreview } from "@/server/admin-questions";

/** GET /api/admin/questions/:id/eligible?q=&page=&pageSize=&sort=stat|name|games: verified answers (admin only). */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const url = new URL(request.url);
  const sort = url.searchParams.get("sort");
  return adminHandle(request, ({ db, index }) =>
    eligiblePreview(
      db,
      id,
      {
        q: url.searchParams.get("q")?.slice(0, 60) || undefined,
        page: Number(url.searchParams.get("page")) || 1,
        pageSize: Number(url.searchParams.get("pageSize")) || 25,
        sort: sort === "stat" || sort === "name" || sort === "games" ? sort : undefined,
      },
      index,
    ),
  );
}
