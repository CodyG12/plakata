import { getQuestion } from "@/data/questions";
import { calculateScore } from "@/lib/baseball/calculate-rarity";
import { getPlayerIndex } from "@/lib/baseball/dataset";
import { validateAnswer } from "@/lib/baseball/validate-answer";
import type { AnswerResponse } from "@/types/game";

/**
 * Checks one typed answer. Rejected answers come back with a status and a
 * generic message only (no names, IDs, or scores).
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { questionId, input, playerId } = (body ?? {}) as Record<string, unknown>;
  const question = typeof questionId === "string" ? getQuestion(questionId) : undefined;
  if (!question) return Response.json({ error: "Unknown question" }, { status: 400 });
  if (typeof input !== "string" || input.length > 100) {
    return Response.json({ error: "Invalid input" }, { status: 400 });
  }
  // Optional: which namesake the user picked after a "choose" response. It is
  // only honored if it's one of the namesakes of `input` that fit the question.
  if (playerId !== undefined && typeof playerId !== "string") {
    return Response.json({ error: "Invalid playerId" }, { status: 400 });
  }

  const validation = validateAnswer(input, question.criteria, getPlayerIndex(), playerId);
  const response: AnswerResponse =
    validation.status === "valid" ? { validation, score: calculateScore(validation, question.id) } : { validation };
  return Response.json(response);
}
