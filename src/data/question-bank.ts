import type { QuestionCriteria } from "@/types/baseball";

/**
 * The question bank. Each entry is synced into the database by
 * `npm run plakata -- questions:sync`, which computes its eligibility set from
 * players.json (Lahman) and stores it as an immutable question VERSION.
 * Changing a prompt or criteria here creates a new version on the next sync;
 * past rounds keep pointing at the version they were played with.
 *
 * Rules for adding a question:
 *  - `slug` is permanent. Never reuse one for a different question.
 *  - The prompt must state the rule the criteria enforce (e.g. "at least 100 games").
 *  - `plakataPick` is the ONE answer that always scores a Plákata (100). It must be
 *    eligible; the sync refuses otherwise.
 *  - Never hand-enter facts: eligibility comes from the dataset only.
 *
 * Plákata picks marked "rule pick" were chosen by a documented rule: the fewest career
 * games among eligible, retired players with at least 100 career games who aren't
 * already another question's pick. "Hand pick" marks small, star-only pools where that
 * rule lands on a household name. Picks for the original seven were hand-chosen in v1.
 * All picks were reviewed on 2026-11-05. Tests enforce: each pick is eligible, no
 * player is the pick for two questions, and no pick is still active.
 */
export interface QuestionDefinition {
  slug: string;
  prompt: string;
  criteria: QuestionCriteria;
  plakataPick: string;
  /** Disabled questions stay in the database (history) but are never selected. */
  active?: boolean;
}

