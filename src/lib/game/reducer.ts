import { QUESTIONS, ROUND_COUNT, ROUND_SECONDS } from "@/data/questions";
import type { ScoreResult } from "@/types/baseball";
import type { AnswerResponse, GameState } from "@/types/game";

export const initialGameState: GameState = {
  status: "landing",
  roundIndex: 0,
  deadline: null,
  rounds: [],
  pending: false,
  feedback: null,
};

/**
 * Every action that targets a round carries its roundIndex, so a stale timer
 * tick or a late network response for an earlier round is ignored.
 */
export type GameAction =
  | { type: "START"; now: number }
  | { type: "SUBMIT_STARTED"; roundIndex: number }
  | { type: "SUBMIT_RESOLVED"; roundIndex: number; submittedText: string; response: AnswerResponse; now: number }
  | { type: "SUBMIT_FAILED"; roundIndex: number; message: string }
  | { type: "TIMER_EXPIRED"; roundIndex: number }
  | { type: "NEXT_ROUND"; now: number }
  | { type: "RESTART" }
  | { type: "HYDRATE"; state: GameState; now: number };

/** Score for a round where time ran out before a locked-in answer. */
export const TIMED_OUT_SCORE: ScoreResult = {
  valid: false,
  points: 0,
  rarityScore: 0,
  method: "none",
  label: "Time expired",
};

/** Grace period for a submission that was sent before the deadline but answered after it. */
export const SUBMIT_GRACE_MS = 3000;

export function totalScore(state: Pick<GameState, "rounds">): number {
  return state.rounds.reduce((sum, round) => sum + round.score.points, 0);
}

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case "START":
      return startRound({ ...initialGameState }, 0, action.now);

    case "RESTART":
      return initialGameState;

    case "SUBMIT_STARTED":
      if (!isActiveRound(state, action.roundIndex) || state.pending) return state;
      return { ...state, pending: true, feedback: null };

    case "SUBMIT_FAILED":
      if (!isActiveRound(state, action.roundIndex)) return state;
      return {
        ...state,
        pending: false,
        feedback: { status: "not-found", valid: false, reason: action.message },
      };

    case "SUBMIT_RESOLVED": {
      if (!isActiveRound(state, action.roundIndex) || !state.pending) return state;
      // The request was sent before the deadline (otherwise SUBMIT_STARTED would
      // have been rejected), but don't accept arbitrarily late responses.
      if (state.deadline !== null && action.now > state.deadline + SUBMIT_GRACE_MS) {
        return expireRound({ ...state, pending: false });
      }
      const { validation, score } = action.response;
      if (!score) {
        // Not found or ambiguous: the round stays open so the user can retry —
        // unless the clock ran out while we were waiting.
        if (state.deadline !== null && action.now >= state.deadline) return expireRound({ ...state, pending: false });
        return { ...state, pending: false, feedback: validation };
      }
      return {
        ...state,
        status: "round-result",
        deadline: null,
        pending: false,
        feedback: null,
        rounds: [
          ...state.rounds,
          {
            questionId: QUESTIONS[state.roundIndex].id,
            submittedText: validation.canonicalName ?? action.submittedText,
            validation,
            score,
            timedOut: false,
          },
        ],
      };
    }

    case "TIMER_EXPIRED":
      if (!isActiveRound(state, action.roundIndex)) return state;
      // A submission already in flight was sent in time; let it resolve.
      if (state.pending) return state;
      return expireRound(state);

    case "NEXT_ROUND": {
      if (state.status !== "round-result") return state;
      const next = state.roundIndex + 1;
      if (next >= ROUND_COUNT) return { ...state, status: "game-complete" };
      return startRound(state, next, action.now);
    }

    case "HYDRATE":
      return hydrate(action.state, action.now);
  }
}

function isActiveRound(state: GameState, roundIndex: number): boolean {
  return state.status === "playing" && state.roundIndex === roundIndex;
}

function startRound(state: GameState, roundIndex: number, now: number): GameState {
  return {
    ...state,
    status: "playing",
    roundIndex,
    deadline: now + ROUND_SECONDS * 1000,
    pending: false,
    feedback: null,
  };
}

function expireRound(state: GameState): GameState {
  return {
    ...state,
    status: "round-result",
    deadline: null,
    pending: false,
    feedback: null,
    rounds: [
      ...state.rounds,
      {
        questionId: QUESTIONS[state.roundIndex].id,
        submittedText: null,
        validation: null,
        score: TIMED_OUT_SCORE,
        timedOut: true,
      },
    ],
  };
}

/**
 * Restores a saved game, defensively. Anything inconsistent → fresh landing
 * screen. A round whose deadline passed while the page was closed expires.
 */
function hydrate(saved: GameState, now: number): GameState {
  if (!isPlausibleState(saved)) return initialGameState;
  const restored: GameState = { ...saved, pending: false, feedback: null };
  if (restored.status === "playing" && restored.deadline !== null && now >= restored.deadline) {
    return expireRound(restored);
  }
  return restored;
}

function isPlausibleState(s: GameState): boolean {
  if (!s || typeof s !== "object" || !Array.isArray(s.rounds)) return false;
  if (!Number.isInteger(s.roundIndex) || s.roundIndex < 0 || s.roundIndex >= ROUND_COUNT) return false;
  if (s.rounds.some((r, i) => r?.questionId !== QUESTIONS[i]?.id || typeof r.score?.points !== "number")) return false;
  switch (s.status) {
    case "landing":
      return s.rounds.length === 0;
    case "playing":
      return s.rounds.length === s.roundIndex && typeof s.deadline === "number";
    case "round-result":
      return s.rounds.length === s.roundIndex + 1;
    case "game-complete":
      return s.rounds.length === ROUND_COUNT;
    default:
      return false;
  }
}
