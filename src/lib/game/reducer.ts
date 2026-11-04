import { QUESTIONS, READ_SECONDS, ROUND_COUNT, ROUND_SECONDS } from "@/data/questions";
import { noAnswerScore } from "@/lib/baseball/calculate-rarity";
import { isScoringTier } from "@/lib/baseball/scoring";
import type { ScoreResult } from "@/types/baseball";
import type { AnswerResponse, GameState } from "@/types/game";

export const initialGameState: GameState = {
  status: "landing",
  roundIndex: 0,
  deadline: null,
  answerOpensAt: null,
  rounds: [],
  pending: false,
  feedback: null,
  attempts: 0,
  inputVersion: 0,
  error: null,
};

/**
 * Every action that targets a round carries its roundIndex, so a stale timer
 * tick or a late network response for an earlier round is ignored.
 */
export type GameAction =
  | { type: "START"; now: number }
  | { type: "SUBMIT_STARTED"; roundIndex: number; now: number }
  | { type: "SUBMIT_RESOLVED"; roundIndex: number; submittedText: string; response: AnswerResponse; now: number }
  | { type: "SUBMIT_FAILED"; roundIndex: number; message: string }
  | { type: "TIMER_EXPIRED"; roundIndex: number }
  | { type: "NEXT_ROUND"; now: number }
  | { type: "RESTART" }
  | { type: "HYDRATE"; state: GameState; now: number };

/** Score for a round where time ran out before a valid answer: a Strikeout. */
export const TIMED_OUT_SCORE: ScoreResult = noAnswerScore();

/**
 * Grace period for a correct answer that was submitted before the deadline but
 * whose response arrived after it. Submissions made at or after the deadline
 * are always rejected (see SUBMIT_STARTED).
 */
export const SUBMIT_GRACE_MS = 3000;

export function totalScore(state: Pick<GameState, "rounds">): number {
  return state.rounds.reduce((sum, round) => sum + round.score.points, 0);
}

/**
 * Round rules: the player may guess as many times as they like until the
 * deadline. Only a valid answer ends the round early. Every rejected guess
 * (ineligible player, ambiguous name, unrecognized name) is counted as an
 * attempt and the round stays open with the timer untouched. A probable typo
 * gets a "Did you mean …?" suggestion, and several qualifying namesakes get a
 * "which one?" choice; neither is counted as an attempt.
 */
export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case "START":
      return startRound({ ...initialGameState }, 0, action.now);

    case "RESTART":
      return initialGameState;

    case "SUBMIT_STARTED":
      if (!isActiveRound(state, action.roundIndex) || state.pending) return state;
      if (state.deadline !== null && action.now >= state.deadline) return state; // too late
      if (state.answerOpensAt !== null && action.now < state.answerOpensAt) return state; // still reading
      return { ...state, pending: true, feedback: null, error: null };

    case "SUBMIT_FAILED":
      if (!isActiveRound(state, action.roundIndex)) return state;
      return { ...state, pending: false, error: action.message };

    case "SUBMIT_RESOLVED": {
      if (!isActiveRound(state, action.roundIndex) || !state.pending) return state;
      const pastDeadline = state.deadline !== null && action.now >= state.deadline;
      const { validation, score } = action.response;

      if (validation.status === "valid" && score?.valid) {
        // Sent before the deadline (SUBMIT_STARTED guarantees that); honor it
        // unless the response is unreasonably late.
        if (state.deadline !== null && action.now > state.deadline + SUBMIT_GRACE_MS) {
          return expireRound({ ...state, pending: false });
        }
        return {
          ...state,
          status: "round-result",
          deadline: null,
          answerOpensAt: null,
          pending: false,
          feedback: null,
          error: null,
          rounds: [
            ...state.rounds,
            {
              questionId: QUESTIONS[state.roundIndex].id,
              submittedText: validation.canonicalName ?? action.submittedText,
              validation,
              score,
              timedOut: false,
              attempts: state.attempts,
            },
          ],
        };
      }

      // Anything other than a valid answer can never earn points once time is up.
      if (pastDeadline) return expireRound({ ...state, pending: false });

      // "Which one did you mean?": not a wrong guess. Keep the typed text and
      // show the namesakes to pick from; the timer keeps running.
      if (validation.status === "choose") {
        return { ...state, pending: false, feedback: validation };
      }

      // "Did you mean …?": not a wrong guess. Pre-fill the corrected name for
      // the player to confirm; the timer keeps running.
      if (validation.status === "suggestion") {
        return { ...state, pending: false, feedback: validation, inputVersion: state.inputVersion + 1 };
      }

      // Rejected (ineligible, ambiguous, or unrecognized): count the guess,
      // keep the round going, leave the timer alone.
      return {
        ...state,
        pending: false,
        feedback: validation,
        attempts: state.attempts + 1,
        inputVersion: state.inputVersion + 1,
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

/** A round opens with READ_SECONDS to read the prompt, then ROUND_SECONDS to answer. */
function startRound(state: GameState, roundIndex: number, now: number): GameState {
  const answerOpensAt = now + READ_SECONDS * 1000;
  return {
    ...state,
    status: "playing",
    roundIndex,
    answerOpensAt,
    deadline: answerOpensAt + ROUND_SECONDS * 1000,
    pending: false,
    feedback: null,
    attempts: 0,
    inputVersion: 0,
    error: null,
  };
}

function expireRound(state: GameState): GameState {
  return {
    ...state,
    status: "round-result",
    deadline: null,
    answerOpensAt: null,
    pending: false,
    feedback: null,
    error: null,
    rounds: [
      ...state.rounds,
      {
        questionId: QUESTIONS[state.roundIndex].id,
        submittedText: null,
        validation: null,
        score: TIMED_OUT_SCORE,
        timedOut: true,
        attempts: state.attempts,
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
  const restored: GameState = {
    ...saved,
    pending: false,
    feedback: null,
    error: null,
    attempts: Number.isInteger(saved.attempts) ? saved.attempts : 0,
    inputVersion: Number.isInteger(saved.inputVersion) ? saved.inputVersion : 0,
    answerOpensAt: typeof saved.answerOpensAt === "number" ? saved.answerOpensAt : null,
  };
  if (restored.status === "playing" && restored.deadline !== null && now >= restored.deadline) {
    return expireRound(restored);
  }
  return restored;
}

function isPlausibleState(s: GameState): boolean {
  if (!s || typeof s !== "object" || !Array.isArray(s.rounds)) return false;
  if (!Number.isInteger(s.roundIndex) || s.roundIndex < 0 || s.roundIndex >= ROUND_COUNT) return false;
  if (
    s.rounds.some(
      (r, i) => r?.questionId !== QUESTIONS[i]?.id || typeof r.score?.points !== "number" || !isScoringTier(r.score.tier),
    )
  ) {
    return false;
  }
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
