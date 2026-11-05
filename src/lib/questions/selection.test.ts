import { describe, expect, it } from "vitest";
import { cryptoRng, selectBalanced, selectDaily, seededRng, type SelectableQuestion } from "./selection";

const bank: SelectableQuestion[] = [];
const categories = ["team", "position", "era", "stats", "honors", "all_star", "world_series", "birthplace"];
categories.forEach((category, c) => {
  for (let i = 0; i < 5; i++) bank.push({ id: c * 10 + i, slug: `${category}-${i}`, category });
});

describe("question selection", () => {
  it("never repeats a question and uses seven different categories", () => {
    for (let run = 0; run < 200; run++) {
      const picked = selectBalanced(bank, 7, cryptoRng);
      expect(new Set(picked.map((q) => q.id)).size).toBe(7);
      expect(new Set(picked.map((q) => q.category)).size).toBe(7);
    }
  });

  it("only repeats a category once every category is used", () => {
    const small = bank.filter((q) => ["team", "stats", "era"].includes(q.category));
    const picked = selectBalanced(small, 7, seededRng("x"));
    const counts = new Map<string, number>();
    for (const q of picked) counts.set(q.category, (counts.get(q.category) ?? 0) + 1);
    expect(Math.max(...counts.values()) - Math.min(...counts.values())).toBeLessThanOrEqual(1);
  });

  it("refuses when there aren't enough questions", () => {
    expect(() => selectBalanced(bank.slice(0, 6), 7, cryptoRng)).toThrow();
  });

  it("daily selection is deterministic: same day, same questions, same order", () => {
    const a = selectDaily(bank, "2026-11-04", 7).map((q) => q.id);
    const b = selectDaily([...bank].reverse(), "2026-11-04", 7).map((q) => q.id);
    expect(a).toEqual(b);
    const days = ["2026-11-05", "2026-11-06", "2026-11-07"].map((d) => selectDaily(bank, d, 7).map((q) => q.id).join());
    expect(new Set([a.join(), ...days]).size).toBeGreaterThan(1);
  });
});
