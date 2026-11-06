#!/usr/bin/env node
/**
 * Builds src/data/players.json from the SABR Lahman Baseball Database CSVs.
 *
 * Usage: node scripts/build-dataset.mjs <lahman-csv-dir>
 *
 * Everything in the output is derived directly from Lahman tables — no stats,
 * awards, rosters, or birthplaces are hand-entered here. Curated *aliases* and
 * *rarity priors* live in separate TypeScript files under src/data/.
 *
 * Unknown values are omitted or null, never coerced to 0: a player with no
 * pitching rows has no pitching stats, not zero wins.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const inputDir = process.argv[2];
if (!inputDir) {
  console.error("usage: node scripts/build-dataset.mjs <lahman-csv-dir>");
  process.exit(1);
}
const outFile = resolve(import.meta.dirname, "../src/data/players.json");

/** Lahman CSVs are unquoted, comma-delimited, CRLF, UTF-8 (sometimes with BOM). */
function readCsv(name) {
  const text = readFileSync(join(inputDir, name), "utf8").replace(/^﻿/, "");
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const header = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    if (cells.length !== header.length) {
      throw new Error(`${name}: expected ${header.length} columns, got ${cells.length}: ${line}`);
    }
    return Object.fromEntries(header.map((h, i) => [h, cells[i]]));
  });
}

const intOrNull = (s) => (s === "" || s === undefined ? null : Number.parseInt(s, 10));
const getOrInit = (map, key, init) => {
  let value = map.get(key);
  if (value === undefined) {
    value = init();
    map.set(key, value);
  }
  return value;
};

// --- Teams: (year, teamID) -> franchise, and display names ------------------
const franchiseOf = new Map(); // `${year}|${teamID}` -> franchID
const teamNames = {};
const teamLastYear = {};
for (const row of readCsv("Teams.csv")) {
  const year = Number(row.yearID);
  franchiseOf.set(`${year}|${row.teamID}`, row.franchID);
  if (!(row.teamID in teamLastYear) || year >= teamLastYear[row.teamID]) {
    teamLastYear[row.teamID] = year;
    teamNames[row.teamID] = row.name;
  }
}
const franchiseNames = {};
for (const row of readCsv("TeamsFranchises.csv")) franchiseNames[row.franchID] = row.franchName;

// --- Appearances: teams, franchises, seasons, positions ----------------------
// Positions use the regular-season Appearances table (games at each position).
const POSITION_COLUMNS = {
  p: "G_p",
  c: "G_c",
  "1b": "G_1b",
  "2b": "G_2b",
  "3b": "G_3b",
  ss: "G_ss",
  lf: "G_lf",
  cf: "G_cf",
  rf: "G_rf",
  of: "G_of",
  dh: "G_dh",
};
const played = new Map();
for (const row of readCsv("Appearances.csv")) {
  const year = Number(row.yearID);
  const entry = getOrInit(played, row.playerID, () => ({
    teamGames: new Map(),
    franchises: new Set(),
    seasons: new Set(),
    positions: {},
    games: 0,
  }));
  const g = intOrNull(row.G_all) ?? 0;
  entry.teamGames.set(row.teamID, (entry.teamGames.get(row.teamID) ?? 0) + g);
  const franchise = franchiseOf.get(`${year}|${row.teamID}`);
  if (!franchise) throw new Error(`Appearances: no Teams row for ${row.teamID} in ${year}`);
  entry.franchises.add(franchise);
  entry.seasons.add(year);
  entry.games += g;
  for (const [pos, column] of Object.entries(POSITION_COLUMNS)) {
    const n = intOrNull(row[column]);
    if (n) entry.positions[pos] = (entry.positions[pos] ?? 0) + n;
  }
}

