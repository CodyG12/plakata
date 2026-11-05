import type { BaseballPlayer, Position, QuestionCriteria, StatKey } from "@/types/baseball";

export interface CriteriaCheck {
  met: boolean;
  /** Fact-based explanation drawn from the dataset, e.g. "Jay Buhner hit 310 career home runs." */
  explanation: string;
}

/** Display names for Lahman team and franchise IDs. */
export interface NameLookup {
  teamName(teamId: string): string;
  franchiseName(franchiseId: string): string;
}

const fmt = (n: number) => n.toLocaleString("en-US");
const years = (list: number[]) =>
  list.length <= 3 ? list.join(", ") : `${list.slice(0, 3).join(", ")} and ${list.length - 3} more`;

export const POSITION_LABELS: Record<Position, string> = {
  p: "pitcher",
  c: "catcher",
  "1b": "first base",
  "2b": "second base",
  "3b": "third base",
  ss: "shortstop",
  lf: "left field",
  cf: "center field",
  rf: "right field",
  of: "the outfield",
  dh: "designated hitter",
};

/** How each stat reads in an explanation: "hit 310 career home runs". */
const STAT_PHRASES: Record<StatKey, { verb: string; noun: string }> = {
  homeRuns: { verb: "hit", noun: "home runs" },
  hits: { verb: "collected", noun: "hits" },
  runsBattedIn: { verb: "drove in", noun: "runs" },
  stolenBases: { verb: "stole", noun: "bases" },
  wins: { verb: "won", noun: "games" },
  pitcherStrikeouts: { verb: "struck out", noun: "batters" },
  saves: { verb: "recorded", noun: "saves" },
};

/** Lahman birthCountry codes that read better spelled out. */
const COUNTRY_NAMES: Record<string, string> = {
  USA: "the United States",
  "D.R.": "the Dominican Republic",
  "P.R.": "Puerto Rico",
  CAN: "Canada",
};
export const countryName = (code: string) => COUNTRY_NAMES[code] ?? code;

export function playedInSeason(player: BaseballPlayer, from: number, to: number): number | null {
  for (const [first, last] of player.seasons) {
    const start = Math.max(first, from);
    if (start <= Math.min(last, to)) return start;
  }
  return null;
}

/**
 * Pure check: does `player` satisfy `criteria`? Uses only dataset facts.
 * Missing data never qualifies (an unknown birthplace is not "born outside the US").
 */
export function checkCriteria(player: BaseballPlayer, criteria: QuestionCriteria, names: NameLookup): CriteriaCheck {
  const name = player.name;
  const no = (explanation: string): CriteriaCheck => ({ met: false, explanation });
  const yes = (explanation: string): CriteriaCheck => ({ met: true, explanation });

  switch (criteria.type) {
    case "franchise": {
      const franchise = names.franchiseName(criteria.franchiseId);
      return player.franchises.includes(criteria.franchiseId)
        ? yes(`${name} appeared in a game for the ${franchise} franchise.`)
        : no(`${name} never appeared in a game for the ${franchise} franchise.`);
    }
    case "team": {
      const team = player.teams.find((t) => criteria.teamIds.includes(t));
      return team
        ? yes(`${name} appeared in a game for the ${names.teamName(team)}.`)
        : no(`${name} never appeared in a game for the ${names.teamName(criteria.teamIds[0])}.`);
    }
    case "position": {
      const games = player.positions[criteria.position] ?? 0;
      const label = POSITION_LABELS[criteria.position];
      return games >= criteria.minimumGames
        ? yes(`${name} played ${fmt(games)} career games at ${label}.`)
        : no(`${name} played ${fmt(games)} career games at ${label}.`);
    }
    case "season": {
      const season = playedInSeason(player, criteria.from, criteria.to);
      const span = criteria.from === criteria.to ? `the ${criteria.from} season` : `${criteria.from}–${criteria.to}`;
      return season !== null
        ? yes(`${name} played in ${season}${criteria.from === criteria.to ? "" : `, within ${span}`}.`)
        : no(`${name} did not play in ${span}.`);
    }
    case "debut": {
      const ok =
        (criteria.before === undefined || player.firstYear < criteria.before) &&
        (criteria.from === undefined || player.firstYear >= criteria.from);
      return ok ? yes(`${name} made his MLB debut in ${player.firstYear}.`) : no(`${name} debuted in ${player.firstYear}.`);
    }
    case "stat_threshold": {
      const value = (criteria.scope === "career" ? player.career : player.bestSeason)[criteria.stat];
      if (value === undefined) return no(`No ${criteria.stat} record is available for ${name}.`);
      const { verb, noun } = STAT_PHRASES[criteria.stat];
      const phrase =
        criteria.scope === "career" ? `${verb} ${fmt(value)} career ${noun}` : `${verb} ${fmt(value)} ${noun} in his best season`;
      return value >= criteria.value ? yes(`${name} ${phrase}.`) : no(`${name} ${phrase}.`);
    }
    case "award": {
      const label = criteria.award === "mvp" ? "MVP award" : "Cy Young Award";
      const won = criteria.award === "mvp" ? player.mvp : player.cyYoung;
      return won.length > 0 ? yes(`${name} won the ${label} in ${years(won)}.`) : no(`${name} never won the ${label}.`);
    }
    case "hall_of_fame":
      return player.hof !== null
        ? yes(`${name} was inducted into the Hall of Fame in ${player.hof}.`)
        : no(`${name} has not been inducted into the Hall of Fame as a player.`);
    case "all_star": {
      if (criteria.year !== undefined) {
        return player.allStar.includes(criteria.year)
          ? yes(`${name} was selected to the ${criteria.year} All-Star team.`)
          : no(`${name} was not selected to the ${criteria.year} All-Star team.`);
      }
      const n = player.allStar.length;
      return n >= criteria.minimumSelections
        ? yes(`${name} was selected to ${n} All-Star team${n === 1 ? "" : "s"} (${years(player.allStar)}).`)
        : no(`${name} was selected to ${n} All-Star teams.`);
    }
    case "world_series_champion": {
      if (criteria.year !== undefined) {
        return player.wsTitles.includes(criteria.year)
          ? yes(`${name} played in the ${criteria.year} World Series for the champions.`)
          : no(`${name} did not play in the ${criteria.year} World Series for the champions.`);
      }
      const n = player.wsTitles.length;
      return n >= criteria.minimumTitles
        ? yes(`${name} played for the World Series champions in ${years(player.wsTitles)}.`)
        : no(`${name} played for ${n} World Series champions.`);
    }
    case "birthplace": {
      const country = player.birthCountry;
      if (country === null) return no(`${name}'s birthplace is not recorded.`);
      const where = player.birthState && criteria.state ? `${player.birthState}, ${countryName(country)}` : countryName(country);
      if (criteria.excludeCountries) {
        return criteria.excludeCountries.includes(country) ? no(`${name} was born in ${where}.`) : yes(`${name} was born in ${where}.`);
      }
      const ok = country === criteria.country && (criteria.state === undefined || player.birthState === criteria.state);
      return ok ? yes(`${name} was born in ${where}.`) : no(`${name} was born in ${where}.`);
    }
  }
}
