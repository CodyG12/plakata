import { describe, expect, it } from "vitest";
import { QUESTION_BANK } from "@/data/question-bank";
import { questionCriteriaSchema, type BaseballPlayer, type QuestionCriteria } from "@/types/baseball";
import { checkCriteria, playedInSeason } from "./criteria";
import { getPlayerIndex } from "./dataset";

const index = getPlayerIndex();
const meets = (id: string, criteria: QuestionCriteria) => {
  const player = index.getById(id);
  if (!player) throw new Error(`missing ${id}`);
  return checkCriteria(player, criteria, index).met;
};
const bank = (slug: string) => QUESTION_BANK.find((q) => q.slug === slug)!.criteria;

/** A synthetic player for edge cases (not a real person). */
const fake = (over: Partial<BaseballPlayer>): BaseballPlayer => ({
  id: "fake01",
  name: "Test Player",
  lastName: "Player",
  firstYear: 1990,
  lastYear: 1995,
  seasons: [[1990, 1992], [1995, 1995]],
  games: 300,
  teams: ["SEA"],
  franchises: ["SEA"],
  positions: { c: 99, "1b": 150 },
  career: { homeRuns: 10, hits: 200 },
  bestSeason: { homeRuns: 6, hits: 90 },
  mvp: [],
  cyYoung: [],
  hof: null,
  allStar: [],
  wsTitles: [],
  birthCountry: null,
  birthState: null,
  ...over,
});

describe("team and franchise criteria", () => {
  it("a franchise covers every city and name in its history", () => {
    expect(meets("robinja02", bank("franchise-dodgers"))).toBe(true); // Jackie Robinson: Brooklyn
    expect(meets("aaronha01", bank("franchise-braves"))).toBe(true); // Milwaukee and Atlanta
  });

  it("a team name covers only that team, not the whole franchise", () => {
    expect(meets("guerrvl01", bank("team-expos"))).toBe(true); // Vladimir Guerrero, Montreal
    expect(meets("guerrvl01", { type: "franchise", franchiseId: "WSN" })).toBe(true);
    expect(meets("robinja02", { type: "team", teamIds: ["LAN"] })).toBe(false); // Brooklyn only
  });
});

describe("position criteria", () => {
  it("counts regular-season games at the position against the minimum", () => {
    expect(meets("benchjo01", bank("pos-catcher-100"))).toBe(true);
    expect(meets("ruthba01", bank("pos-catcher-100"))).toBe(false);
    expect(meets("ruthba01", { type: "position", position: "p", minimumGames: 100 })).toBe(true);
    expect(checkCriteria(fake({}), { type: "position", position: "c", minimumGames: 100 }, index).met).toBe(false); // 99 games
    expect(checkCriteria(fake({}), { type: "position", position: "c", minimumGames: 99 }, index).met).toBe(true);
  });
});

describe("season and era criteria", () => {
  it("uses the actual seasons played, including gaps", () => {
    const p = fake({});
    expect(playedInSeason(p, 1993, 1994)).toBeNull();
    expect(playedInSeason(p, 1993, 1995)).toBe(1995);
    expect(checkCriteria(p, { type: "season", from: 1990, to: 1999 }, index).met).toBe(true);
    expect(checkCriteria(p, { type: "season", from: 1994, to: 1994 }, index).met).toBe(false);
  });

  it("matches real careers", () => {
    expect(meets("aaronha01", bank("season-1975"))).toBe(true);
    expect(meets("willite01", bank("debut-before-1950"))).toBe(true);
    expect(meets("mantlmi01", bank("debut-before-1950"))).toBe(false); // debuted 1951
  });
});

describe("statistical thresholds", () => {
  it("separates career totals from single seasons", () => {
    expect(meets("marisro01", bank("season-hr-50"))).toBe(true);
    expect(meets("marisro01", bank("hr-500"))).toBe(false);
    expect(meets("ryanno01", bank("strikeouts-3000"))).toBe(true);
  });

  it("a player with no pitching record never meets a pitching threshold", () => {
    const aaron = index.getById("aaronha01")!;
    expect(aaron.career.wins).toBeUndefined();
    expect(checkCriteria(aaron, bank("wins-200"), index)).toMatchObject({ met: false });
  });
});

describe("All-Star and World Series criteria", () => {
  it("counts All-Star selections by season and by year", () => {
    expect(meets("griffke02", bank("all-star-1998"))).toBe(true);
    expect(meets("aaronha01", bank("all-star-5"))).toBe(true);
    expect(checkCriteria(fake({ allStar: [1990, 1991, 1992, 1993] }), bank("all-star-5"), index).met).toBe(false);
  });

  it("counts World Series titles by appearance for the winner", () => {
    expect(meets("ortizda01", bank("ws-2004-red-sox"))).toBe(true);
    expect(meets("ortizda01", bank("ws-champion-2"))).toBe(true);
    expect(meets("ortizda01", bank("ws-2016-cubs"))).toBe(false);
    expect(checkCriteria(fake({ wsTitles: [1990] }), bank("ws-champion-2"), index).met).toBe(false);
  });
});

describe("birthplace criteria", () => {
  it("matches country and state", () => {
    expect(meets("suzukic01", bank("born-japan"))).toBe(true);
    expect(meets("willite01", bank("born-california"))).toBe(true);
    expect(meets("suzukic01", bank("born-california"))).toBe(false);
  });

  it("outside the US and its territories excludes Puerto Rico", () => {
    expect(meets("suzukic01", bank("born-outside-us"))).toBe(true);
    expect(meets("clemero01", bank("born-outside-us"))).toBe(false); // born in Puerto Rico
    expect(meets("clemero01", bank("born-puerto-rico"))).toBe(true);
  });

  it("an unknown birthplace never qualifies, even for an exclusion rule", () => {
    const unknown = index.all().find((p) => p.birthCountry === null)!;
    expect(unknown).toBeDefined();
    expect(checkCriteria(unknown, bank("born-outside-us"), index).met).toBe(false);
    expect(checkCriteria(unknown, bank("born-japan"), index).met).toBe(false);
  });
});

describe("question bank", () => {
  it("every definition is a valid criteria object with a unique slug and an eligible pick", () => {
    const slugs = new Set<string>();
    for (const q of QUESTION_BANK) {
      expect(() => questionCriteriaSchema.parse(q.criteria), q.slug).not.toThrow();
      expect(slugs.has(q.slug), q.slug).toBe(false);
      slugs.add(q.slug);
      expect(meets(q.plakataPick, q.criteria), `${q.slug} pick ${q.plakataPick}`).toBe(true);
    }
  });

  it("rejects malformed criteria", () => {
    expect(() => questionCriteriaSchema.parse({ type: "position", position: "xx", minimumGames: 1 })).toThrow();
    expect(() => questionCriteriaSchema.parse({ type: "birthplace", state: "CA" })).toThrow();
    expect(() => questionCriteriaSchema.parse({ type: "stat_threshold", stat: "homeRuns", scope: "career", operator: "<", value: 1 })).toThrow();
    expect(() => questionCriteriaSchema.parse({ type: "team", teamIds: [], extra: 1 })).toThrow();
  });

  it("covers all seven requested categories with enough answers to be playable", () => {
    const types = new Set(QUESTION_BANK.map((q) => q.criteria.type));
    for (const t of ["team", "franchise", "position", "season", "debut", "stat_threshold", "all_star", "world_series_champion", "birthplace"]) {
      expect(types.has(t as QuestionCriteria["type"]), t).toBe(true);
    }
  });
});
