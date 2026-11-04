import type { ScoreResult, ValidationResult } from "./baseball";

export type GameStatus = "landing" | "playing" | "round-result" | "game-complete";

/** The locked-in outcome of one round. */
export interface RoundRecord {
  questionId: string;
  /** The accepted player's name; null if the timer expired without a valid answer. */
  submittedText: string | null;
  validation: ValidationResult | null;
  score: ScoreResult;
  timedOut: boolean;
  /** Incorrect guesses made in this round before it ended. */
  attempts: number;
}

/** Server response for an answer submission. */
export interface AnswerResponse {
  validation: ValidationResult;
  /** Present only when the answer resolved to a single player (valid or invalid). */
  score?: ScoreResult;
}

export interface GameState {
  status: GameStatus;
  /** Index into QUESTIONS of the current (or just-finished) round. */
  roundIndex: number;
  /** Epoch ms when the current round's timer ends. Null outside "playing". */
  deadline: number | null;
  /**
   * Epoch ms when answering opens, after the read period. The 30-second clock
   * runs from here to `deadline`. Null outside "playing" (and in older saves).
   */
  answerOpensAt: number | null;
  /** Completed rounds, in order. rounds.length === roundIndex while playing. */
  rounds: RoundRecord[];
  /** True while an answer request is in flight (prevents double submits). */
  pending: boolean;
  /** Feedback on the latest guess in the current round (rejection, suggestion, or namesake choice). */
  feedback: ValidationResult | null;
  /** Rejected guesses so far in the current round (ineligible, ambiguous, or unrecognized). */
  attempts: number;
  /**
   * Bumped whenever the answer field should reset — after a rejected guess
   * (cleared) or a spelling suggestion (pre-filled with the corrected name).
   */
  inputVersion: number;
  /** Connection/server problem from the last submission, if any (not counted as a guess). */
  error: string | null;
}
