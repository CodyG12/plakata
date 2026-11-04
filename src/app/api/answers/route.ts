import { getQuestion } from "@/data/questions";
import { calculateScore } from "@/lib/baseball/calculate-rarity";
import { getPlayerIndex } from "@/lib/baseball/dataset";
import { validateAnswer } from "@/lib/baseball/validate-answer";
import type { AnswerResponse } from "@/types/game";

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
  if (input !== undefined && (typeof input !== "string" || input.length > 100)) {
    return Response.json({ error: "Invalid input" }, { status: 400 });
  }
  if (playerId !== undefined && typeof playerId !== "string") {
    return Response.json({ error: "Invalid playerId" }, { status: 400 });
  }

  const validation = validateAnswer({ input, playerId }, question.criteria, getPlayerIndex());
  const resolved = validation.status === "valid" || validation.status === "invalid";
  const response: AnswerResponse = resolved
    ? { validation, score: calculateScore(validation, question.id) }
    : { validation };
  return Response.json(response);
}
