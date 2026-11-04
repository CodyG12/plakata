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
  /** Completed rounds, in order. rounds.length === roundIndex while playing. */
  rounds: RoundRecord[];
  /** True while an answer request is in flight (prevents double submits). */
  pending: boolean;
  /** Feedback on the latest rejected or ambiguous guess in the current round. */
  feedback: ValidationResult | null;
  /** Incorrect guesses so far in the current round (wrong player or unknown name). */
  attempts: number;
  /** Connection/server problem from the last submission, if any (not counted as a guess). */
  error: string | null;
}
