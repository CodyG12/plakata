import { z } from "zod";
import { submitAnswer } from "@/server/game-service";
import { handle, readJson } from "@/server/http";

const body = z
  .object({
    token: z.string().min(1).max(2000),
    input: z.string().max(200),
    playerId: z.string().max(20).optional(),
  })
  .strict();

/** POST /api/games/:gameId/rounds/:roundId/submit {token, input, playerId?} */
export async function POST(request: Request, ctx: { params: Promise<{ gameId: string; roundId: string }> }) {
  const { gameId, roundId } = await ctx.params;
  return handle(request, async ({ db, caller, now }) => {
    const { token, input, playerId } = await readJson(request, body);
    return submitAnswer(db, caller, { gameId, roundId, token, input, chosenPlayerId: playerId }, now);
  });
}
