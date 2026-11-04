import { MAX_POINTS_PER_ROUND } from "@/lib/baseball/scoring";
import type { QuestionCriteria } from "@/types/baseball";

/**
 * The fixed seven-question game. Edit this list to change the game — each
 * question needs a unique id, prompt text, and a criteria rule. If you add a
 * new id, add a matching (possibly empty) entry in rarity-estimates.ts.
 */
export const QUESTIONS = [
  {
    id: "hr-300",
    prompt: "Name an MLB player with at least 300 career home runs.",
    criteria: { type: "careerHomeRuns", min: 300 },
  },
  {
    id: "mvp",
    prompt: "Name an MLB player who has won an MVP award.",
    criteria: { type: "award", award: "mvp" },
  },
  {
    id: "yankees",
    prompt: "Name an MLB player who has played for the New York Yankees.",
    criteria: { type: "playedFor", teamIds: ["NYA"], teamName: "New York Yankees" },
  },
  {
    id: "hits-2000",
    prompt: "Name an MLB player with at least 2,000 career hits.",
    criteria: { type: "careerHits", min: 2000 },
  },
  {
    id: "cy-young",
    prompt: "Name an MLB player who has won a Cy Young Award.",
    criteria: { type: "award", award: "cyYoung" },
  },
  {
    id: "mariners",
    prompt: "Name an MLB player who has played for the Seattle Mariners.",
    criteria: { type: "playedFor", teamIds: ["SEA"], teamName: "Seattle Mariners" },
  },
  {
    id: "hall-of-fame",
    prompt: "Name an MLB player inducted into the National Baseball Hall of Fame.",
    criteria: { type: "hallOfFame" },
  },
] as const satisfies readonly { id: string; prompt: string; criteria: QuestionCriteria }[];

export type Question = (typeof QUESTIONS)[number];
export type QuestionId = Question["id"];

export const ROUND_COUNT = QUESTIONS.length;
export const ROUND_SECONDS = 30;
/** Best possible game: a Plákata every round (7 × 100 = 700). */
export const MAX_GAME_SCORE = QUESTIONS.length * MAX_POINTS_PER_ROUND;

export function getQuestion(id: string): Question | undefined {
  return QUESTIONS.find((q) => q.id === id);
}
