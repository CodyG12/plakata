import { describe, expect, it } from "vitest";
import { PLAYER_ALIASES } from "@/data/aliases";
import { QUESTION_BANK } from "@/data/question-bank";
import { getPlayerIndex } from "./dataset";
import { liveTarget, MESSAGES, validateAnswer } from "./validate-answer";

const index = getPlayerIndex();
const target = (slug: string) => liveTarget(QUESTION_BANK.find((q) => q.slug === slug)!.criteria, index);
const validate = (input: string, slug: string) => validateAnswer(input, target(slug), index);

describe("validateAnswer — real Lahman data", () => {
  it("accepts valid answers for each question", () => {
    const cases: Array<[string, string, string]> = [
      ["hr-300", "Jay Buhner", "buhneja01"],
      ["mvp", "Shohei Ohtani", "ohtansh01"],
      ["yankees", "Derek Jeter", "jeterde01"],
      ["hits-2000", "Paul Molitor", "molitpa01"],
      ["cy-young", "Greg Maddux", "maddugr01"],
      ["mariners", "Edgar Martinez", "martied01"],
      ["hall-of-fame", "Ichiro Suzuki", "suzukic01"],
    ];
    for (const [questionId, input, expectedId] of cases) {
      expect(validate(input, questionId), `${questionId}: ${input}`).toMatchObject({
        status: "valid",
        playerId: expectedId,
      });
    }
  });

  it("explains a valid answer with dataset facts", () => {
    expect(validate("Jay Buhner", "hr-300").message).toBe("Jay Buhner hit 310 career home runs.");
  });

  it("answers a typo with a suggestion instead of accepting it", () => {
    expect(validate("Derek Jeeter", "yankees")).toEqual({
      status: "suggestion",
      suggestion: "Derek Jeter",
      message: "Did you mean Derek Jeter?",
    });
    // Submitting the suggestion then validates normally.
    expect(validate("Derek Jeter", "yankees")).toMatchObject({ status: "valid", playerId: "jeterde01" });
  });

  it("offers the same suggestion whether or not the player qualifies", () => {
    // Identical response for a question Jeter fits (Yankees) and one he doesn't (MVP).
    expect(validate("Derek Jeeter", "mvp")).toEqual(validate("Derek Jeeter", "yankees"));
  });

  it("accepts aliases and accents, then checks eligibility", () => {
    expect(validate("Big Papi", "hr-300")).toMatchObject({ status: "valid", matchType: "alias" });
    expect(validate("Raúl Ibañez", "hr-300")).toMatchObject({ status: "valid", playerId: "ibanera01" });
  });

  it("marks real players who don't fit as ineligible", () => {
    expect(validate("Nolan Ryan", "cy-young").status).toBe("ineligible");
    expect(validate("Derek Jeter", "mvp").status).toBe("ineligible");
    expect(validate("Mike Trout", "mariners").status).toBe("ineligible");
  });

  it("never lets the question resolve a surname alone", () => {
    // Only Ken Griffey Jr. has 300 HR, but "Griffey" names two players: still ambiguous.
    expect(validate("Griffey", "hr-300").status).toBe("ambiguous");
    expect(validate("Johnson", "cy-young").status).toBe("ambiguous");
  });

  describe("unrelated namesakes (same full name)", () => {
    it("accepts the name when exactly one namesake fits the question", () => {
      // Three MLB players are named Randy Johnson; only one won a Cy Young or reached the Hall.
      expect(validate("Randy Johnson", "cy-young")).toMatchObject({ status: "valid", playerId: "johnsra05" });
      expect(validate("Randy Johnson", "hall-of-fame")).toMatchObject({ status: "valid", playerId: "johnsra05" });
    });

    it("rejects the name when no namesake fits", () => {
      expect(validate("Randy Johnson", "mvp")).toEqual({ status: "ineligible", message: MESSAGES.ineligible });
    });

    it("asks the user to choose when several namesakes fit", () => {
      // Two different Luis Castillos played for the Mariners.
      const result = validate("Luis Castillo", "mariners");
      expect(result.status).toBe("choose");
      expect(result.options?.map((o) => o.playerId).sort()).toEqual(["castilu02", "castilu03"]);
      expect(result.options?.every((o) => o.name === "Luis Castillo" && /\d{4}/.test(o.detail))).toBe(true);
      expect(result.playerId).toBeUndefined();
    });

    it("accepts the user's choice, and only a choice from the offered list", () => {
      const pick = validateAnswer("Luis Castillo", target("mariners"), index, "castilu03");
      expect(pick).toMatchObject({ status: "valid", playerId: "castilu03" });
      // A namesake who doesn't fit (castilu01) or an unrelated ID can't be forced through.
      expect(validateAnswer("Luis Castillo", target("mariners"), index, "castilu01").status).toBe("choose");
      expect(validateAnswer("Luis Castillo", target("mariners"), index, "jeterde01").status).toBe("choose");
      expect(validateAnswer("Derek Jeter", target("mvp"), index, "ohtansh01").status).toBe("ineligible");
    });
  });

  it("checks eligibility only after the name is settled", () => {
    // A plain father/son name means Sr. regardless of the question; then eligibility applies to him.
    expect(validate("Ken Griffey", "hr-300").status).toBe("ineligible"); // Sr. hit 152 HR
    expect(validate("Ken Griffey", "mariners").status).toBe("valid"); // Sr. played for Seattle 1990–91
    // A typo of the plain name still suggests Sr., identically for any question.
    expect(validate("Ken Grifey", "hr-300")).toMatchObject({ status: "suggestion", suggestion: "Ken Griffey Sr." });
    expect(validate("Ken Grifey", "hr-300")).toEqual(validate("Ken Grifey", "mariners"));
    // Once specific, eligibility applies normally.
    expect(validate("Ken Griffey Jr.", "hr-300").status).toBe("valid");
    expect(validate("Ken Griffey Sr.", "hr-300").status).toBe("ineligible");
  });

  it("reports unknown names as unrecognized", () => {
    expect(validate("Roy Hobbs", "hr-300")).toEqual({ status: "unrecognized", message: MESSAGES.unrecognized });
  });

  it("never reveals player details for rejected answers", () => {
    const rejected = [
      validate("Griffey", "hr-300"), // ambiguous
      validate("Randy Johnson", "mvp"), // ineligible namesakes
      validate("Nolan Ryan", "cy-young"), // ineligible
      validate("Xyzabc", "mvp"), // unrecognized
    ];
    for (const result of rejected) {
      expect(Object.keys(result).sort()).toEqual(["message", "status"]);
      expect(result.message).not.toMatch(/Griffey|Johnson|Ryan|Jeter|Ken|Randy/);
    }
  });

  it("uses only generic messages", () => {
    expect(validate("Griffey", "mariners").message).toBe(MESSAGES.ambiguous);
    expect(validate("Nolan Ryan", "cy-young").message).toBe(MESSAGES.ineligible);
  });

  it("covers every question in the bank", () => {
    for (const question of QUESTION_BANK) {
      expect(() => validateAnswer("Babe Ruth", liveTarget(question.criteria, index), index)).not.toThrow();
    }
  });

  it("trusts the eligibility set over the live criteria (versioned answers)", () => {
    const frozen = { criteria: QUESTION_BANK[0].criteria, isEligible: (id: string) => id === "ruthba01" };
    expect(validateAnswer("Babe Ruth", frozen, index).status).toBe("valid");
    expect(validateAnswer("Hank Aaron", frozen, index).status).toBe("ineligible");
  });
});

describe("dataset integrity", () => {
  it("every alias points at an existing player", () => {
    for (const [alias, id] of PLAYER_ALIASES) {
      expect(index.getById(id), `${alias} -> ${id}`).toBeDefined();
    }
  });

  it("does not coerce missing stats to zero", () => {
    expect(index.getById("ruthba01")).toMatchObject({ career: { homeRuns: 714, hits: 2873 }, hof: 1936, lastName: "Ruth" });
    expect(index.getById("aaronha01")).toMatchObject({ career: { homeRuns: 755, hits: 3771 } });
    // A position player with no pitching rows has no pitching stats, not zero.
    expect(index.getById("aaronha01")!.career.wins).toBeUndefined();
  });
});
