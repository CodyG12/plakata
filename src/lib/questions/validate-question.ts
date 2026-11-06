/**
 * Question Builder validation: does a custom question have legitimate, verifiable
 * answers? Uses the SAME criteria engine as gameplay (checkCriteria over the Lahman
 * dataset), then checks what a successful query can't prove on its own: that the
 * data actually covers the asked-about year/team/country, how many players have
 * missing fields, whether the prompt matches the rule, and the Plákata pick rules.
 *
 * Pure: no database. The admin service supplies the other questions' picks/prompts.
 */
import { checkCriteria, countryName, POSITION_LABELS } from "@/lib/baseball/criteria";
import type { PlayerIndex } from "@/lib/baseball/dataset";
import { questionCriteriaSchema, type BaseballPlayer, type QuestionCriteria } from "@/types/baseball";
import { rankingConfigFor, rankPlayers, STAT_META, topFiveIds, type RankedPlayer } from "./ranking";

export const UNSUPPORTED_MESSAGE = "This question requires a criteria type that is not currently supported.";

export interface ValidationInput {
  prompt: string;
  criteria: unknown;
  plakataPick: string | null;
  topFiveOverride: boolean;
}

export interface ValidationContext {
  index: PlayerIndex;
  /** Plákata picks of OTHER active questions (picks are single-use). */
  otherPicks: ReadonlyMap<string, string>;
  /** Prompts of OTHER active questions (lowercased). */
  otherPrompts: ReadonlySet<string>;
}

export interface TopFiveEntry {
  playerId: string;
  name: string;
  value: number;
  rank: number;
}

export interface ValidationReport {
  status: "ready" | "blocked";
  errors: string[];
  warnings: string[];
  /** Data coverage notes: what the dataset can and can't verify for this rule. */
  coverage: string[];
  eligibleCount: number;
  criteriaSummary: string;
  dataSource: string;
  topFive: { enabled: boolean; supported: boolean; reason?: string; note?: string; leaders: TopFiveEntry[] };
  plakataPick: { playerId: string; name: string } | null;
  /** A rule-based deep-cut suggestion (fewest games, retired, ≥100 games, unused, not a leader). */
  suggestedPick: { playerId: string; name: string; games: number } | null;
  validatedAt: string;
}

const fmt = (n: number) => n.toLocaleString("en-US");

export function describeCriteria(c: QuestionCriteria, index: PlayerIndex): string {
  switch (c.type) {
    case "franchise":
      return `Played for the ${index.franchiseName(c.franchiseId)} franchise (${c.franchiseId})`;
    case "team":
      return `Played for ${c.teamIds.map((t) => `${index.teamName(t)} (${t})`).join(" or ")}`;
    case "position":
      return `≥ ${fmt(c.minimumGames)} career games at ${POSITION_LABELS[c.position]}`;
    case "season":
      return c.from === c.to ? `Appeared in the ${c.from} season` : `Appeared in a season from ${c.from} to ${c.to}`;
    case "debut":
      return [c.before !== undefined ? `debut before ${c.before}` : "", c.from !== undefined ? `debut in or after ${c.from}` : ""]
        .filter(Boolean)
        .join(" and ")
        .replace(/^./, (x) => x.toUpperCase());
    case "stat_threshold":
      return `${c.scope === "career" ? "Career" : "Single-season"} ${STAT_META[c.stat].label} ≥ ${fmt(c.value)}`;
    case "award":
      return c.award === "mvp" ? "Won an MVP award" : "Won a Cy Young Award";
    case "hall_of_fame":
      return "Inducted into the Hall of Fame as a player";
    case "all_star":
      return c.year !== undefined ? `Selected to the ${c.year} All-Star team` : `≥ ${c.minimumSelections} All-Star selection(s)`;
    case "world_series_champion":
      return c.year !== undefined
        ? `Appeared in the ${c.year} World Series for the winner`
        : `Appeared in the World Series for ≥ ${c.minimumTitles} champion(s)`;
    case "birthplace":
      return c.excludeCountries
        ? `Born outside: ${c.excludeCountries.map(countryName).join(", ")}`
        : `Born in ${c.state ? `${c.state}, ` : ""}${countryName(c.country!)}`;
  }
}

