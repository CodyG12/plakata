/**
 * Damerau-Levenshtein distance (optimal string alignment variant): the number
 * of single-character insertions, deletions, substitutions, or adjacent
 * transpositions needed to turn `a` into `b`.
 *
 * Returns `max + 1` as soon as the distance is known to exceed `max`, so
 * scanning thousands of names with a small `max` stays fast.
 */
export function damerauLevenshtein(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;

  const n = a.length;
  const m = b.length;
  // Three rolling rows: i-2, i-1, i.
  let prevPrev = new Array<number>(m + 1).fill(0);
  let prev = Array.from({ length: m + 1 }, (_, j) => j);
  let curr = new Array<number>(m + 1).fill(0);

  for (let i = 1; i <= n; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, prevPrev[j - 2] + 1);
      }
      curr[j] = value;
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > max) return max + 1;
    [prevPrev, prev, curr] = [prev, curr, prevPrev];
  }
  return prev[m] > max ? max + 1 : prev[m];
}
