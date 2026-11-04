import { describe, expect, it } from "vitest";
import { PLAYER_ALIASES } from "@/data/aliases";
import { QUESTIONS, getQuestion } from "@/data/questions";
import { getPlayerIndex } from "./dataset";
import { MESSAGES, validateAnswer } from "./validate-answer";

const index = getPlayerIndex();
const criteria = (id: string) => getQuestion(id)!.criteria;
const validate = (input: string, questionId: string) => validateAnswer(input, criteria(questionId), index);

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
      const pick = validateAnswer("Luis Castillo", criteria("mariners"), index, "castilu03");
      expect(pick).toMatchObject({ status: "valid", playerId: "castilu03" });
      // A namesake who doesn't fit (castilu01) or an unrelated ID can't be forced through.
      expect(validateAnswer("Luis Castillo", criteria("mariners"), index, "castilu01").status).toBe("choose");
      expect(validateAnswer("Luis Castillo", criteria("mariners"), index, "jeterde01").status).toBe("choose");
      expect(validateAnswer("Derek Jeter", criteria("mvp"), index, "ohtansh01").status).toBe("ineligible");
    });
  });

  it("checks eligibility only after the name is settled", () => {
    // A plain father/son name suggests Sr. before eligibility is checked, identically for any question.
    expect(validate("Ken Griffey", "hr-300")).toMatchObject({ status: "suggestion", suggestion: "Ken Griffey Sr." });
    expect(validate("Ken Griffey", "hr-300")).toEqual(validate("Ken Griffey", "mariners"));
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

  it("covers every configured question", () => {
    for (const question of QUESTIONS) {
      expect(() => validateAnswer("Babe Ruth", question.criteria, index)).not.toThrow();
    }
  });
});

describe("dataset integrity", () => {
  it("every alias points at an existing player", () => {
    for (const [alias, id] of PLAYER_ALIASES) {
      expect(index.getById(id), `${alias} -> ${id}`).toBeDefined();
    }
  });

  it("does not coerce missing stats to zero", () => {
    expect(index.getById("ruthba01")).toMatchObject({ hr: 714, hits: 2873, hof: 1936, lastName: "Ruth" });
    expect(index.getById("aaronha01")).toMatchObject({ hr: 755, hits: 3771 });
  });
});
