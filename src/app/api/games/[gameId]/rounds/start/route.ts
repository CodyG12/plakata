import { startNextRound } from "@/server/game-service";
import { handle } from "@/server/http";

/** POST /api/games/:gameId/rounds/start: starts the next round (idempotent while one is running). */
export async function POST(request: Request, ctx: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await ctx.params;
  return handle(request, ({ db, caller, now }) => startNextRound(db, caller, gameId, now));
}
