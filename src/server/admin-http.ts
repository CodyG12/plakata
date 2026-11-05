/**
 * Plumbing for the admin API (Question Builder). Every route goes through
 * `adminHandle`, which:
 *  - answers 503 when ADMIN_PASSWORD isn't configured (the Builder is off),
 *  - answers 401 unless the request carries a valid admin session cookie,
 *  - requires `Content-Type: application/json` on writes, which a cross-site form
 *    can't send without a CORS preflight (with the SameSite=Strict cookie, that's
 *    the CSRF defence),
 *  - never caches, and keeps responses out of search indexes.
 */
import { z } from "zod";
import { getPlayerIndex, type PlayerIndex } from "@/lib/baseball/dataset";
import type { ApiError } from "@/types/api";
import { ADMIN_COOKIE, adminPassword, verifyAdminSession } from "./admin-auth";
import { getDb, type Db } from "./db/client";
import { GameError } from "./game-service";
import { readCookie } from "./http";

export interface AdminContext {
  db: Db;
  index: PlayerIndex;
  now: Date;
}

export function adminHeaders(): Headers {
  return new Headers({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex" });
}

export function adminError(status: number, code: string, message: string, headers = adminHeaders()): Response {
  const body: ApiError = { error: message, code };
  return Response.json(body, { status, headers });
}

export function isJsonRequest(request: Request): boolean {
  return (request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json");
}

export async function adminHandle(request: Request, fn: (ctx: AdminContext) => Promise<unknown>): Promise<Response> {
  if (!adminPassword()) return adminError(503, "admin_disabled", "The Question Builder is off: set ADMIN_PASSWORD (12+ characters).");
  if (!verifyAdminSession(readCookie(request, ADMIN_COOKIE), Date.now())) {
    return adminError(401, "unauthorized", "Sign in to use the Question Builder.");
  }
  if (request.method !== "GET" && !isJsonRequest(request)) {
    return adminError(415, "json_required", "Admin requests must be sent as JSON.");
  }
  try {
    const body = await fn({ db: await getDb(), index: getPlayerIndex(), now: new Date() });
    return Response.json(body, { headers: adminHeaders() });
  } catch (error) {
    if (error instanceof GameError) return adminError(error.status, error.code, error.message);
    if (error instanceof z.ZodError) return adminError(400, "invalid_request", "Invalid request.");
    console.error("[plakata] admin request failed:", error);
    return adminError(500, "server_error", error instanceof Error ? error.message : "Admin request failed.");
  }
}

export async function readBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new GameError("invalid_request", 400, "Invalid JSON body.");
  }
}
