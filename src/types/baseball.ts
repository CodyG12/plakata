import { z } from "zod";
import type { ScoringResult } from "@/lib/baseball/scoring";

/** Counting stats imported from Lahman Batting.csv and Pitching.csv. */
export const STAT_KEYS = [
  "homeRuns",
  "hits",
  "runsBattedIn",
  "stolenBases",
  "wins",
  "pitcherStrikeouts",
  "saves",
] as const;
export type StatKey = (typeof STAT_KEYS)[number];

/** Positions as recorded in Lahman Appearances.csv (regular-season games at each position). */
export const POSITIONS = ["p", "c", "1b", "2b", "3b", "ss", "lf", "cf", "rf", "of", "dh"] as const;
export type Position = (typeof POSITIONS)[number];

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
  /** Seasons with a recorded appearance, as inclusive [first, last] runs. */
  seasons: [number, number][];
  /** Career games (sum of Appearances.G_all). */
  games: number;
  /** Lahman teamIDs the player appeared for (e.g. "NYA" = Yankees, "SEA" = Mariners). */
  teams: string[];
  /** Lahman franchIDs (franchise history), e.g. "WSN" covers the Montreal Expos and Washington Nationals. */
  franchises: string[];
  /** Regular-season games at each position; positions never played are absent. */
  positions: Partial<Record<Position, number>>;
  /** Career totals. A stat is absent when Lahman has no row for it (never coerced to 0). */
  career: Partial<Record<StatKey, number>>;
  /** Best single-season total (all stints in a season summed). Absent = no data. */
  bestSeason: Partial<Record<StatKey, number>>;
  /** Seasons in which the player won the MVP (as Lahman records it). */
  mvp: number[];
  /** Seasons in which the player won the Cy Young Award. */
  cyYoung: number[];
  /** Hall of Fame induction year (category "Player" only), or null. */
  hof: number | null;
  /** Seasons with an All-Star selection (on the roster, whether or not he played). */
  allStar: number[];
  /** Seasons he appeared in a World Series game (1903+) for the winning team. */
  wsTitles: number[];
  /** Lahman People.birthCountry ("USA", "D.R.", "Japan", …); null when unknown. */
  birthCountry: string | null;
  /** Lahman People.birthState (US state code, or province/region elsewhere); null when unknown. */
  birthState: string | null;
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
  /** franchID -> franchise name (e.g. "SEA" -> "Seattle Mariners"). */
  franchises: Record<string, string>;
  players: BaseballPlayer[];
}

// ---------------------------------------------------------------------------
// Question criteria: typed, validated, data-driven. Every question in the bank
// is one of these; eligibility is computed from the dataset, never hand-entered.
// ---------------------------------------------------------------------------

const year = z.number().int().min(1871).max(2100);

export const questionCriteriaSchema = z.discriminatedUnion("type", [
  /** Appeared for any team in a franchise's history (e.g. Expos + Nationals = "WSN"). */
  z.object({ type: z.literal("franchise"), franchiseId: z.string().min(2) }).strict(),
  /** Appeared for specific Lahman teamIDs (one team name / era, e.g. "MON" = Montreal Expos). */
  z.object({ type: z.literal("team"), teamIds: z.array(z.string().min(2)).min(1) }).strict(),
  /** At least `minimumGames` regular-season games at a position (Appearances). */
  z.object({ type: z.literal("position"), position: z.enum(POSITIONS), minimumGames: z.number().int().min(1) }).strict(),
  /** Appeared in at least one regular-season game in a season between `from` and `to`, inclusive. */
  z.object({ type: z.literal("season"), from: year, to: year }).strict(),
  /** First MLB season before `before` (exclusive) and/or from `from` (inclusive). */
  z.object({ type: z.literal("debut"), before: year.optional(), from: year.optional() }).strict(),
  /** Career total or best single season at or above `value`. */
  z
    .object({
      type: z.literal("stat_threshold"),
      stat: z.enum(STAT_KEYS),
      scope: z.enum(["career", "season"]),
      operator: z.literal(">="),
      value: z.number().int().min(1),
    })
    .strict(),
  z.object({ type: z.literal("award"), award: z.enum(["mvp", "cyYoung"]) }).strict(),
  z.object({ type: z.literal("hall_of_fame") }).strict(),
  /** Selected to `minimumSelections` All-Star teams (seasons), or to the team in `year`. */
  z.object({ type: z.literal("all_star"), minimumSelections: z.number().int().min(1), year: year.optional() }).strict(),
  /** Appeared in a World Series game for the winner: in `year`, or `minimumTitles` times. */
  z
    .object({ type: z.literal("world_series_champion"), minimumTitles: z.number().int().min(1), year: year.optional() })
    .strict(),
  /**
   * Born in `country` (optionally a `state` within it), or born anywhere with a known
   * birth country other than `excludeCountries`. Unknown birthplaces never qualify.
   */
  z
    .object({
      type: z.literal("birthplace"),
      country: z.string().min(1).optional(),
      state: z.string().min(1).optional(),
      excludeCountries: z.array(z.string().min(1)).min(1).optional(),
    })
    .strict()
    .refine((c) => (c.country !== undefined) !== (c.excludeCountries !== undefined), {
      message: "birthplace needs exactly one of country or excludeCountries",
    })
    .refine((c) => c.state === undefined || c.country !== undefined, { message: "state requires country" }),
]);

/** Configurable rule that decides whether a player answers a question. */
export type QuestionCriteria = z.infer<typeof questionCriteriaSchema>;
export type CriteriaType = QuestionCriteria["type"];

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

/**
 * Where a round's tier came from: "plakata" = the question's hand-picked Plákata,
 * "community" = a frozen rarity snapshot (curated prior + community answers), "none" = Strikeout.
 */
export type ScoreMethod = "plakata" | "community" | "none";

/** A round's score: its baseball tier and fixed points, plus where the rarity came from. */
export interface ScoreResult extends ScoringResult {
  valid: boolean;
  method: ScoreMethod;
  /** Short note explaining the rarity, e.g. "Rarer than 64% of answers"; null for a Strikeout. */
  estimateNote: string | null;
}
