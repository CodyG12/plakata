import { completeRound } from "@/server/game-service";
import { handle } from "@/server/http";

/** POST /api/games/:gameId/rounds/:roundId/complete: settles a round whose time is up. */
export async function POST(request: Request, ctx: { params: Promise<{ gameId: string; roundId: string }> }) {
  const { gameId, roundId } = await ctx.params;
  return handle(request, ({ db, caller, now }) => completeRound(db, caller, gameId, roundId, now));
}
