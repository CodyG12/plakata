import type { GameMode } from "@/lib/game/config";
import type { ApiError, GameView, SubmitResponse } from "@/types/api";

/** A failed API call. `code` comes from the server, or "network" when it never answered. */
export class ApiClientError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init?.method ?? "GET",
      headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
    });
  } catch {
    throw new ApiClientError("network", 0, "Couldn't reach the game server. Check your connection.");
  }
  const data = (await res.json().catch(() => null)) as T | ApiError | null;
  if (!res.ok || data === null) {
    const err = data as ApiError | null;
    throw new ApiClientError(err?.code ?? "http", res.status, err?.error ?? `The game server returned ${res.status}.`);
  }
  return data as T;
}

export const api = {
  createGame: (mode: GameMode) => call<GameView>("/api/games", { method: "POST", body: { mode } }),
  getGame: (gameId: string) => call<GameView>(`/api/games/${gameId}`),
  startRound: (gameId: string) => call<GameView>(`/api/games/${gameId}/rounds/start`, { method: "POST" }),
  submit: (gameId: string, roundId: string, body: { token: string; input: string; playerId?: string }) =>
    call<SubmitResponse>(`/api/games/${gameId}/rounds/${roundId}/submit`, { method: "POST", body }),
  completeRound: (gameId: string, roundId: string) =>
    call<GameView>(`/api/games/${gameId}/rounds/${roundId}/complete`, { method: "POST" }),
};
