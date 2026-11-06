import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { QUESTION_BANK } from "@/data/question-bank";
import { getPlayerIndex } from "@/lib/baseball/dataset";
import { contentHash, effectiveTopFive } from "./question-store";

const release = getPlayerIndex().meta.release;
/** The hash formula before the 1893 pitching floor existed. */
const legacyHash = (prompt: string, criteria: unknown, topFive: boolean) =>
  createHash("sha256")
    .update(JSON.stringify(topFive ? [prompt, criteria, release, "top-five-bunt"] : [prompt, criteria, release]))
    .digest("hex");

describe("question version hashes and the 1893 pitching floor", () => {
  it("only single-season pitching questions get a new version; every other question keeps its hash", () => {
    const changed: string[] = [];
    for (const q of QUESTION_BANK) {
      const topFive = effectiveTopFive(q.criteria, q.topFiveBunt);
      if (contentHash(q.prompt, q.criteria, release, topFive) !== legacyHash(q.prompt, q.criteria, topFive)) changed.push(q.slug);
    }
    expect(changed).toEqual(["season-wins-20"]);
  });

  it("the floor is part of the hash only while the Top-5 rule is on", () => {
    const q = QUESTION_BANK.find((x) => x.slug === "season-wins-20")!;
    expect(contentHash(q.prompt, q.criteria, release, false)).toBe(legacyHash(q.prompt, q.criteria, false));
  });
});