// --- Batting and pitching: career totals and best single season -------------
// Season totals sum every stint (team) within the season before taking the max.
// `bestFrom` (when `fromYear` is given) holds the best season at or after that year,
// but only for players with at least one season before it; for everyone else it
// would just repeat `best`. A player whose seasons are all earlier gets {}.
function accumulate(file, columns, fromYear) {
  const career = new Map(); // playerID -> { stat: total }
  const seasons = new Map(); // `${playerID}|${year}` -> { stat: total }
  for (const row of readCsv(file)) {
    const totals = getOrInit(career, row.playerID, () => ({}));
    const season = getOrInit(seasons, `${row.playerID}|${row.yearID}`, () => ({}));
    for (const [stat, column] of Object.entries(columns)) {
      const n = intOrNull(row[column]);
      if (n === null) continue;
      totals[stat] = (totals[stat] ?? 0) + n;
      season[stat] = (season[stat] ?? 0) + n;
    }
  }
  const best = new Map();
  const bestFrom = new Map();
  const before = new Set(); // players with a season before fromYear
  for (const [key, season] of seasons) {
    const id = key.slice(0, key.indexOf("|"));
    const year = Number(key.slice(key.indexOf("|") + 1));
    const b = getOrInit(best, id, () => ({}));
    for (const [stat, n] of Object.entries(season)) b[stat] = Math.max(b[stat] ?? 0, n);
    if (fromYear === undefined) continue;
    if (year < fromYear) {
      before.add(id);
      continue;
    }
    const f = getOrInit(bestFrom, id, () => ({}));
    for (const [stat, n] of Object.entries(season)) f[stat] = Math.max(f[stat] ?? 0, n);
  }
  const bestFromEarly = new Map([...before].map((id) => [id, bestFrom.get(id) ?? {}]));
  return { career, best, bestFrom: bestFromEarly };
}
const batting = accumulate("Batting.csv", { homeRuns: "HR", hits: "H", runsBattedIn: "RBI", stolenBases: "SB" });
// 1893: the pitching distance moved to 60'6". Top-5 rankings of single-season
// pitching stats count only seasons from then on (see src/lib/questions/ranking.ts).
const PITCHING_SEASON_FLOOR = 1893;
const pitching = accumulate("Pitching.csv", { wins: "W", pitcherStrikeouts: "SO", saves: "SV" }, PITCHING_SEASON_FLOOR);

// --- Awards -------------------------------------------------------------------
const mvp = new Map();
const cyYoung = new Map();
const push = (map, id, year) => map.set(id, [...(map.get(id) ?? []), year]);
for (const row of readCsv("AwardsPlayers.csv")) {
  if (row.awardID === "Most Valuable Player") push(mvp, row.playerID, Number(row.yearID));
  if (row.awardID === "Cy Young Award") push(cyYoung, row.playerID, Number(row.yearID));
}

// --- Hall of Fame (inducted as a Player only) --------------------------------
const hof = new Map();
for (const row of readCsv("HallOfFame.csv")) {
  if (row.inducted === "Y" && row.category === "Player") hof.set(row.playerID, Number(row.yearid));
}

// --- All-Star selections ---------------------------------------------------------
// A selection = listed on an All-Star roster that season (AllstarFull), whether or
// not the player got into the game (GP). Seasons with two games count once.
const allStar = new Map();
for (const row of readCsv("AllstarFull.csv")) {
  getOrInit(allStar, row.playerID, () => new Set()).add(Number(row.yearID));
}

// --- World Series titles ----------------------------------------------------------
// Lahman has no championship rosters. A title counts when the player APPEARED in a
// modern World Series game (1903+, round "WS") for the winning team, per the
// postseason batting, pitching, or fielding tables. Roster members who never got
// into a World Series game are not counted.
const MODERN_WS_FIRST_YEAR = 1903;
const wsWinner = new Map();
for (const row of readCsv("SeriesPost.csv")) {
  if (row.round === "WS" && Number(row.yearID) >= MODERN_WS_FIRST_YEAR) wsWinner.set(row.yearID, row.teamIDwinner);
}
const wsTitles = new Map();
for (const file of ["BattingPost.csv", "PitchingPost.csv", "FieldingPost.csv"]) {
  for (const row of readCsv(file)) {
    if (row.round !== "WS" || wsWinner.get(row.yearID) !== row.teamID) continue;
    if ((intOrNull(row.G) ?? 0) <= 0) continue;
    getOrInit(wsTitles, row.playerID, () => new Set()).add(Number(row.yearID));
  }
}

