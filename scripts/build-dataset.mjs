#!/usr/bin/env node
/**
 * Builds src/data/players.json from the SABR Lahman Baseball Database CSVs.
 *
 * Usage: node scripts/build-dataset.mjs <lahman-csv-dir>
 *
 * Everything in the output is derived directly from Lahman tables — no stats or
 * awards are hand-entered here. Curated *aliases* and *rarity estimates* live in
 * separate TypeScript files under src/data/.
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

// --- Appearances: who actually played, for which teams, in which seasons -----
const appearances = readCsv("Appearances.csv");
const played = new Map(); // playerID -> { teamGames: Map<teamID, games>, games, first, last }
for (const row of appearances) {
  const year = Number(row.yearID);
  let entry = played.get(row.playerID);
  if (!entry) {
    entry = { teamGames: new Map(), first: year, last: year, games: 0 };
    played.set(row.playerID, entry);
  }
  const g = intOrNull(row.G_all) ?? 0;
  entry.teamGames.set(row.teamID, (entry.teamGames.get(row.teamID) ?? 0) + g);
  entry.games += g;
  entry.first = Math.min(entry.first, year);
  entry.last = Math.max(entry.last, year);
}

// --- Batting: career hits and home runs ---------------------------------------
// A player with no batting rows gets null (unknown), never 0.
const batting = new Map(); // playerID -> { hits, hr }
for (const row of readCsv("Batting.csv")) {
  let entry = batting.get(row.playerID);
  if (!entry) {
    entry = { hits: 0, hr: 0, hitsKnown: false, hrKnown: false };
    batting.set(row.playerID, entry);
  }
  const h = intOrNull(row.H);
  const hr = intOrNull(row.HR);
  if (h !== null) {
    entry.hits += h;
    entry.hitsKnown = true;
  }
  if (hr !== null) {
    entry.hr += hr;
    entry.hrKnown = true;
  }
}

// --- Awards -----------------------------------------------------------------
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

// --- Team names (most recent name used for each teamID) ---------------------
const teamNames = {};
const teamLastYear = {};
for (const row of readCsv("Teams.csv")) {
  const year = Number(row.yearID);
  if (!(row.teamID in teamLastYear) || year >= teamLastYear[row.teamID]) {
    teamLastYear[row.teamID] = year;
    teamNames[row.teamID] = row.name;
  }
}

// --- People -----------------------------------------------------------------
const players = [];
let missingBatting = 0;
for (const person of readCsv("People.csv")) {
  const appearance = played.get(person.playerID);
  if (!appearance) continue; // non-players (executives, umpires, etc.)

  const name = [person.nameFirst, person.nameLast].filter(Boolean).join(" ").trim();
  if (!name) continue;

  const bat = batting.get(person.playerID);
  if (!bat) missingBatting++;

  players.push({
    id: person.playerID,
    name,
    // Lahman's surname field, so multi-word surnames ("De La Rosa") match as a unit.
    lastName: person.nameLast,
    firstYear: appearance.first,
    lastYear: appearance.last,
    games: appearance.games,
    // Ordered by games played for the team (most first), ties by teamID.
    teams: [...appearance.teamGames.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([teamID]) => teamID),
    hr: bat?.hrKnown ? bat.hr : null,
    hits: bat?.hitsKnown ? bat.hits : null,
    mvp: (mvp.get(person.playerID) ?? []).sort((a, b) => a - b),
    cyYoung: (cyYoung.get(person.playerID) ?? []).sort((a, b) => a - b),
    hof: hof.get(person.playerID) ?? null,
  });
}
players.sort((a, b) => a.id.localeCompare(b.id));

// Sanity checks: awards and HOF entries should all point at players we kept.
for (const [label, map] of [["MVP", mvp], ["Cy Young", cyYoung], ["HOF", hof]]) {
  const kept = new Set(players.map((p) => p.id));
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
  players,
};

writeFileSync(outFile, JSON.stringify(output));
const count = (fn) => players.filter(fn).length;
console.log(`Wrote ${players.length} players to ${outFile}`);
console.log(`  without batting rows: ${missingBatting}`);
console.log(`  300+ HR: ${count((p) => (p.hr ?? 0) >= 300)}`);
console.log(`  2000+ hits: ${count((p) => (p.hits ?? 0) >= 2000)}`);
console.log(`  MVP winners: ${count((p) => p.mvp.length > 0)}`);
console.log(`  Cy Young winners: ${count((p) => p.cyYoung.length > 0)}`);
console.log(`  Hall of Famers (Player): ${count((p) => p.hof !== null)}`);
console.log(`  Yankees (NYA): ${count((p) => p.teams.includes("NYA"))}`);
console.log(`  Mariners (SEA): ${count((p) => p.teams.includes("SEA"))}`);
