import { describe, expect, it } from "vitest";
import { QUESTION_BANK } from "@/data/question-bank";
import { RARITY_ESTIMATES } from "@/data/rarity-estimates";
import { checkCriteria } from "@/lib/baseball/criteria";
import { getPlayerIndex } from "@/lib/baseball/dataset";
import {
  buildDistribution,
  curatedTiersFor,
  NON_PICK_RARITY_CAP,
  priorWeights,
  scoreFromSnapshot,
  statFor,
  TIER_WEIGHTS,
  type SnapshotDistribution,
} from "./rarity";

// Synthetic pools: rarity math is tested on made-up ids, never on invented baseball facts.
const pool = (n: number) => Array.from({ length: n }, (_, i) => `p${String(i).padStart(4, "0")}`);
const sumOf = (d: SnapshotDistribution, eligible: string[]) =>
  eligible.reduce((s, id) => s + statFor(d, id, true)!.smoothed, 0);
const priorSum = (d: SnapshotDistribution, eligible: string[]) => eligible.reduce((s, id) => s + statFor(d, id, true)!.prior, 0);

describe("prior distribution", () => {
  it("is a proper distribution: every answer > 0, summing to 1", () => {
    const eligible = pool(50);
    const curated = { p0000: "iconic", p0001: "famous", p0002: "known" } as const;
    const d = buildDistribution({ eligible, curated, plakataPick: "p0049" });
    for (const id of eligible) expect(statFor(d, id, true)!.prior).toBeGreaterThan(0);
    expect(priorSum(d, eligible)).toBeCloseTo(1, 12);
  });

  it("keeps curated order: iconic > famous > wellKnown > known > uncurated", () => {
    const eligible = pool(30);
    const w = priorWeights(eligible, { p0000: "iconic", p0001: "famous", p0002: "wellKnown", p0003: "known" });
    expect(w.get("p0000")! > w.get("p0001")!).toBe(true);
    expect(w.get("p0001")! > w.get("p0002")!).toBe(true);
    expect(w.get("p0002")! > w.get("p0003")!).toBe(true);
    expect(w.get("p0003")! > w.get("p0010")!).toBe(true);
  });

  it("is uniform when a question has no curated list", () => {
    const eligible = pool(40);
    const d = buildDistribution({ eligible, plakataPick: "p0007" });
    expect(statFor(d, "p0000", true)!.prior).toBeCloseTo(1 / 40, 15);
    expect(statFor(d, "p0039", true)!.prior).toBeCloseTo(1 / 40, 15);
  });

  it("gives uncurated players 40% of the mass in a large pool, never more per head than half a 'known'", () => {
    const eligible = pool(2000);
    const curated = Object.fromEntries(eligible.slice(0, 20).map((id) => [id, "famous" as const]));
    const d = buildDistribution({ eligible, curated, plakataPick: "p1999" });
    const uncuratedMass = eligible.slice(20).reduce((s, id) => s + statFor(d, id, true)!.prior, 0);
    expect(uncuratedMass).toBeCloseTo(0.4, 10);
    const small = priorWeights(pool(25), Object.fromEntries(pool(24).map((id) => [id, "known" as const])));
    expect(small.get("p0024")).toBe(TIER_WEIGHTS.known / 2);
  });
});

