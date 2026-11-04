import type { ScoringResult } from "@/lib/baseball/scoring";

/** One MLB (or SABR-recognized major league) player, derived from the Lahman database. */
export interface BaseballPlayer {
  /** Lahman playerID — stable and unique, e.g. "griffke02". */
  id: string;
  /** Display name as recorded by Lahman ("nameFirst nameLast"). */
  name: string;
  /** Surname as recorded by Lahman (may be several words, e.g. "De La Rosa"). */
  lastName: string;
  /** First and last seasons with a recorded appearance. */
  firstYear: number;
  lastYear: number;
  /** Career games (sum of Appearances.G_all). */
  games: number;
  /** Lahman teamIDs the player appeared for (e.g. "NYA" = Yankees, "SEA" = Mariners). */
  teams: string[];
  /** Career home runs; null if no batting record exists (never coerced to 0). */
  hr: number | null;
  /** Career hits; null if no batting record exists (never coerced to 0). */
  hits: number | null;
  /** Seasons in which the player won the MVP (as Lahman records it). */
  mvp: number[];
  /** Seasons in which the player won the Cy Young Award. */
  cyYoung: number[];
  /** Hall of Fame induction year (category "Player" only), or null. */
  hof: number | null;
}

export interface PlayersDataset {
  meta: {
    source: string;
    sourceUrl: string;
    release: string;
    license: string;
    playerCount: number;
  };
  /** teamID -> most recent team name (e.g. "NYA" -> "New York Yankees"). */
  teams: Record<string, string>;
  players: BaseballPlayer[];
}

/** Configurable rule that decides whether a player answers a question. */
export type QuestionCriteria =
  | { type: "careerHomeRuns"; min: number }
  | { type: "careerHits"; min: number }
  | { type: "award"; award: "mvp" | "cyYoung" }
  | { type: "playedFor"; teamIds: string[]; teamName: string }
  | { type: "hallOfFame" };

export type ValidationStatus = "valid" | "ineligible" | "ambiguous" | "unrecognized" | "suggestion" | "choose";

/** One of several same-named players offered for the user to choose between. */
export interface PlayerOption {
  playerId: string;
  name: string;
  /** e.g. "1988–2009 · Seattle Mariners, Arizona Diamondbacks +4 more" */
  detail: string;
}

/** How the typed text was matched to a player. */
export type MatchType = "exact" | "alias" | "partial" | "fuzzy";

/**
 * Result of checking an answer. Only a "valid" result carries player details.
 * A "suggestion" carries only a corrected spelling ("Did you mean …?"),
 * offered before eligibility is checked so it never hints at whether that
 * player qualifies. Rejected guesses carry a generic message only.
 */
export interface ValidationResult {
  status: ValidationStatus;
  playerId?: string;
  canonicalName?: string;
  matchType?: MatchType;
  /** For "suggestion": correctly spelled text to submit instead. */
  suggestion?: string;
  /** For "choose": the namesakes who all fit the question, for the user to pick from. */
  options?: PlayerOption[];
  /** Text safe to show the player. For "valid" it explains why the answer fits. */
  message: string;
}

export type ScoreMethod = "curated" | "fallback" | "none";

/**
 * A round's score: its baseball tier and fixed points (see
 * src/lib/baseball/scoring.ts), plus where the rarity estimate came from.
 */
export interface ScoreResult extends ScoringResult {
  valid: boolean;
  method: ScoreMethod;
  /** Short note explaining the rarity estimate, e.g. "Famous answer"; null for a Strikeout. */
  estimateNote: string | null;
}
