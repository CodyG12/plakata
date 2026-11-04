import type { BaseballPlayer, QuestionCriteria, ValidationResult } from "@/types/baseball";
import { checkCriteria } from "./criteria";
import type { PlayerIndex } from "./dataset";
import { normalizeName } from "./normalize-name";

export interface AnswerInput {
  /** Free text typed by the player. */
  input?: string;
  /** Exact player chosen from autocomplete or a disambiguation prompt. */
  playerId?: string;
}

const MAX_CANDIDATES = 8;

export type Resolution =
  | { kind: "found"; player: BaseballPlayer }
  | { kind: "ambiguous"; players: BaseballPlayer[] }
  | { kind: "not-found" };

/**
 * Resolves user input to exactly one player, or reports ambiguity. Never guesses:
 * 1. An explicit playerId wins.
 * 2. Otherwise full-name / alias matches (normalized).
 * 3. For single-word input, surname matches as well.
 * Multiple matches at any step → ambiguous (see resolveAmbiguous below).
 */
export function resolvePlayer(answer: AnswerInput, index: PlayerIndex): Resolution {
  if (answer.playerId) {
    const player = index.getById(answer.playerId);
    return player ? { kind: "found", player } : { kind: "not-found" };
  }
  const text = normalizeName(answer.input ?? "");
  if (!text) return { kind: "not-found" };

  let matches = index.findByName(text);
  if (!text.includes(" ")) {
    // One word ("Ohtani", "Smith"): also consider surnames. Some 19th-century
    // players are recorded with a surname only, so merge rather than replace.
    const bySurname = index.findByLastName(text).filter((p) => !matches.includes(p));
    if (bySurname.length > 0) {
      matches = [...matches, ...bySurname].sort((a, b) => index.prominence(b) - index.prominence(a));
    }
  }

  if (matches.length === 0) return { kind: "not-found" };
  if (matches.length === 1) return { kind: "found", player: matches[0] };
  return { kind: "ambiguous", players: matches };
}

/** Deterministic validation of an answer against a question's criteria. */
export function validateAnswer(
  answer: AnswerInput,
  criteria: QuestionCriteria,
  index: PlayerIndex,
): ValidationResult {
  const resolution = resolvePlayer(answer, index);

  if (resolution.kind === "not-found") {
    const shown = (answer.input ?? "").trim();
    return {
      status: "not-found",
      valid: false,
      reason: shown
        ? `We couldn't find a player named "${shown}". Check the spelling or pick from the suggestions.`
        : "Type a player's name to answer.",
    };
  }

  if (resolution.kind === "ambiguous") {
    return resolveAmbiguous(answer.input ?? "", resolution.players, criteria, index);
  }

  const { player } = resolution;
  const check = checkCriteria(player, criteria);
  return {
    status: check.met ? "valid" : "invalid",
    valid: check.met,
    playerId: player.id,
    canonicalName: player.name,
    reason: check.explanation,
  };
}

/**
 * Several players share the typed name. We never pick one arbitrarily:
 * - exactly one namesake qualifies → the answer is correct under the only
 *   reading that could be correct, so credit that player (and say so);
 * - none qualify → the answer is wrong under every reading;
 * - several qualify → ask, because they may have different rarity scores.
 */
function resolveAmbiguous(
  input: string,
  players: BaseballPlayer[],
  criteria: QuestionCriteria,
  index: PlayerIndex,
): ValidationResult {
  const typed = input.trim();
  const qualifying = players.filter((p) => checkCriteria(p, criteria).met);

  if (qualifying.length === 1) {
    const [player] = qualifying;
    return {
      status: "valid",
      valid: true,
      playerId: player.id,
      canonicalName: player.name,
      reason: `${checkCriteria(player, criteria).explanation} (${players.length} players match "${typed}" — credited to the only one who qualifies, ${index.summarize(player).detail}.)`,
    };
  }

  if (qualifying.length === 0) {
    return {
      status: "invalid",
      valid: false,
      canonicalName: typed,
      reason: `None of the ${players.length} players matching "${typed}" qualify for this question.`,
    };
  }

  return {
    status: "ambiguous",
    valid: false,
    reason:
      qualifying.length > MAX_CANDIDATES
        ? `${qualifying.length} players matching "${typed}" qualify — pick one, or type a full name.`
        : `${qualifying.length} players matching "${typed}" qualify. Which one did you mean?`,
    candidates: qualifying.slice(0, MAX_CANDIDATES).map(index.summarize),
  };
}
