import { z } from "zod";
import { GAME_MODES } from "@/lib/game/config";
import { createGame } from "@/server/game-service";
import { handle, readJson } from "@/server/http";

const body = z.object({ mode: z.enum(GAME_MODES) }).strict();

/** POST /api/games {mode}: creates a game; the server picks the seven questions. */
export async function POST(request: Request) {
  return handle(request, async ({ db, caller, now }) => {
    const { mode } = await readJson(request, body);
    return createGame(db, caller, mode, now);
  });
}
