/**
 * Shared plumbing for the API route handlers: who is calling (signed participant
 * cookie + hashed IP), JSON parsing, and error mapping. Responses are never cached.
 */
import { z } from "zod";
import type { ApiError } from "@/types/api";
import { getDb, type Db } from "./db/client";
import { GameError, type Caller } from "./game-service";
import { decodeParticipantCookie, hashIp, newParticipantId, PARTICIPANT_COOKIE, participantCookieHeader } from "./participant";

function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

function clientIp(request: Request): string | null {
  // Vercel and most proxies put the client first in x-forwarded-for.
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim() || null;
  return request.headers.get("x-real-ip");
}

interface Context {
  db: Db;
  caller: Caller;
  now: number;
}

/**
 * Wraps a handler: resolves the caller (issuing a new participant cookie if needed),
 * runs it, and turns GameErrors into JSON errors. `now` is read once, server-side.
 */
export async function handle(request: Request, fn: (ctx: Context) => Promise<unknown>): Promise<Response> {
  const existing = decodeParticipantCookie(readCookie(request, PARTICIPANT_COOKIE));
  const participantId = existing ?? newParticipantId();
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (!existing) headers.append("Set-Cookie", participantCookieHeader(participantId, new URL(request.url).protocol === "https:"));

  try {
    const db = await getDb();
    const body = await fn({ db, caller: { participantId, ipHash: hashIp(clientIp(request)) }, now: Date.now() });
    return Response.json(body, { headers });
  } catch (error) {
    if (error instanceof GameError) return errorResponse(error.status, error.code, error.message, headers);
    if (error instanceof z.ZodError) return errorResponse(400, "invalid_request", "Invalid request body.", headers);
    const message = error instanceof Error ? error.message : String(error);
    if (/relation .* does not exist|no active scoring snapshot|Need \d+ active questions/.test(message)) {
      console.error("[plakata] database not initialized:", message);
      return errorResponse(503, "not_initialized", "The game database isn't set up yet. Run: npm run plakata -- setup", headers);
    }
    console.error("[plakata] request failed:", error);
    return errorResponse(503, "unavailable", "The game server had a problem. Please try again.", headers);
  }
}

function errorResponse(status: number, code: string, message: string, headers: Headers): Response {
  const body: ApiError = { error: message, code };
  return Response.json(body, { status, headers });
}

export async function readJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new GameError("invalid_request", 400, "Invalid JSON body.");
  }
  return schema.parse(raw);
}