export const QUESTION_BANK: readonly QuestionDefinition[] = [
  // --- The original seven (v1), unchanged ----------------------------------------
  {
    slug: "hr-300",
    prompt: "Name an MLB player with at least 300 career home runs.",
    criteria: { type: "stat_threshold", stat: "homeRuns", scope: "career", operator: ">=", value: 300 },
    plakataPick: "sexsori01", // Richie Sexson
  },
  {
    slug: "mvp",
    prompt: "Name an MLB player who has won an MVP award.",
    criteria: { type: "award", award: "mvp" },
    plakataPick: "chandsp01", // Spud Chandler
  },
  {
    slug: "yankees",
    prompt: "Name an MLB player who has played for the New York Yankees.",
    criteria: { type: "team", teamIds: ["NYA"] },
    plakataPick: "meulehe01", // Hensley Meulens
  },
  {
    slug: "hits-2000",
    prompt: "Name an MLB player with at least 2,000 career hits.",
    criteria: { type: "stat_threshold", stat: "hits", scope: "career", operator: ">=", value: 2000 },
    plakataPick: "whitede01", // Deacon White
  },
  {
    slug: "cy-young",
    prompt: "Name an MLB player who has won a Cy Young Award.",
    criteria: { type: "award", award: "cyYoung" },
    plakataPick: "hoytla01", // LaMarr Hoyt
  },
  {
    slug: "mariners",
    prompt: "Name an MLB player who has played for the Seattle Mariners.",
    criteria: { type: "team", teamIds: ["SEA"] },
    plakataPick: "brantmi01", // Mickey Brantley
  },
  {
    slug: "hall-of-fame",
    prompt: "Name an MLB player inducted into the National Baseball Hall of Fame.",
    criteria: { type: "hall_of_fame" },
    plakataPick: "grantfr99", // Frank Grant
  },

  // --- Teams and franchises -------------------------------------------------------
  {
    slug: "franchise-dodgers",
    prompt: "Name an MLB player who played for the Dodgers franchise, in Brooklyn or Los Angeles.",
    criteria: { type: "franchise", franchiseId: "LAD" },
    plakataPick: "coveydy01", // Dylan Covey (rule pick)
  },
  {
    slug: "franchise-braves",
    prompt: "Name an MLB player who played for the Braves franchise, in Boston, Milwaukee, or Atlanta.",
    criteria: { type: "franchise", franchiseId: "ATL" },
    plakataPick: "nichoro02", // Rod Nichols (rule pick)
  },
  {
    slug: "franchise-athletics",
    prompt: "Name an MLB player who played for the Athletics franchise, in Philadelphia, Kansas City, Oakland, or Sacramento.",
    criteria: { type: "franchise", franchiseId: "OAK" },
    plakataPick: "adamsmi02", // Mike Adams (rule pick)
  },
  {
    slug: "team-expos",
    prompt: "Name an MLB player who played for the Montreal Expos.",
    criteria: { type: "team", teamIds: ["MON"] },
    plakataPick: "haneyto01", // Todd Haney (rule pick)
  },
  {
    slug: "franchise-cubs",
    prompt: "Name an MLB player who played for the Chicago Cubs franchise.",
    criteria: { type: "franchise", franchiseId: "CHC" },
    plakataPick: "breweco01", // Colten Brewer (rule pick)
  },

  // --- Positions (regular-season games at the position, per Lahman Appearances) ----
  {
    slug: "pos-catcher-100",
    prompt: "Name an MLB player who played at least 100 career games at catcher.",
    criteria: { type: "position", position: "c", minimumGames: 100 },
    plakataPick: "mizerjo01", // John Mizerock (rule pick)
  },
  {
    slug: "pos-shortstop-100",
    prompt: "Name an MLB player who played at least 100 career games at shortstop.",
    criteria: { type: "position", position: "ss", minimumGames: 100 },
    plakataPick: "gagnied01", // Ed Gagnier (rule pick)
  },
  {
    slug: "pos-center-field-100",
    prompt: "Name an MLB player who played at least 100 career games in center field.",
    criteria: { type: "position", position: "cf", minimumGames: 100 },
    plakataPick: "caseyde01", // Dennis Casey (rule pick)
  },

  // --- Seasons and eras ------------------------------------------------------------
  {
    slug: "era-1990s",
    prompt: "Name an MLB player who appeared in a game during the 1990s (1990–1999).",
    criteria: { type: "season", from: 1990, to: 1999 },
    plakataPick: "jonesbo04", // Bobby Jones (rule pick)
  },
  {
    slug: "season-1975",
    prompt: "Name an MLB player who appeared in a game during the 1975 season.",
    criteria: { type: "season", from: 1975, to: 1975 },
    plakataPick: "alburvi01", // Vic Albury (rule pick)
  },
  {
    slug: "debut-before-1950",
    prompt: "Name an MLB player whose major league career began before 1950.",
    criteria: { type: "debut", before: 1950 },
    plakataPick: "bigelel01", // Elliot Bigelow (rule pick)
  },

  // --- Statistical thresholds (Lahman Batting / Pitching) --------------------------
  {
    slug: "hr-500",
    prompt: "Name an MLB player with at least 500 career home runs.",
    criteria: { type: "stat_threshold", stat: "homeRuns", scope: "career", operator: ">=", value: 500 },
    plakataPick: "matheed01", // Eddie Mathews (hand pick: the rule lands on Mark McGwire)
  },
  {
    slug: "hits-3000",
    prompt: "Name an MLB player with at least 3,000 career hits.",
    criteria: { type: "stat_threshold", stat: "hits", scope: "career", operator: ">=", value: 3000 },
    plakataPick: "wanerpa01", // Paul Waner (hand pick: the rule lands on Roberto Clemente)
  },
  {
    slug: "wins-200",
    prompt: "Name a pitcher with at least 200 career wins.",
    criteria: { type: "stat_threshold", stat: "wins", scope: "career", operator: ">=", value: 200 },
    plakataPick: "whitewi01", // Will White (rule pick)
  },
  {
    slug: "strikeouts-3000",
    prompt: "Name a pitcher with at least 3,000 career strikeouts.",
    criteria: { type: "stat_threshold", stat: "pitcherStrikeouts", scope: "career", operator: ">=", value: 3000 },
    plakataPick: "suttodo01", // Don Sutton (hand pick: the rule lands on Clayton Kershaw)
  },
  {
    slug: "saves-300",
    prompt: "Name a pitcher with at least 300 career saves.",
    criteria: { type: "stat_threshold", stat: "saves", scope: "career", operator: ">=", value: 300 },
    plakataPick: "jonesto02", // Todd Jones (hand pick: the rule lands on John Wetteland)
  },
  {
    slug: "steals-500",
    prompt: "Name an MLB player with at least 500 career stolen bases.",
    criteria: { type: "stat_threshold", stat: "stolenBases", scope: "career", operator: ">=", value: 500 },
    plakataPick: "donovpa01", // Patsy Donovan (hand pick: the rule lands on Vince Coleman)
  },
  {
    slug: "season-hr-40",
    prompt: "Name an MLB player who hit at least 40 home runs in a single season.",
    criteria: { type: "stat_threshold", stat: "homeRuns", scope: "season", operator: ">=", value: 40 },
    plakataPick: "hidalri01", // Richard Hidalgo (hand pick: the rule lands on an active player)
  },
  {
    slug: "season-hr-50",
    prompt: "Name an MLB player who hit at least 50 home runs in a single season.",
    criteria: { type: "stat_threshold", stat: "homeRuns", scope: "season", operator: ">=", value: 50 },
    plakataPick: "vaughgr01", // Greg Vaughn (hand pick: the rule lands on Cal Raleigh)
  },
  {
    slug: "season-wins-20",
    prompt: "Name a pitcher who won at least 20 games in a single season.",
    criteria: { type: "stat_threshold", stat: "wins", scope: "season", operator: ">=", value: 20 },
    plakataPick: "millero01", // Roscoe Miller (rule pick)
  },
  {
    slug: "season-hits-200",
    prompt: "Name an MLB player who collected at least 200 hits in a single season.",
    criteria: { type: "stat_threshold", stat: "hits", scope: "season", operator: ">=", value: 200 },
    plakataPick: "mchenau01", // Austin McHenry (rule pick)
  },

  // --- All-Star selections (named to the roster, whether or not he played) --------
  {
    slug: "all-star",
    prompt: "Name an MLB player who was selected to an All-Star team.",
    criteria: { type: "all_star", minimumSelections: 1 },
    plakataPick: "huntebe01", // Bert Hunter (rule pick)
  },
  {
    slug: "all-star-5",
    prompt: "Name an MLB player who was selected to at least five All-Star teams.",
    criteria: { type: "all_star", minimumSelections: 5 },
    plakataPick: "barnhda01", // Dave Barnhill (rule pick)
  },
  {
    slug: "all-star-1998",
    prompt: "Name an MLB player who was selected to the 1998 All-Star team.",
    criteria: { type: "all_star", minimumSelections: 1, year: 1998 },
    plakataPick: "easleda01", // Damion Easley (hand pick: small pool)
  },

  // --- World Series (appeared in a World Series game, 1903+, for the winner) ------
  {
    slug: "ws-champion",
    prompt: "Name a player who appeared in a World Series game for the team that won it.",
    criteria: { type: "world_series_champion", minimumTitles: 1 },
    plakataPick: "jurisal01", // Al Jurisich (rule pick)
  },
  {
    slug: "ws-champion-2",
    prompt: "Name a player who appeared in World Series games for at least two championship teams.",
    criteria: { type: "world_series_champion", minimumTitles: 2 },
    plakataPick: "clayke01", // Ken Clay (rule pick)
  },
  {
    slug: "ws-2004-red-sox",
    prompt: "Name a player who appeared in the 2004 World Series for the champion Boston Red Sox.",
    criteria: { type: "world_series_champion", minimumTitles: 1, year: 2004 },
    plakataPick: "reesepo01", // Pokey Reese (hand pick: small pool)
  },
  {
    slug: "ws-2016-cubs",
    prompt: "Name a player who appeared in the 2016 World Series for the champion Chicago Cubs.",
    criteria: { type: "world_series_champion", minimumTitles: 1, year: 2016 },
    plakataPick: "coghlch01", // Chris Coghlan (hand pick: small pool)
  },

  // --- Birthplace (Lahman People; unknown birthplaces never qualify) --------------
  {
    slug: "born-japan",
    prompt: "Name an MLB player born in Japan.",
    criteria: { type: "birthplace", country: "Japan" },
    plakataPick: "yabuke01", // Keiichi Yabu (rule pick)
  },
  {
    slug: "born-dominican-republic",
    prompt: "Name an MLB player born in the Dominican Republic.",
    criteria: { type: "birthplace", country: "D.R." },
    plakataPick: "merceye01", // Yermin Mercedes (rule pick)
  },
  {
    slug: "born-venezuela",
    prompt: "Name an MLB player born in Venezuela.",
    criteria: { type: "birthplace", country: "Venezuela" },
    plakataPick: "brachsi01", // Silvino Bracho (rule pick)
  },
  {
    slug: "born-cuba",
    prompt: "Name an MLB player born in Cuba.",
    criteria: { type: "birthplace", country: "Cuba" },
    plakataPick: "garcire02", // Regino García (rule pick)
  },
  {
    slug: "born-puerto-rico",
    prompt: "Name an MLB player born in Puerto Rico.",
    criteria: { type: "birthplace", country: "P.R." },
    plakataPick: "munozbo01", // Bobby Munoz (rule pick)
  },
  {
    slug: "born-canada",
    prompt: "Name an MLB player born in Canada.",
    criteria: { type: "birthplace", country: "CAN" },
    plakataPick: "murphla01", // Larry Murphy (rule pick)
  },
  {
    slug: "born-california",
    prompt: "Name an MLB player born in California.",
    criteria: { type: "birthplace", country: "USA", state: "CA" },
    plakataPick: "bertafr01", // Frank Bertaina (rule pick)
  },
  {
    slug: "born-outside-us",
    prompt: "Name an MLB player born outside the United States and its territories.",
    criteria: {
      type: "birthplace",
      excludeCountries: ["USA", "P.R.", "U.S. Virgin Islands", "Guam", "American Samoa"],
    },
    plakataPick: "cordoal01", // Allen Cordoba (rule pick)
  },
];
