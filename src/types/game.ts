import type { ScoreResult, ValidationResult } from "./baseball";

export type GameStatus = "landing" | "playing" | "round-result" | "game-complete";

/** The locked-in outcome of one round. */
export interface RoundRecord {
  questionId: string;
  /** What the user typed or picked; null if the timer expired with no answer. */
  submittedText: string | null;
  validation: ValidationResult | null;
  score: ScoreResult;
  timedOut: boolean;
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
  /** Non-final feedback for the current round (not found / ambiguous / network error). */
  feedback: ValidationResult | null;
}
