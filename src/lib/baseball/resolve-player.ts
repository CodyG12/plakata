import type { BaseballPlayer, MatchType } from "@/types/baseball";
import type { PlayerIndex } from "./dataset";
import { normalizeName, stripSuffix } from "./normalize-name";

/**
 * Outcome of turning typed text into players, using the name alone (no
 * knowledge of the question).
 */
export type NameResolution =
  /** The text names exactly one player (exact name, alias, or unique surname/first name). */
  | { kind: "resolved"; player: BaseballPlayer; matchType: Exclude<MatchType, "fuzzy"> }
  /**
   * The text is a full name (or alias) shared by several players who aren't a
   * known father/son pair — e.g. the three Randy Johnsons. The question decides
   * between them (see validate-answer.ts).
   */
  | { kind: "namesakes"; players: BaseballPlayer[]; matchType: Exclude<MatchType, "fuzzy" | "partial"> }
  /**
   * Probable typo, or a father/son name typed without "Jr.". Never accepted
   * automatically: `suggestion` is correctly spelled text that, when submitted,
   * resolves (without correction) to exactly `playerIds`.
   */
  | { kind: "suggestion"; suggestion: string; playerIds: string[] }
  /** A surname/first name alone, or a typo, that fits several different players. */
  | { kind: "ambiguous" }
  | { kind: "unrecognized" };

/**
 * Maximum typo distance allowed for an input of this many characters (spaces
 * included, after normalization). Short names must be typed exactly.
 *   1–4 chars  → 0 edits   ("Ruth", "Ott", "Cobb")
 *   5–9 chars  → 1 edit    ("Jeeter", "Pujolz")
 *   10+ chars  → 2 edits   ("Derek Jeeter", "Shohei Otani")
 */
export function maxTypoDistance(length: number): number {
  if (length < 5) return 0;
  if (length < 10) return 1;
  return 2;
}

/** Internal: candidate players and how they were matched. */
type Candidates = {
  ids: string[];
  matchType: MatchType;
  /** For typos: the correctly spelled text matched for each player. */
  spelling?: ReadonlyMap<string, string>;
  /** Normalized name that matched exactly (exact/alias steps only). */
  matchedKey?: string;
  /** Whether the user typed a Jr./Sr./II/III/IV suffix. */
  typedSuffix: boolean;
};

/**
 * Resolution pipeline (first step that finds anyone wins — later steps never
 * override an earlier match):
 *   1. Exact canonical name or verified alias ("Ken Griffey Jr." hits its alias).
 *   2. The same without a Jr./Sr./II/III suffix.
 *   3. Partial name: a surname or first name on its own ("Ohtani").
 *   4. Conservative fuzzy match (Damerau-Levenshtein, length-scaled threshold).
 */
export function resolvePlayerName(input: string, index: PlayerIndex): NameResolution {
  const result = resolveUnverified(input, index);
  return result.kind === "suggestion" ? verifySuggestion(result, index) : result;
}

function resolveUnverified(input: string, index: PlayerIndex): NameResolution {
  const key = normalizeName(input);
  if (!key) return { kind: "unrecognized" };
  const candidates = findCandidates(key, index);
  if (!candidates) return { kind: "unrecognized" };
  const { ids, matchType } = candidates;

  if (ids.length > 1) {
    const senior = seniorDefault(candidates, index);
    if (senior) return senior;
  }

  if (matchType === "fuzzy") {
    // One correctly spelled name for all the closest players → suggest it
    // (it may itself be shared, e.g. "Randy Jonson" → "Randy Johnson").
    const spellings = new Set(ids.map((id) => candidates.spelling?.get(id) ?? index.getById(id)!.name));
    if (spellings.size === 1) return { kind: "suggestion", suggestion: [...spellings][0], playerIds: ids };
    return { kind: "ambiguous" };
  }

  if (ids.length === 1) return { kind: "resolved", player: index.getById(ids[0])!, matchType };
  if (matchType === "partial") return { kind: "ambiguous" }; // e.g. "Griffey", "Johnson"
  return { kind: "namesakes", players: ids.map((id) => index.getById(id)!), matchType };
}

/**
 * A suggestion is only offered if submitting it resolves — without any typo
 * correction — to exactly the same players. Otherwise the input is unrecognized.
 */
function verifySuggestion(
  result: Extract<NameResolution, { kind: "suggestion" }>,
  index: PlayerIndex,
): NameResolution {
  const check = resolveUnverified(result.suggestion, index);
  const ids =
    check.kind === "resolved" ? [check.player.id] : check.kind === "namesakes" ? check.players.map((p) => p.id) : [];
  const same = ids.length === result.playerIds.length && ids.every((id) => result.playerIds.includes(id));
  return same ? result : { kind: "unrecognized" };
}

function findCandidates(key: string, index: PlayerIndex): Candidates | null {
  const stripped = stripSuffix(key);
  const typedSuffix = stripped !== key;

  // 1–2. Exact canonical names and verified aliases.
  for (const k of typedSuffix ? [key, stripped] : [key]) {
    const exact = index.byCanonicalName(k);
    const alias = index.byAlias(k);
    if (exact.size > 0 && alias.size === 0 && !k.includes(" ")) {
      // A single word that is also some 19th-century player's whole recorded
      // name ("Johnson") is still just a surname: merge with every player of
      // that surname/first name so it can never bypass the surname rule.
      const ids = [...new Set([...exact, ...index.byPartialName(k)])];
      return { ids, matchType: ids.length === 1 ? "exact" : "partial", typedSuffix };
    }
    if (exact.size > 0 || alias.size > 0) {
      return {
        ids: [...new Set([...exact, ...alias])],
        matchType: exact.size > 0 ? "exact" : "alias",
        matchedKey: k,
        typedSuffix,
      };
    }
  }

  // 3. Partial name (surname or first name alone), checked across ALL players.
  const partial = index.byPartialName(stripped);
  if (partial.size > 0) return { ids: [...partial], matchType: "partial", typedSuffix };

  // 4. Fuzzy: try the text as typed, then without a suffix.
  for (const k of typedSuffix ? [key, stripped] : [key]) {
    const match = index.fuzzy(k, maxTypoDistance(k.length), true);
    if (match) return { ids: [...match.playerIds], matchType: "fuzzy", spelling: match.spelling, typedSuffix };
  }
  return null;
}

/**
 * Father/son namesakes: a full name typed WITHOUT a suffix ("Ken Griffey", or
 * a typo of it) means the father. Only an explicit "Jr." reaches the son,
 * through his alias. Applies only when a verified "<name> Sr." alias exists
 * for exactly the name that matched; returns a "Did you mean … Sr.?"
 * suggestion rather than silently picking.
 */
function seniorDefault(candidates: Candidates, index: PlayerIndex): NameResolution | null {
  if (candidates.typedSuffix || candidates.matchType === "partial") return null;

  let baseKey = candidates.matchedKey;
  if (candidates.matchType === "fuzzy") {
    const spelled = new Set(candidates.ids.map((id) => normalizeName(candidates.spelling?.get(id) ?? "")));
    baseKey = spelled.size === 1 ? [...spelled][0] : undefined;
  }
  if (!baseKey) return null;

  const seniorKey = `${baseKey} sr`;
  const senior = index.byAlias(seniorKey);
  if (senior.size !== 1) return null;
  const [seniorId] = senior;
  if (!candidates.ids.includes(seniorId)) return null;

  return { kind: "suggestion", suggestion: index.displayOf(seniorKey) ?? seniorKey, playerIds: [seniorId] };
}
