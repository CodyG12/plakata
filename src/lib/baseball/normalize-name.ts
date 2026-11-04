/** Generational suffixes. Lahman does not record them, so they are optional when matching. */
const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv"]);

/**
 * Normalizes a player name for deterministic matching.
 *
 * - Case-insensitive, diacritics removed ("Acuña" → "acuna")
 * - Apostrophes removed ("O'Neill" → "oneill")
 * - Periods, commas, hyphens etc. become spaces ("Kiner-Falefa" → "kiner falefa")
 * - Runs of single-letter initials collapse ("J. J. Putz", "J.J. Putz", "JJ Putz" → "jj putz")
 * - Whitespace collapsed and trimmed
 *
 * Generational suffixes are kept ("Ken Griffey Jr." → "ken griffey jr") so that
 * explicit aliases like "Ken Griffey Jr." can tell namesakes apart; use
 * {@link stripSuffix} for the suffix-less fallback.
 *
 * This is intentionally NOT fuzzy: it never changes letters, so it cannot turn
 * one real player's name into another's.
 */
export function normalizeName(input: string): string {
  const tokens = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’‘`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean);

  const merged: string[] = [];
  let lastWasInitials = false;
  for (const token of tokens) {
    if (token.length === 1 && lastWasInitials) {
      merged[merged.length - 1] += token;
    } else {
      merged.push(token);
      lastWasInitials = token.length === 1;
    }
  }
  return merged.join(" ");
}

/** Removes trailing generational suffixes from an already-normalized name. */
export function stripSuffix(normalized: string): string {
  const tokens = normalized.split(" ");
  while (tokens.length > 1 && SUFFIXES.has(tokens[tokens.length - 1])) tokens.pop();
  return tokens.join(" ");
}
