import { describe, expect, it } from "vitest";
import { PLAYER_ALIASES } from "@/data/aliases";
import { QUESTIONS, getQuestion } from "@/data/questions";
import { getPlayerIndex } from "./dataset";
import { validateAnswer } from "./validate-answer";

const index = getPlayerIndex();
const criteria = (id: string) => getQuestion(id)!.criteria;

describe("validateAnswer — real Lahman data", () => {
  it("accepts valid answers for each question", () => {
    const cases: Array<[string, string, string]> = [
      ["hr-300", "Jay Buhner", "buhneja01"],
      ["mvp", "Shohei Ohtani", "ohtansh01"],
      ["yankees", "Derek Jeter", "jeterde01"],
      ["hits-2000", "Pete Rose", "rosepe01"],
      ["cy-young", "Randy Johnson", "johnsra05"],
      ["mariners", "Edgar Martinez", "martied01"],
      ["hall-of-fame", "Ichiro Suzuki", "suzukic01"],
    ];
    for (const [questionId, input, expectedId] of cases) {
      const result = validateAnswer({ input }, criteria(questionId), index);
      expect(result, `${questionId}: ${input}`).toMatchObject({ status: "valid", valid: true, playerId: expectedId });
    }
  });

  it("rejects real players who do not meet the criteria, with a factual reason", () => {
    const nolan = validateAnswer({ input: "Nolan Ryan" }, criteria("cy-young"), index);
    expect(nolan).toMatchObject({ status: "invalid", valid: false, playerId: "ryanno01" });
    expect(nolan.reason).toMatch(/never won the Cy Young/);

    const jeter = validateAnswer({ input: "Derek Jeter" }, criteria("mvp"), index);
    expect(jeter.status).toBe("invalid");

    const trout = validateAnswer({ input: "Mike Trout" }, criteria("mariners"), index);
    expect(trout.status).toBe("invalid");

    const rose = validateAnswer({ input: "Pete Rose" }, criteria("hall-of-fame"), index);
    expect(rose.status).toBe("invalid");

    const ortiz = validateAnswer({ input: "David Ortiz" }, criteria("mariners"), index);
    expect(ortiz.status).toBe("invalid"); // in Seattle's minor-league system only
  });

  it("explains how far short a stat threshold is", () => {
    const result = validateAnswer({ input: "Mark McGwire" }, criteria("hits-2000"), index);
    expect(result.status).toBe("invalid");
    expect(result.reason).toMatch(/short of 2,000/);
  });

  it("reports unknown names as not-found (round stays open)", () => {
    const result = validateAnswer({ input: "Roy Hobbs" }, criteria("hr-300"), index);
    expect(result).toMatchObject({ status: "not-found", valid: false });
  });

  it("is case-insensitive and accent-insensitive", () => {
    expect(validateAnswer({ input: "jay BUHNER" }, criteria("hr-300"), index).playerId).toBe("buhneja01");
    // Lahman stores "Raul Ibanez" without accents; the accented form must still match.
    expect(validateAnswer({ input: "Raúl Ibañez" }, criteria("hr-300"), index)).toMatchObject({
      status: "valid",
      playerId: "ibanera01",
    });
    // Lahman stores "Ronald Acuña" with the accent; plain ASCII must still match.
    expect(validateAnswer({ input: "Ronald Acuna" }, criteria("mvp"), index).playerId).toBe("acunaro01");
  });

  it("resolves explicit aliases", () => {
    expect(validateAnswer({ input: "Big Papi" }, criteria("hr-300"), index).playerId).toBe("ortizda01");
    expect(validateAnswer({ input: "A-Rod" }, criteria("mariners"), index).playerId).toBe("rodrial01");
    expect(validateAnswer({ input: "Goose Gossage" }, criteria("hall-of-fame"), index).playerId).toBe("gossari01");
    expect(validateAnswer({ input: "Ichiro" }, criteria("mariners"), index).playerId).toBe("suzukic01");
    expect(validateAnswer({ input: "JJ Putz" }, criteria("mariners"), index).playerId).toBe("putzjj01");
  });

  it("distinguishes players with identical names via suffix aliases", () => {
    expect(validateAnswer({ input: "Ken Griffey Jr." }, criteria("hr-300"), index)).toMatchObject({
      status: "valid",
      playerId: "griffke02",
    });
    expect(validateAnswer({ input: "Ken Griffey Sr" }, criteria("hr-300"), index)).toMatchObject({
      status: "invalid",
      playerId: "griffke01",
    });
  });

  it("credits a shared name when exactly one namesake qualifies, and says so", () => {
    // Three MLB players are named Randy Johnson; only one won a Cy Young.
    const result = validateAnswer({ input: "Randy Johnson" }, criteria("cy-young"), index);
    expect(result).toMatchObject({ status: "valid", playerId: "johnsra05" });
    expect(result.reason).toMatch(/3 players match/);
  });

  it("rejects a shared name when no namesake qualifies", () => {
    // Pete Rose and his son Pete Rose Jr. — neither is in the Hall of Fame.
    const result = validateAnswer({ input: "Pete Rose" }, criteria("hall-of-fame"), index);
    expect(result).toMatchObject({ status: "invalid", valid: false });
    expect(result.playerId).toBeUndefined();
  });

  it("asks the user to choose when several namesakes qualify instead of guessing", () => {
    const result = validateAnswer({ input: "Ken Griffey" }, criteria("mariners"), index);
    expect(result.status).toBe("ambiguous");
    expect(result.valid).toBe(false);
    expect(result.candidates?.map((c) => c.id).sort()).toEqual(["griffke01", "griffke02"]);
  });

  it("accepts an exact playerId from a disambiguation choice", () => {
    const result = validateAnswer({ playerId: "griffke01" }, criteria("mariners"), index);
    expect(result).toMatchObject({ status: "valid", playerId: "griffke01" });
  });

  it("accepts a unique surname but asks when several players with a surname qualify", () => {
    expect(validateAnswer({ input: "Ohtani" }, criteria("mvp"), index).playerId).toBe("ohtansh01");
    const smith = validateAnswer({ input: "Smith" }, criteria("yankees"), index);
    expect(smith.status).toBe("ambiguous");
    expect(smith.candidates!.length).toBeLessThanOrEqual(8);
  });

  it("never treats an unknown playerId as a match", () => {
    expect(validateAnswer({ playerId: "nobody99" }, criteria("mvp"), index).status).toBe("not-found");
  });

  it("covers every configured question", () => {
    for (const question of QUESTIONS) {
      expect(() => validateAnswer({ input: "Babe Ruth" }, question.criteria, index)).not.toThrow();
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
    // Spot-check that known totals come straight from Lahman.
    expect(index.getById("ruthba01")).toMatchObject({ hr: 714, hits: 2873, hof: 1936 });
    expect(index.getById("aaronha01")).toMatchObject({ hr: 755, hits: 3771 });
  });
});

describe("search (autocomplete)", () => {
  it("ranks prefix matches and well-known players first", () => {
    const results = index.search("griffey");
    expect(results[0].id).toBe("griffke02");
    expect(results.map((r) => r.id)).toContain("griffke01");
  });

  it("treats first- and last-name prefixes equally, ranking by prominence", () => {
    expect(index.search("griff")[0].id).toBe("griffke02");
  });

  it("matches on later name tokens and aliases", () => {
    expect(index.search("buhn")[0].id).toBe("buhneja01");
    expect(index.search("big pa")[0].id).toBe("ortizda01");
  });

  it("requires at least two characters", () => {
    expect(index.search("a")).toEqual([]);
  });
});