/** Numbers a prompt should mention for its criteria, e.g. 300 → "300" or "300". */
function expectedNumbers(c: QuestionCriteria): number[] {
  switch (c.type) {
    case "stat_threshold":
      return [c.value];
    case "position":
      return [c.minimumGames];
    case "season":
      return c.from === c.to ? [c.from] : [c.from, c.to];
    case "debut":
      return [c.before, c.from].filter((x): x is number => x !== undefined);
    case "all_star":
      return c.year !== undefined ? [c.year] : c.minimumSelections > 1 ? [c.minimumSelections] : [];
    case "world_series_champion":
      return c.year !== undefined ? [c.year] : c.minimumTitles > 1 ? [c.minimumTitles] : [];
    default:
      return [];
  }
}

const WORD_NUMBERS: Record<number, string> = { 2: "two", 3: "three", 4: "four", 5: "five", 6: "six", 7: "seven", 8: "eight", 9: "nine", 10: "ten" };

function promptMentions(prompt: string, n: number): boolean {
  const digits = prompt.replace(/(\d),(\d)/g, "$1$2");
  return new RegExp(`(^|\\D)${n}(\\D|$)`).test(digits) || (WORD_NUMBERS[n] !== undefined && prompt.toLowerCase().includes(WORD_NUMBERS[n]));
}

/** Checks that the dataset can actually answer the asked-about fact (not just that a query ran). */
function dataChecks(c: QuestionCriteria, index: PlayerIndex, errors: string[], warnings: string[], coverage: string[]) {
  const players = index.all();
  const lastSeason = Math.max(...players.map((p) => p.lastYear));
  const firstSeason = Math.min(...players.map((p) => p.firstYear));
  const yearInData = (y: number, label: string) => {
    if (y < firstSeason || y > lastSeason) errors.push(`${label} ${y} is outside the dataset (${firstSeason}–${lastSeason}).`);
  };
  switch (c.type) {
    case "franchise":
      if (index.franchiseName(c.franchiseId) === c.franchiseId) errors.push(`Unknown franchise id "${c.franchiseId}".`);
      break;
    case "team":
      for (const t of c.teamIds) if (index.teamName(t) === t) errors.push(`Unknown team id "${t}".`);
      break;
    case "season":
      if (c.from > c.to) errors.push("The season range starts after it ends.");
      yearInData(c.from, "Season");
      yearInData(c.to, "Season");
      break;
    case "debut":
      if (c.before === undefined && c.from === undefined) errors.push("A debut rule needs a 'before' or 'from' year.");
      if (c.before !== undefined) yearInData(c.before, "Year");
      if (c.from !== undefined) yearInData(c.from, "Year");
      break;
    case "stat_threshold": {
      const pitching = c.stat === "wins" || c.stat === "pitcherStrikeouts" || c.stat === "saves";
      const missing = players.filter((p) => (c.scope === "career" ? p.career : p.bestSeason)[c.stat] === undefined).length;
      coverage.push(
        `${fmt(missing)} of ${fmt(players.length)} players have no recorded ${STAT_META[c.stat].label.toLowerCase()} (${
          pitching ? "no pitching record" : "no batting record for this stat"
        }); they can't qualify.`,
      );
      if (c.scope === "season") coverage.push("Single-season values sum all of a player's stints (teams) within one season.");
      break;
    }
    case "all_star":
      coverage.push("All-Star data (AllstarFull) starts in 1933. A selection = on the roster, whether or not he played.");
      if (c.year !== undefined) {
        if (!players.some((p) => p.allStar.includes(c.year!))) errors.push(`No All-Star selections are recorded for ${c.year}.`);
      }
      break;
    case "world_series_champion":
      coverage.push("Titles count only modern World Series (1903+) in which the player appeared for the winner; roster members who never played are not included.");
      if (c.year !== undefined && !players.some((p) => p.wsTitles.includes(c.year!))) {
        errors.push(`No modern World Series champion is recorded for ${c.year} (none was played, or it predates 1903).`);
      }
      break;
    case "birthplace": {
      const unknown = players.filter((p) => p.birthCountry === null).length;
      coverage.push(`${fmt(unknown)} players have no recorded birthplace; they never qualify.`);
      const countries = new Set(players.map((p) => p.birthCountry).filter((x): x is string => x !== null));
      for (const country of [c.country, ...(c.excludeCountries ?? [])].filter((x): x is string => !!x)) {
        if (!countries.has(country)) errors.push(`No player in the dataset was born in "${country}". Use a country name exactly as listed.`);
      }
      if (c.state && c.country && !players.some((p) => p.birthCountry === c.country && p.birthState === c.state)) {
        errors.push(`No player in the dataset was born in "${c.state}", ${c.country}.`);
      }
      break;
    }
    case "position":
      coverage.push("Positions count regular-season games at the position (Lahman Appearances).");
      break;
    case "award":
      coverage.push("MVP includes the awards Lahman records as Most Valuable Player (Chalmers and League Awards included).");
      break;
    case "hall_of_fame":
      coverage.push("Counts people inducted in the Player category only.");
      break;
  }
}