describe("Bayesian smoothing", () => {
  it("matches (n + α·prior) / (N + α) exactly", () => {
    const eligible = pool(10);
    const counts = new Map([["p0000", 30], ["p0001", 10]]);
    const d = buildDistribution({ eligible, counts, alpha: 100, plakataPick: "p0009" });
    expect(statFor(d, "p0000", true)!.smoothed).toBeCloseTo((30 + 100 * 0.1) / (40 + 100), 15);
    expect(statFor(d, "p0005", true)!.smoothed).toBeCloseTo((0 + 100 * 0.1) / 140, 15);
    expect(d.totalObservations).toBe(40);
  });

  it("the smoothed distribution sums to 1 at any sample size", () => {
    const eligible = pool(200);
    for (const n of [0, 1, 7, 150, 10_000]) {
      const counts = new Map([["p0003", n], ["p0100", Math.floor(n / 3)]]);
      expect(sumOf(buildDistribution({ eligible, counts, plakataPick: "p0199" }), eligible)).toBeCloseTo(1, 10);
    }
  });

  it("with zero observations equals the prior", () => {
    const eligible = pool(12);
    const d = buildDistribution({ eligible, curated: { p0000: "iconic" }, plakataPick: "p0011" });
    for (const id of eligible) {
      const s = statFor(d, id, true)!;
      expect(s.smoothed).toBeCloseTo(s.prior, 15);
      expect(s.observed).toBe(0);
    }
  });

  it("barely moves on a handful of answers (low sample)", () => {
    const eligible = pool(20);
    const curated = { p0000: "iconic" } as const;
    const prior = buildDistribution({ eligible, curated, plakataPick: "p0019" });
    const few = buildDistribution({ eligible, curated, counts: new Map([["p0005", 3]]), plakataPick: "p0019" });
    // Three answers against α = 100 move an un-named answer by exactly 3/103 of its prior.
    const p = statFor(prior, "p0000", true)!.smoothed;
    expect(statFor(few, "p0000", true)!.smoothed).toBeCloseTo(p * (100 / 103), 15);
    expect(1 - statFor(few, "p0000", true)!.smoothed / p).toBeLessThan(0.03);
    // …and its tier doesn't change.
    expect(scoreFromSnapshot(few, "p0000", true).tier).toBe(scoreFromSnapshot(prior, "p0000", true).tier);
  });

  it("community data gradually outweighs the prior", () => {
    // The curated favorite is p0000, but fans actually say p0010 four times as often.
    const eligible = pool(20);
    const curated = { p0000: "iconic" } as const;
    const gap: number[] = [];
    for (const N of [0, 100, 1_000, 10_000, 100_000]) {
      const counts = new Map([["p0010", (N * 4) / 5], ["p0000", N / 5]]);
      const d = buildDistribution({ eligible, curated, counts, plakataPick: "p0019" });
      const s = statFor(d, "p0010", true)!;
      gap.push(Math.abs(s.smoothed - s.observed));
      if (N >= 1_000) expect(statFor(d, "p0010", true)!.rarity).toBeLessThan(statFor(d, "p0000", true)!.rarity);
      if (N === 100_000) expect(s.smoothed).toBeCloseTo(0.8, 2);
    }
    for (let i = 2; i < gap.length; i++) expect(gap[i]).toBeLessThan(gap[i - 1]);
  });

  it("rejects bad inputs instead of producing garbage", () => {
    expect(() => buildDistribution({ eligible: [], plakataPick: "x" })).toThrow();
    expect(() => buildDistribution({ eligible: pool(3), plakataPick: "nope" })).toThrow(/not eligible/);
    expect(() => buildDistribution({ eligible: pool(3), plakataPick: "p0000", alpha: 0 })).toThrow(/alpha/);
    expect(() => buildDistribution({ eligible: pool(3), plakataPick: "p0000", counts: new Map([["p0001", -1]]) })).toThrow();
  });
});

