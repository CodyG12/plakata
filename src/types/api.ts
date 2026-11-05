import type { GameMode } from "@/lib/game/config";
import type { ScoreResult, ValidationResult } from "./baseball";

/** A finished round, as the server reports it. */
export interface RoundResultView {
  position: number;
  prompt: string;
  status: "answered" | "expired";
  /** The accepted player's name; null for a Strikeout. */
  acceptedName: string | null;
  /** Why the answer fits (from the dataset); null for a Strikeout. */
  explanation: string | null;
  score: ScoreResult;
  timedOut: boolean;
  attempts: number;
}

/** The round being played. Times are epoch ms on the server clock. */
export interface ActiveRoundView {
  roundId: string;
  position: number;
  prompt: string;
  startedAt: number;
  opensAt: number;
  expiresAt: number;
  /** Signed round token: send it back with every submission. */
  token: string;
  attempts: number;
}

export interface GameView {
  gameId: string;
  mode: GameMode;
  /** UTC date ("2026-11-04") for daily games. */
  dailyDay: string | null;
  status: "active" | "complete";
  totalScore: number;
  roundCount: number;
  /** Completed rounds in order. */
  rounds: RoundResultView[];
  /** The round in progress, if one has been started and not finished. */
  activeRound: ActiveRoundView | null;
  /** Server time when this view was built, so the client can correct its clock. */
  serverNow: number;
}

export type SubmitOutcome =
  | { kind: "feedback"; validation: ValidationResult; attempts: number }
  | { kind: "round-complete"; round: RoundResultView };

export interface SubmitResponse {
  outcome: SubmitOutcome;
  game: GameView;
}

export interface ApiError {
  error: string;
  code: string;
}