/** Fewest career games among eligible, retired players with ≥100 games, unused and not a leader. */
export function suggestPick(
  eligible: readonly BaseballPlayer[],
  excluded: ReadonlySet<string>,
  lastSeason: number,
): BaseballPlayer | null {
  return (
    [...eligible]
      .filter((p) => p.games >= 100 && p.lastYear < lastSeason && !excluded.has(p.id))
      .sort((a, b) => a.games - b.games || a.id.localeCompare(b.id))[0] ?? null
  );
}

export interface EligibleSet {
  criteria: QuestionCriteria;
  players: BaseballPlayer[];
  ranked: RankedPlayer[];
  buntOverride: string[];
}

/** The verified answer set for criteria (same engine as gameplay) plus its ranking. */
export function computeEligible(criteria: QuestionCriteria, topFiveOverride: boolean, index: PlayerIndex): EligibleSet {
  const players = index.all().filter((p) => checkCriteria(p, criteria, index).met);
  const config = topFiveOverride ? rankingConfigFor(criteria) : null;
  const ranked = config ? rankPlayers(players, config) : [];
  return { criteria, players, ranked, buntOverride: topFiveIds(ranked) };
}

export function validateQuestion(input: ValidationInput, ctx: ValidationContext, now: Date = new Date()): ValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const coverage: string[] = [];
  const { index } = ctx;
  const dataSource = `${index.meta.source}, ${index.meta.release} (${index.meta.license})`;
  const empty = (summary: string): ValidationReport => ({
    status: "blocked",
    errors,
    warnings,
    coverage,
    eligibleCount: 0,
    criteriaSummary: summary,
    dataSource,
    topFive: { enabled: false, supported: false, leaders: [] },
    plakataPick: null,
    suggestedPick: null,
    validatedAt: now.toISOString(),
  });

  // 1. Prompt basics.
  const prompt = input.prompt.trim();
  if (prompt.length < 10) errors.push("Write the question text (at least 10 characters).");
  if (prompt.length > 200) errors.push("Keep the question under 200 characters.");
  if (prompt && !/^name\b/i.test(prompt)) warnings.push('Questions usually start with "Name …", like the rest of the bank.');
  if (ctx.otherPrompts.has(prompt.toLowerCase())) errors.push("Another active question already uses this exact text.");

  // 2. Structured criteria: the only source of truth for eligibility.
  const parsed = questionCriteriaSchema.safeParse(input.criteria);
  if (!parsed.success) {
    errors.push(UNSUPPORTED_MESSAGE);
    for (const issue of parsed.error.issues.slice(0, 3)) errors.push(`Criteria: ${issue.path.join(".") || "rule"}: ${issue.message}`);
    return empty("Unsupported criteria");
  }
  const criteria = parsed.data;
  const summary = describeCriteria(criteria, index);
  dataChecks(criteria, index, errors, warnings, coverage);
  for (const n of expectedNumbers(criteria)) {
    if (prompt && !promptMentions(prompt, n)) warnings.push(`The question text doesn't mention ${fmt(n)}, but the rule uses it. Check they agree.`);
  }

  // 3. Top-5 rule.
  const supported = rankingConfigFor(criteria) !== null;
  if (input.topFiveOverride && !supported) errors.push("The Top-5 Bunt rule only applies to statistical questions.");
  const set = computeEligible(criteria, input.topFiveOverride && supported, index);
  const leaders: TopFiveEntry[] = set.ranked
    .filter((r) => r.buntOverride)
    .map((r) => ({ playerId: r.playerId, name: index.getById(r.playerId)!.name, value: r.value, rank: r.rank }));
  if (leaders.length > 5) warnings.push(`${leaders.length} players share the top five (ties at fifth); all of them score a Bunt.`);

  // 4. The verified answer count.
  const eligibleCount = set.players.length;
  if (eligibleCount === 0) errors.push("No player in the dataset satisfies this rule, so the question has no valid answer.");
  else if (eligibleCount < 10) warnings.push(`Only ${eligibleCount} valid answers: a very hard question.`);
  else if (eligibleCount > 5000) warnings.push(`${fmt(eligibleCount)} valid answers: almost anyone fits, so it may be too easy.`);
  if (input.topFiveOverride && supported && eligibleCount > 0 && eligibleCount <= 5) {
    warnings.push("Every valid answer is a top-five leader, so every answer scores a Bunt.");
  }

  // 5. Plákata pick: one per question, eligible, single-use, never a leader.
  const lastSeason = Math.max(...index.all().map((p) => p.lastYear));
  let pick: ValidationReport["plakataPick"] = null;
  if (!input.plakataPick) {
    errors.push("Choose this question's Plákata pick (its one 100-point answer).");
  } else {
    const p = index.getById(input.plakataPick);
    if (!p) errors.push(`Unknown player id "${input.plakataPick}" for the Plákata pick.`);
    else {
      pick = { playerId: p.id, name: p.name };
      if (!set.players.some((x) => x.id === p.id)) errors.push(`${p.name} doesn't satisfy the rule, so can't be the Plákata pick.`);
      if (set.buntOverride.includes(p.id)) errors.push(`${p.name} is a top-five leader here and would always score a Bunt.`);
      const other = ctx.otherPicks.get(p.id);
      if (other) errors.push(`${p.name} is already the Plákata pick for "${other}". Picks are single-use.`);
      if (p.lastYear >= lastSeason) warnings.push(`${p.name} is an active player; picks should be retired deep cuts.`);
    }
  }
  const excluded = new Set([...ctx.otherPicks.keys(), ...set.buntOverride]);
  const suggestion = suggestPick(set.players, excluded, lastSeason);

  return {
    status: errors.length === 0 ? "ready" : "blocked",
    errors,
    warnings,
    coverage,
    eligibleCount,
    criteriaSummary: summary,
    dataSource,
    topFive: {
      enabled: input.topFiveOverride && supported,
      supported,
      ...(supported ? {} : { reason: "Only statistical questions have a meaningful top five." }),
      ...(rankingConfigFor(criteria)?.seasonFloor
        ? { note: `Ranked by best season from ${rankingConfigFor(criteria)!.seasonFloor} on (60'6" pitching). Earlier seasons still count as valid answers.` }
        : {}),
      leaders,
    },
    plakataPick: pick,
    suggestedPick: suggestion ? { playerId: suggestion.id, name: suggestion.name, games: suggestion.games } : null,
    validatedAt: now.toISOString(),
  };
}
