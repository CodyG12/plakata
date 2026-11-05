import { getGameView } from "@/server/game-service";
import { handle } from "@/server/http";

/** GET /api/games/:gameId: the current state (used to recover after a refresh). */
export async function GET(request: Request, ctx: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await ctx.params;
  return handle(request, ({ db, caller, now }) => getGameView(db, caller, gameId, now));
}
