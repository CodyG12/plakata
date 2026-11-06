import { describe, expect, it } from "vitest";
import { addDays, cryptoRng, DAILY_COOLDOWN_DAYS, selectBalanced, selectDaily, seededRng, type SelectableQuestion } from "./selection";

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

describe("daily cooldown", () => {
  const slugsOf = (qs: SelectableQuestion[]) => qs.map((q) => q.slug);

  it("with no history, picks exactly what it picked before the cooldown existed", () => {
    expect(selectDaily(bank, "2026-11-04", 7, new Map())).toEqual(selectDaily(bank, "2026-11-04", 7));
  });

  it("skips a recently used question when its category has a fresh one", () => {
    // Everything but one question per category ran recently.
    const recent = new Map(bank.filter((q) => !q.slug.endsWith("-4")).map((q) => [q.slug, "2026-11-03"]));
    for (const day of ["2026-11-04", "2026-11-05", "2026-11-06"]) {
      expect(slugsOf(selectDaily(bank, day, 7, recent)).every((s) => s.endsWith("-4"))).toBe(true);
    }
  });

  it("when a whole category is on cooldown, takes the question used longest ago", () => {
    const team = bank.filter((q) => q.category === "team");
    const recent = new Map(team.map((q, i) => [q.slug, `2026-11-0${i + 1}`])); // team-0 is the oldest
    const fresh = bank.filter((q) => q.category !== "team");
    const picked = selectBalanced([...fresh, ...team], 8, seededRng("x"), recent);
    expect(slugsOf(picked).filter((s) => s.startsWith("team-"))).toEqual(["team-0"]);
  });

  it("drops a category with nothing fresh before a category that has fresh questions", () => {
    const recent = new Map(bank.filter((q) => q.category === "era").map((q) => [q.slug, "2026-11-03"]));
    for (let i = 0; i < 50; i++) {
      const picked = selectBalanced(bank, 7, seededRng(`run-${i}`), recent);
      expect(picked.some((q) => q.category === "era")).toBe(false);
    }
  });

  it("with ~30 questions per category, nothing repeats within 30 days over a year", () => {
    const big: SelectableQuestion[] = [];
    categories.forEach((category, c) => {
      for (let i = 0; i < 30; i++) big.push({ id: c * 100 + i, slug: `${category}-${i}`, category });
    });
    const history: { day: string; slugs: string[] }[] = [];
    for (let d = 0; d < 365; d++) {
      const day = addDays("2027-01-01", d);
      const since = addDays(day, -DAILY_COOLDOWN_DAYS);
      const recent = new Map<string, string>();
      for (const h of history) if (h.day >= since) for (const s of h.slugs) recent.set(s, h.day);
      const slugs = slugsOf(selectDaily(big, day, 7, recent));
      for (const s of slugs) expect(recent.has(s), `${s} repeated on ${day}`).toBe(false);
      history.push({ day, slugs });
    }
  });

  it("adds days across month and year boundaries", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});