// --- People -------------------------------------------------------------------
/** [1990, 1991, 1992, 1995] -> [[1990, 1992], [1995, 1995]] */
function toRanges(years) {
  const ranges = [];
  for (const y of years) {
    const last = ranges[ranges.length - 1];
    if (last && y === last[1] + 1) last[1] = y;
    else ranges.push([y, y]);
  }
  return ranges;
}
const sorted = (set) => [...(set ?? [])].sort((a, b) => a - b);
const players = [];
let missingBatting = 0;
let missingBirthCountry = 0;
for (const person of readCsv("People.csv")) {
  const appearance = played.get(person.playerID);
  if (!appearance) continue; // non-players (executives, umpires, etc.)

  const name = [person.nameFirst, person.nameLast].filter(Boolean).join(" ").trim();
  if (!name) continue;

  const bat = batting.career.get(person.playerID);
  if (!bat) missingBatting++;
  const pit = pitching.career.get(person.playerID);
  if (!person.birthCountry) missingBirthCountry++;
  const seasons = sorted(appearance.seasons);

  players.push({
    id: person.playerID,
    name,
    // Lahman's surname field, so multi-word surnames ("De La Rosa") match as a unit.
    lastName: person.nameLast,
    firstYear: seasons[0],
    lastYear: seasons[seasons.length - 1],
    // Seasons with an appearance, as inclusive [first, last] runs: [[1997, 2016]].
    seasons: toRanges(seasons),
    games: appearance.games,
    // Ordered by games played for the team (most first), ties by teamID.
    teams: [...appearance.teamGames.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([teamID]) => teamID),
    franchises: [...appearance.franchises].sort(),
    positions: appearance.positions,
    career: { ...bat, ...pit },
    bestSeason: { ...batting.best.get(person.playerID), ...pitching.best.get(person.playerID) },
    // Only for pitchers with a pre-1893 season: their best pitching season from 1893 on.
    ...(pitching.bestFrom.has(person.playerID) ? { bestPitchingSeasonFrom1893: pitching.bestFrom.get(person.playerID) } : {}),
    mvp: (mvp.get(person.playerID) ?? []).sort((a, b) => a - b),
    cyYoung: (cyYoung.get(person.playerID) ?? []).sort((a, b) => a - b),
    hof: hof.get(person.playerID) ?? null,
    allStar: sorted(allStar.get(person.playerID)),
    wsTitles: sorted(wsTitles.get(person.playerID)),
    birthCountry: person.birthCountry || null,
    birthState: person.birthState || null,
  });
}
players.sort((a, b) => a.id.localeCompare(b.id));

// Sanity checks: every award, All-Star, title and HOF entry points at a player we kept.
const kept = new Set(players.map((p) => p.id));
for (const [label, map] of [
  ["MVP", mvp],
  ["Cy Young", cyYoung],
  ["HOF", hof],
  ["All-Star", allStar],
  ["World Series", wsTitles],
]) {
  const orphans = [...map.keys()].filter((id) => !kept.has(id));
  if (orphans.length) console.warn(`${label}: ${orphans.length} entries without appearances:`, orphans);
}

const output = {
  meta: {
    source: "SABR Lahman Baseball Database",
    sourceUrl: "https://sabr.org/lahman-database/",
    release: "1871-2025 (released 2025-12-10)",
    license: "CC BY-SA 3.0",
    playerCount: players.length,
  },
  teams: Object.fromEntries(Object.entries(teamNames).sort()),
  franchises: Object.fromEntries(Object.entries(franchiseNames).sort()),
  players,
};

writeFileSync(outFile, JSON.stringify(output));
const count = (fn) => players.filter(fn).length;
console.log(`Wrote ${players.length} players to ${outFile}`);
console.log(`  without batting rows: ${missingBatting}`);
console.log(`  without a birth country: ${missingBirthCountry}`);
console.log(`  300+ HR: ${count((p) => (p.career.homeRuns ?? 0) >= 300)}`);
console.log(`  2000+ hits: ${count((p) => (p.career.hits ?? 0) >= 2000)}`);
console.log(`  200+ wins: ${count((p) => (p.career.wins ?? 0) >= 200)}`);
console.log(`  All-Stars: ${count((p) => p.allStar.length > 0)}`);
console.log(`  World Series champions (appeared): ${count((p) => p.wsTitles.length > 0)}`);
console.log(`  MVP winners: ${count((p) => p.mvp.length > 0)}`);
console.log(`  Cy Young winners: ${count((p) => p.cyYoung.length > 0)}`);
console.log(`  Hall of Famers (Player): ${count((p) => p.hof !== null)}`);
console.log(`  Yankees (NYA): ${count((p) => p.teams.includes("NYA"))}`);
console.log(`  Mariners (SEA): ${count((p) => p.teams.includes("SEA"))}`);
