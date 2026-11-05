import { describe, expect, it } from "vitest";
import { QUESTION_BANK } from "@/data/question-bank";
import { checkCriteria } from "@/lib/baseball/criteria";
import { getPlayerIndex } from "@/lib/baseball/dataset";
import type { BaseballPlayer, QuestionCriteria } from "@/types/baseball";
import { rankingConfigFor, rankPlayers, topFiveIds, type RankingConfig } from "./ranking";

const index = getPlayerIndex();
const bank = (slug: string) => QUESTION_BANK.find((q) => q.slug === slug)!;
const eligible = (criteria: QuestionCriteria) => index.all().filter((p) => checkCriteria(p, criteria, index).met);
const names = (ids: string[]) => ids.map((id) => index.getById(id)!.name).sort();

/** Synthetic players for edge cases (not real people). */
const fake = (id: string, career: BaseballPlayer["career"], bestSeason: BaseballPlayer["bestSeason"] = {}): BaseballPlayer => ({
  id,
  name: id,
  lastName: id,
  firstYear: 2000,
  lastYear: 2001,
  seasons: [[2000, 2001]],
  games: 200,
  teams: [],
  franchises: [],
  positions: {},
  career,
  bestSeason,
  mvp: [],
  cyYoung: [],
  hof: null,
  allStar: [],
  wsTitles: [],
  birthCountry: null,
  birthState: null,
});
const HR_CAREER: RankingConfig = { stat: "homeRuns", scope: "career", direction: "desc" };

describe("Top-5 rankings from the dataset", () => {
  it("career home runs: the five all-time leaders", () => {
    const q = bank("hr-300");
    const ranked = rankPlayers(eligible(q.criteria), rankingConfigFor(q.criteria)!);
    expect(names(topFiveIds(ranked))).toEqual(["Albert Pujols", "Alex Rodriguez", "Babe Ruth", "Barry Bonds", "Hank Aaron"]);
    expect(ranked.slice(0, 5).map((r) => r.value)).toEqual([762, 755, 714, 703, 696]);
  });

  it("single-season questions rank distinct players by their best season, not career totals", () => {
    const q = bank("season-hr-40");
    const config = rankingConfigFor(q.criteria)!;
    expect(config).toMatchObject({ stat: "homeRuns", scope: "season" });
    const top = topFiveIds(rankPlayers(eligible(q.criteria), config));
    expect(names(top)).toEqual(["Aaron Judge", "Barry Bonds", "Mark McGwire", "Roger Maris", "Sammy Sosa"]);
    expect(top).not.toContain("aaronha01"); // 755 career HR, but never 62+ in a season
  });

  it("ranks only the question's eligible players (filters respected)", () => {
    // Same stat, a filtered population: the top five Mariners by career HR are not the all-time five.
    const mariners = eligible(bank("mariners").criteria);
    const top = topFiveIds(rankPlayers(mariners, HR_CAREER));
    expect(top).toHaveLength(5);
    expect(top.every((id) => mariners.some((p) => p.id === id))).toBe(true);
    expect(top).not.toContain("aaronha01");
  });

  it("only statistical questions have a ranking", () => {
    for (const slug of ["yankees", "mariners", "hall-of-fame", "mvp", "born-japan", "pos-catcher-100", "all-star", "ws-champion", "era-1990s"]) {
      expect(rankingConfigFor(bank(slug).criteria), slug).toBeNull();
    }
    for (const q of QUESTION_BANK.filter((q) => q.criteria.type === "stat_threshold")) {
      expect(rankingConfigFor(q.criteria), q.slug).not.toBeNull();
    }
  });

  it("no Plákata pick is one of its question's top-five leaders", () => {
    for (const q of QUESTION_BANK) {
      const config = rankingConfigFor(q.criteria);
      if (!config) continue;
      expect(topFiveIds(rankPlayers(eligible(q.criteria), config)), q.slug).not.toContain(q.plakataPick);
    }
  });
});

describe("ranking policy (synthetic players)", () => {
  it("uses competition ranking and includes every player tied at fifth", () => {
    const players = [
      fake("a", { homeRuns: 50 }),
      fake("b", { homeRuns: 40 }),
      fake("c", { homeRuns: 40 }),
      fake("d", { homeRuns: 30 }),
      fake("e", { homeRuns: 20 }),
      fake("f", { homeRuns: 20 }),
      fake("g", { homeRuns: 20 }),
      fake("h", { homeRuns: 10 }),
    ];
    const ranked = rankPlayers(players, HR_CAREER);
    expect(ranked.map((r) => [r.playerId, r.rank])).toEqual([
      ["a", 1], ["b", 2], ["c", 2], ["d", 4], ["e", 5], ["f", 5], ["g", 5], ["h", 8],
    ]);
    expect(topFiveIds(ranked)).toEqual(["a", "b", "c", "d", "e", "f", "g"]); // 7 players: three tied at fifth
  });

  it("a tie just past fifth place is not included", () => {
    const players = ["a", "b", "c", "d", "e", "f", "g"].map((id, i) => fake(id, { homeRuns: i < 5 ? 100 - i : 50 }));
    expect(topFiveIds(rankPlayers(players, HR_CAREER))).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("skips players with no recorded value (never treated as zero)", () => {
    const players = [fake("a", { homeRuns: 5 }), fake("b", {}), fake("c", { homeRuns: 1 })];
    expect(rankPlayers(players, HR_CAREER).map((r) => r.playerId)).toEqual(["a", "c"]);
  });

  it("career vs season scope read different numbers", () => {
    const players = [fake("steady", { homeRuns: 500 }, { homeRuns: 35 }), fake("peak", { homeRuns: 300 }, { homeRuns: 60 })];
    expect(rankPlayers(players, HR_CAREER)[0].playerId).toBe("steady");
    expect(rankPlayers(players, { ...HR_CAREER, scope: "season" })[0].playerId).toBe("peak");
  });

  it("lower-is-better stats need a qualifier, and unqualified players are not ranked", () => {
    expect(() => rankPlayers([], { stat: "saves", scope: "career", direction: "asc" })).toThrow(/qualification/);
    // Stand-in for a rate stat: rank "saves" ascending among players with ≥ 100 wins.
    const config: RankingConfig = { stat: "saves", scope: "career", direction: "asc", qualifier: { stat: "wins", min: 100 } };
    const players = [fake("tiny", { saves: 0, wins: 2 }), fake("x", { saves: 5, wins: 150 }), fake("y", { saves: 3, wins: 120 })];
    expect(rankPlayers(players, config).map((r) => r.playerId)).toEqual(["y", "x"]);
  });

  it("is deterministic regardless of input order", () => {
    const players = ["q", "w", "e", "r", "t", "y"].map((id) => fake(id, { homeRuns: 7 }));
    const a = rankPlayers(players, HR_CAREER);
    const b = rankPlayers([...players].reverse(), HR_CAREER);
    expect(a).toEqual(b);
    expect(a.every((r) => r.rank === 1 && r.buntOverride)).toBe(true);
  });
});