describe("calibration", () => {
  it("raw 1 − p is compressed in big pools; the calibrated percentile spreads it out", () => {
    const eligible = pool(1800);
    const counts = new Map(eligible.map((id, i) => [id, Math.max(0, 400 - i * 3)]));
    const d = buildDistribution({ eligible, counts, plakataPick: "p1799" });
    const top = statFor(d, "p0000", true)!;
    expect(top.rawRarity).toBeGreaterThan(95); // the most common answer still "looks" rare
    expect(top.rarity).toBeLessThan(5); // calibrated: it's the commonest answer
    expect(statFor(d, "p1500", true)!.rarity).toBeGreaterThan(80);
  });

  it("is monotonic: a more common answer is never rarer", () => {
    const eligible = pool(300);
    const counts = new Map(eligible.map((id, i) => [id, (i * 37) % 23]));
    const d = buildDistribution({ eligible, curated: { p0004: "iconic", p0100: "known" }, counts, plakataPick: "p0299" });
    const stats = eligible.map((id) => statFor(d, id, true)!).sort((a, b) => b.smoothed - a.smoothed);
    for (let i = 1; i < stats.length; i++) expect(stats[i].rarity).toBeGreaterThanOrEqual(stats[i - 1].rarity);
    for (const s of stats) {
      expect(s.rarity).toBeGreaterThanOrEqual(0);
      expect(s.rarity).toBeLessThanOrEqual(100);
    }
  });

  it("ties share a score; a never-named uncurated answer still has a nonzero probability", () => {
    const eligible = pool(100);
    const d = buildDistribution({ eligible, counts: new Map([["p0000", 50]]), plakataPick: "p0099" });
    expect(statFor(d, "p0040", true)).toEqual(statFor(d, "p0080", true));
    expect(statFor(d, "p0040", true)!.smoothed).toBeGreaterThan(0);
  });

  it("is deterministic regardless of input order", () => {
    const eligible = pool(500);
    const counts = new Map(eligible.map((id, i) => [id, i % 7]));
    const a = buildDistribution({ eligible, counts, plakataPick: "p0001" });
    const b = buildDistribution({ eligible: [...eligible].reverse(), counts: new Map([...counts].reverse()), plakataPick: "p0001" });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("stores one shared entry for never-named uncurated answers, not thousands", () => {
    const eligible = pool(3000);
    const d = buildDistribution({ eligible, counts: new Map([["p0001", 2]]), plakataPick: "p2999" });
    expect(Object.keys(d.players)).toEqual(["p0001"]);
    expect(d.default).not.toBeNull();
  });
});

describe("tier mapping", () => {
  const eligible = pool(100);
  const d = buildDistribution({
    eligible,
    counts: new Map(eligible.slice(0, 60).map((id, i) => [id, 200 - i * 3])),
    alpha: 1,
    plakataPick: "p0099",
  });

  it("the hand-picked answer is always a Plákata (100 points)", () => {
    expect(scoreFromSnapshot(d, "p0099", true)).toMatchObject({ tier: "plakata", points: 100, method: "plakata", valid: true });
  });

  it("every other answer is capped at a Triple, however rare", () => {
    expect(statFor(d, "p0098", true)!.rarity).toBeGreaterThan(80);
    expect(scoreFromSnapshot(d, "p0098", true)).toMatchObject({ tier: "triple", points: 75, estimatedRarity: NON_PICK_RARITY_CAP });
  });

  it("the commonest answer is a Bunt; points only ever take the six fixed values", () => {
    expect(scoreFromSnapshot(d, "p0000", true)).toMatchObject({ tier: "bunt", points: 10 });
    for (const id of eligible) expect([10, 25, 50, 75, 100]).toContain(scoreFromSnapshot(d, id, true).points);
  });

  it("refuses to score an ineligible answer", () => {
    expect(() => scoreFromSnapshot(d, "p0001", false)).toThrow();
  });
});

describe("curated priors for the original seven (migrated from v1)", () => {
  const index = getPlayerIndex();
  const original = QUESTION_BANK.filter((q) => q.slug in RARITY_ESTIMATES);

  it("every curated id exists and fits its question", () => {
    expect(original.map((q) => q.slug).sort()).toEqual(Object.keys(RARITY_ESTIMATES).sort());
    for (const q of original) {
      for (const id of Object.keys(curatedTiersFor(q.slug))) {
        const player = index.getById(id);
        expect(player, `${q.slug}: ${id}`).toBeDefined();
        expect(checkCriteria(player!, q.criteria, index).met, `${q.slug}: ${player!.name}`).toBe(true);
      }
    }
  });

  it("with zero observations, curated tiers keep their order and the pick is the only Plákata", () => {
    const rank = { iconic: 0, famous: 1, wellKnown: 2, known: 3 } as const;
    for (const q of original) {
      const eligible = index.all().filter((p) => checkCriteria(p, q.criteria, index).met).map((p) => p.id);
      const curated = curatedTiersFor(q.slug);
      const d = buildDistribution({ eligible, curated, plakataPick: q.plakataPick });
      const scored = eligible.map((id) => ({ id, s: scoreFromSnapshot(d, id, true) }));
      expect(scored.filter((x) => x.s.tier === "plakata").map((x) => x.id), q.slug).toEqual([q.plakataPick]);
      const byTier = (t: keyof typeof rank) => scored.filter((x) => curated[x.id] === t).map((x) => x.s.points);
      const tiers = (Object.keys(rank) as (keyof typeof rank)[]).filter((t) => byTier(t).length > 0);
      for (let i = 1; i < tiers.length; i++) {
        expect(Math.min(...byTier(tiers[i])), `${q.slug}: ${tiers[i]} vs ${tiers[i - 1]}`).toBeGreaterThanOrEqual(
          Math.max(...byTier(tiers[i - 1])),
        );
      }
      const iconic = byTier("iconic");
      if (iconic.length) expect(Math.max(...iconic), q.slug).toBe(10); // famous names are Bunts
    }
  });
});
