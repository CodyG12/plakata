/** One MLB (or SABR-recognized major league) player, derived from the Lahman database. */
export interface BaseballPlayer {
  /** Lahman playerID — stable and unique, e.g. "griffke02". */
  id: string;
  /** Display name as recorded by Lahman ("nameFirst nameLast"). */
  name: string;
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

/** Compact, display-ready player info (used for autocomplete & disambiguation). */
export interface PlayerSummary {
  id: string;
  name: string;
  /** e.g. "1989–2010 · Mariners, Reds, White Sox" */
  detail: string;
}

export type ValidationStatus = "valid" | "invalid" | "not-found" | "ambiguous";

export interface ValidationResult {
  status: ValidationStatus;
  valid: boolean;
  playerId?: string;
  canonicalName?: string;
  /** Human-readable explanation, safe to show to the player. */
  reason: string;
  /** Present only when status === "ambiguous". */
  candidates?: PlayerSummary[];
}

export type ScoreMethod = "curated" | "fallback" | "none";

export interface ScoreResult {
  valid: boolean;
  /** Points awarded this round (0–100). Equal to rarityScore for valid answers. */
  points: number;
  /** Estimated rarity, 0–100. 0 for invalid or unanswered rounds. */
  rarityScore: number;
  method: ScoreMethod;
  /** Short label explaining the estimate, e.g. "Famous answer". */
  label: string;
}
