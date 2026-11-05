import type { ValidationResult } from "@/types/baseball";
import type { GameView } from "@/types/api";

/**
 * Client view state. The server owns the game (questions, timing, scoring, total);
 * this reducer only tracks what the screen shows between server responses. Every
 * fact displayed comes from the latest GameView.
 */
export type Screen = "landing" | "playing" | "round-result" | "game-complete";

export interface ClientState {
  screen: Screen;
  game: GameView | null;
  /** Server clock minus local clock (ms), from the latest response. Used only to display the countdown. */
  clockOffset: number;
  /** A game request (create, start, recover) is in flight. */
  busy: boolean;
  /** An answer request is in flight (blocks double submits). */
  pending: boolean;
  /** Feedback on the latest guess in the current round (rejection, suggestion, or namesake choice). */
  feedback: ValidationResult | null;
  /** Wrong guesses in the current round, as counted by the server. */
  attempts: number;
  /** Bumped whenever the answer field should reset (cleared, or pre-filled with a suggestion). */
  inputVersion: number;
  /** The local countdown reached zero; waiting for the server to settle the round. */
  timeUp: boolean;
  /** Connection or server problem, shown inline. Not counted as a guess. */
  error: string | null;
}

export const initialClientState: ClientState = {
  screen: "landing",
  game: null,
  clockOffset: 0,
  busy: false,
  pending: false,
  feedback: null,
  attempts: 0,
  inputVersion: 0,
  timeUp: false,
  error: null,
};

export type ClientAction =
  | { type: "REQUEST_STARTED" }
  | { type: "GAME_LOADED"; game: GameView; receivedAt: number; resume?: boolean }
  | { type: "SUBMIT_STARTED" }
  | { type: "SUBMIT_FEEDBACK"; validation: ValidationResult; attempts: number; game: GameView; receivedAt: number }
  | { type: "REQUEST_FAILED"; message: string }
  | { type: "TIME_UP"; roundId: string }
  | { type: "SHOW_FINAL" }
  | { type: "RESTART" };

export function clientReducer(state: ClientState, action: ClientAction): ClientState {
  switch (action.type) {
    case "REQUEST_STARTED":
      return { ...state, busy: true, error: null };

    case "GAME_LOADED":
      return applyGame({ ...state, busy: false, pending: false }, action.game, action.receivedAt, action.resume ?? false);

    case "SUBMIT_STARTED":
      if (state.screen !== "playing" || state.pending || state.timeUp) return state;
      return { ...state, pending: true, feedback: null, error: null };

    case "SUBMIT_FEEDBACK": {
      const next = applyGame({ ...state, pending: false }, action.game, action.receivedAt, false);
      // The round may have closed meanwhile (time ran out); then there's nothing to show.
      if (next.screen !== "playing") return next;
      const { validation } = action;
      return {
        ...next,
        feedback: validation,
        attempts: action.attempts,
        // A choice of namesakes keeps the typed text; anything else resets the field
        // (cleared after a miss, pre-filled after a "Did you mean …?").
        inputVersion: validation.status === "choose" ? next.inputVersion : next.inputVersion + 1,
      };
    }

    case "REQUEST_FAILED":
      return { ...state, busy: false, pending: false, error: action.message };

    case "TIME_UP":
      if (state.screen !== "playing" || state.game?.activeRound?.roundId !== action.roundId) return state;
      return { ...state, timeUp: true, feedback: null };

    case "SHOW_FINAL":
      if (state.game?.status !== "complete") return state;
      return { ...state, screen: "game-complete" };

    case "RESTART":
      return initialClientState;
  }
}

/**
 * Moves the screen to wherever the server says the game is:
 *  - a round is running → "playing" (round UI resets if it's a new round)
 *  - otherwise, rounds finished → the latest result, or the final box score when resuming a finished game
 */
function applyGame(state: ClientState, game: GameView, receivedAt: number, resume: boolean): ClientState {
  const base = { ...state, game, clockOffset: game.serverNow - receivedAt };
  const active = game.activeRound;
  if (active) {
    const sameRound = state.screen === "playing" && state.game?.activeRound?.roundId === active.roundId;
    return sameRound
      ? { ...base, screen: "playing" }
      : { ...base, screen: "playing", feedback: null, attempts: active.attempts, inputVersion: 0, timeUp: false, error: null };
  }
  if (game.rounds.length === 0) return { ...base, screen: "landing" };
  if (resume && game.status === "complete") return { ...base, screen: "game-complete", timeUp: false };
  return { ...base, screen: "round-result", feedback: null, timeUp: false };
}
