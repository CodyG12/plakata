import { describe, expect, it } from "vitest";
import { damerauLevenshtein } from "./string-distance";

describe("damerauLevenshtein", () => {
  it("is zero for identical strings", () => {
    expect(damerauLevenshtein("derek jeter", "derek jeter", 2)).toBe(0);
  });

  it("counts substitutions, insertions and deletions", () => {
    expect(damerauLevenshtein("pujolz", "pujols", 2)).toBe(1); // substitution
    expect(damerauLevenshtein("jeeter", "jeter", 2)).toBe(1); // extra letter
    expect(damerauLevenshtein("grifey", "griffey", 2)).toBe(1); // missing letter
  });

  it("counts an adjacent transposition as one edit", () => {
    expect(damerauLevenshtein("truot", "trout", 2)).toBe(1);
    expect(damerauLevenshtein("ohtnai", "ohtani", 2)).toBe(1);
  });

  it("stops early and reports max + 1 when over the limit", () => {
    expect(damerauLevenshtein("babe ruth", "ty cobb", 2)).toBe(3);
    expect(damerauLevenshtein("a", "abcdef", 1)).toBe(2);
  });
});
