import type { BaseballPlayer, QuestionCriteria } from "@/types/baseball";

export interface CriteriaCheck {
  met: boolean;
  /** Fact-based explanation drawn from the dataset, e.g. "Jay Buhner hit 310 career home runs." */
  explanation: string;
}

const fmt = (n: number) => n.toLocaleString("en-US");
const years = (list: number[]) =>
  list.length <= 3 ? list.join(", ") : `${list.slice(0, 3).join(", ")} and ${list.length - 3} more`;

/** Pure check: does `player` satisfy `criteria`? Uses only dataset facts. */
export function checkCriteria(player: BaseballPlayer, criteria: QuestionCriteria): CriteriaCheck {
  const name = player.name;
  switch (criteria.type) {
    case "careerHomeRuns": {
      if (player.hr === null) return { met: false, explanation: `No batting record is available for ${name}.` };
      const met = player.hr >= criteria.min;
      return {
        met,
        explanation: met
          ? `${name} hit ${fmt(player.hr)} career home runs.`
          : `${name} hit ${fmt(player.hr)} career home runs — short of ${fmt(criteria.min)}.`,
      };
    }
    case "careerHits": {
      if (player.hits === null) return { met: false, explanation: `No batting record is available for ${name}.` };
      const met = player.hits >= criteria.min;
      return {
        met,
        explanation: met
          ? `${name} collected ${fmt(player.hits)} career hits.`
          : `${name} collected ${fmt(player.hits)} career hits — short of ${fmt(criteria.min)}.`,
      };
    }
    case "award": {
      const label = criteria.award === "mvp" ? "MVP award" : "Cy Young Award";
      const won = criteria.award === "mvp" ? player.mvp : player.cyYoung;
      return won.length > 0
        ? { met: true, explanation: `${name} won the ${label} in ${years(won)}.` }
        : { met: false, explanation: `${name} never won the ${label}.` };
    }
    case "playedFor": {
      const met = player.teams.some((t) => criteria.teamIds.includes(t));
      return {
        met,
        explanation: met
          ? `${name} appeared in a game for the ${criteria.teamName}.`
          : `${name} never appeared in a game for the ${criteria.teamName}.`,
      };
    }
    case "hallOfFame":
      return player.hof !== null
        ? { met: true, explanation: `${name} was inducted into the Hall of Fame in ${player.hof}.` }
        : { met: false, explanation: `${name} has not been inducted into the Hall of Fame as a player.` };
  }
}
