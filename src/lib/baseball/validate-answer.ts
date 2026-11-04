import type { BaseballPlayer, PlayerOption, QuestionCriteria, ValidationResult } from "@/types/baseball";
import { checkCriteria } from "./criteria";
import type { PlayerIndex } from "./dataset";
import { resolvePlayerName } from "./resolve-player";

/** Messages shown to the player. */
export const MESSAGES = {
  unrecognized: "Player not recognized. Check the spelling and try again.",
  ambiguous: "Multiple players match that name. Please enter the player's full name.",
  ineligible: "Incorrect answer — that player doesn't fit this question. Try again!",
  suggestion: (name: string) => `Did you mean ${name}?`,
  choose: (name: string) => `More than one ${name} fits this question. Which one did you mean?`,
} as const;

/**
 * Validates typed text against a question:
 *   1. Resolve the text to players by name alone (see resolve-player.ts).
 *      A probable typo — or a father/son name without "Jr." — returns a
 *      "Did you mean …?" suggestion instead, before eligibility is checked.
 *   2. Check the player(s) against the question. A full name shared by
 *      unrelated namesakes counts if any of them fits; if several fit, the user
 *      chooses which one they meant (`chosenPlayerId` on the next request).
 * Rejected answers return a generic message and no player details.
 */
export function validateAnswer(
  input: string,
  criteria: QuestionCriteria,
  index: PlayerIndex,
  chosenPlayerId?: string,
): ValidationResult {
  const resolution = resolvePlayerName(input, index);
  switch (resolution.kind) {
    case "unrecognized":
      return { status: "unrecognized", message: MESSAGES.unrecognized };
    case "ambiguous":
      return { status: "ambiguous", message: MESSAGES.ambiguous };
    case "suggestion":
      return {
        status: "suggestion",
        suggestion: resolution.suggestion,
        message: MESSAGES.suggestion(resolution.suggestion),
      };
    case "resolved":
      return judge(resolution.player, criteria, resolution.matchType);
    case "namesakes": {
      const fitting = resolution.players.filter((p) => checkCriteria(p, criteria).met);
      if (fitting.length === 0) return { status: "ineligible", message: MESSAGES.ineligible };
      if (fitting.length === 1) return judge(fitting[0], criteria, resolution.matchType);
      // Only a player from this list can be chosen; anything else re-asks.
      const chosen = fitting.find((p) => p.id === chosenPlayerId);
      if (chosen) return judge(chosen, criteria, resolution.matchType);
      return {
        status: "choose",
        message: MESSAGES.choose(fitting[0].name),
        options: fitting.map((p) => toOption(p, index)),
      };
    }
  }
}

function judge(player: BaseballPlayer, criteria: QuestionCriteria, matchType: ValidationResult["matchType"]): ValidationResult {
  const check = checkCriteria(player, criteria);
  if (!check.met) return { status: "ineligible", message: MESSAGES.ineligible };
  return { status: "valid", playerId: player.id, canonicalName: player.name, matchType, message: check.explanation };
}

function toOption(player: BaseballPlayer, index: PlayerIndex): PlayerOption {
  const years =
    player.firstYear === player.lastYear ? `${player.firstYear}` : `${player.firstYear}–${player.lastYear}`;
  const shown = player.teams.slice(0, 2).map(index.teamName);
  const extra = player.teams.length - shown.length;
  return {
    playerId: player.id,
    name: player.name,
    detail: `${years} · ${shown.join(", ")}${extra > 0 ? ` +${extra} more` : ""}`,
  };
}
