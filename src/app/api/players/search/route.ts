import { getPlayerIndex } from "@/lib/baseball/dataset";

/**
 * Autocomplete over ALL players in the dataset (not just valid answers), so
 * suggestions never reveal which players satisfy the current question.
 */
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q") ?? "";
  const results = query.length > 60 ? [] : getPlayerIndex().search(query, 8);
  return Response.json({ results });
}
