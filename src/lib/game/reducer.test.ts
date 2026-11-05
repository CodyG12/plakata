import { describe, expect, it } from "vitest";
import { noAnswerScore } from "@/lib/baseball/scoring";
import type { ActiveRoundView, GameView, RoundResultView } from "@/types/api";
import { clientReducer, initialClientState, type ClientState } from "./reducer";

const round = (position: number, id = `r${position}`): ActiveRoundView => ({
  roundId: id,
  position,
  prompt: `Prompt ${position}`,
  startedAt: 1_000,
  opensAt: 4_000,
  expiresAt: 34_000,
  token: "t",
  attempts: 0,
});
const finished = (position: number): RoundResultView => ({
  position,
  prompt: `Prompt ${position}`,
  status: "expired",
  acceptedName: null,
  explanation: null,
  score: noAnswerScore(),
  timedOut: true,
  attempts: 0,
});
const view = (over: Partial<GameView> = {}): GameView => ({
  gameId: "g",
  mode: "daily",
  dailyDay: "2026-11-04",
  status: "active",
  totalScore: 0,
  roundCount: 7,
  rounds: [],
  activeRound: round(0),
  serverNow: 10_000,
  ...over,
});
const load = (state: ClientState, game: GameView, receivedAt = 9_000, resume = false) =>
  clientReducer(state, { type: "GAME_LOADED", game, receivedAt, resume });

describe("client view reducer", () => {
  it("shows the server's running round and measures the clock offset", () => {
    const s = load(initialClientState, view());
    expect(s.screen).toBe("playing");
    expect(s.clockOffset).toBe(1_000); // server is 1s ahead of this device
    expect(s.game?.activeRound?.prompt).toBe("Prompt 0");
  });

  it("blocks a second submission while one is in flight", () => {
    const s = clientReducer(load(initialClientState, view()), { type: "SUBMIT_STARTED" });
    expect(s.pending).toBe(true);
    expect(clientReducer(s, { type: "SUBMIT_STARTED" })).toBe(s);
  });

  it("keeps the round going after a rejected guess and shows the server's attempt count", () => {
    let s = clientReducer(load(initialClientState, view()), { type: "SUBMIT_STARTED" });
    s = clientReducer(s, {
      type: "SUBMIT_FEEDBACK",
      validation: { status: "ineligible", message: "Nope" },
      attempts: 1,
      game: view(),
      receivedAt: 9_000,
    });
    expect(s).toMatchObject({ screen: "playing", pending: false, attempts: 1, inputVersion: 1 });
    expect(s.feedback?.status).toBe("ineligible");
  });

  it("keeps the typed text when asked to choose between namesakes", () => {
    let s = clientReducer(load(initialClientState, view()), { type: "SUBMIT_STARTED" });
    s = clientReducer(s, {
      type: "SUBMIT_FEEDBACK",
      validation: { status: "choose", message: "Which one?", options: [] },
      attempts: 0,
      game: view(),
      receivedAt: 9_000,
    });
    expect(s.inputVersion).toBe(0);
  });

  it("moves to the round result when the server reports the round finished", () => {
    const s = load(load(initialClientState, view()), view({ activeRound: null, rounds: [finished(0)] }));
    expect(s.screen).toBe("round-result");
  });

  it("resets round UI when the server starts a new round", () => {
    let s = load(initialClientState, view());
    s = clientReducer(s, { type: "TIME_UP", roundId: "r0" });
    expect(s.timeUp).toBe(true);
    s = load(s, view({ rounds: [finished(0)], activeRound: round(1) }));
    expect(s).toMatchObject({ screen: "playing", timeUp: false, feedback: null, inputVersion: 0 });
  });

  it("ignores TIME_UP for a round that isn't on screen", () => {
    const s = load(initialClientState, view());
    expect(clientReducer(s, { type: "TIME_UP", roundId: "other" })).toBe(s);
  });

  it("no submissions after the local clock runs out (the server decides the rest)", () => {
    const s = clientReducer(load(initialClientState, view()), { type: "TIME_UP", roundId: "r0" });
    expect(clientReducer(s, { type: "SUBMIT_STARTED" })).toBe(s);
  });

  it("resuming a finished game opens the final box score", () => {
    const done = view({ status: "complete", activeRound: null, rounds: Array.from({ length: 7 }, (_, i) => finished(i)) });
    expect(load(initialClientState, done, 9_000, true).screen).toBe("game-complete");
    expect(load(initialClientState, done).screen).toBe("round-result");
  });

  it("only shows the final screen once the server says the game is over", () => {
    const s = load(initialClientState, view({ activeRound: null, rounds: [finished(0)] }));
    expect(clientReducer(s, { type: "SHOW_FINAL" })).toBe(s);
  });

  it("restart returns to a clean landing screen", () => {
    expect(clientReducer(load(initialClientState, view()), { type: "RESTART" })).toEqual(initialClientState);
  });
});
