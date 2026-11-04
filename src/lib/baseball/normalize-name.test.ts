import { describe, expect, it } from "vitest";
import { normalizeName, stripSuffix } from "./normalize-name";

describe("normalizeName", () => {
  it("is case-insensitive and trims whitespace", () => {
    expect(normalizeName("  BABE   ruth ")).toBe("babe ruth");
  });

  it("strips diacritics", () => {
    expect(normalizeName("Raúl Ibañez")).toBe("raul ibanez");
    expect(normalizeName("Ronald Acuña")).toBe("ronald acuna");
    expect(normalizeName("José López")).toBe("jose lopez");
  });

  it("removes apostrophes and treats hyphens as spaces", () => {
    expect(normalizeName("Paul O'Neill")).toBe("paul oneill");
    expect(normalizeName("Paul O’Neill")).toBe("paul oneill");
    expect(normalizeName("Isiah Kiner-Falefa")).toBe("isiah kiner falefa");
  });

  it("collapses initials in every common format", () => {
    expect(normalizeName("J. J. Putz")).toBe("jj putz");
    expect(normalizeName("J.J. Putz")).toBe("jj putz");
    expect(normalizeName("JJ Putz")).toBe("jj putz");
    expect(normalizeName("C.C. Sabathia")).toBe("cc sabathia");
  });

  it("keeps suffixes in the normalized form so aliases can use them", () => {
    expect(normalizeName("Ken Griffey Jr.")).toBe("ken griffey jr");
    expect(normalizeName("Ken Griffey, Jr")).toBe("ken griffey jr");
  });

  it("stripSuffix drops trailing generational suffixes", () => {
    expect(stripSuffix("ken griffey jr")).toBe("ken griffey");
    expect(stripSuffix("cal ripken sr")).toBe("cal ripken");
    expect(stripSuffix("some player iii")).toBe("some player");
    expect(stripSuffix("jr")).toBe("jr");
  });
});
