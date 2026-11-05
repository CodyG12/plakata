import { ADMIN_COOKIE, adminCookieHeader, adminPassword, checkAdminPassword, issueAdminSession, verifyAdminSession } from "@/server/admin-auth";
import { adminError, adminHeaders, isJsonRequest } from "@/server/admin-http";
import { getDb } from "@/server/db/client";
import { clientIp, readCookie } from "@/server/http";
import { hashIp } from "@/server/participant";
import { hit, LIMITS } from "@/server/rate-limit";

const secure = (request: Request) => new URL(request.url).protocol === "https:";

/** GET /api/admin/session: is this browser signed in? (Never reveals anything else.) */
export async function GET(request: Request) {
  return Response.json(
    { enabled: adminPassword() !== null, authenticated: verifyAdminSession(readCookie(request, ADMIN_COOKIE), Date.now()) },
    { headers: adminHeaders() },
  );
}

/** POST /api/admin/session {password}: sign in. Rate-limited per IP. */
export async function POST(request: Request) {
  if (!adminPassword()) return adminError(503, "admin_disabled", "The Question Builder is off: set ADMIN_PASSWORD (12+ characters).");
  if (!isJsonRequest(request)) return adminError(415, "json_required", "Admin requests must be sent as JSON.");
  const now = Date.now();
  if (!(await hit(await getDb(), LIMITS.adminLoginIp, hashIp(clientIp(request)) ?? "unknown", now))) {
    return adminError(429, "rate_limited", "Too many sign-in attempts. Wait 15 minutes.");
  }
  const body = (await request.json().catch(() => null)) as { password?: unknown } | null;
  if (!body || typeof body.password !== "string" || !checkAdminPassword(body.password)) {
    return adminError(401, "bad_password", "Wrong password.");
  }
  const session = issueAdminSession(now);
  const headers = adminHeaders();
  headers.append("Set-Cookie", adminCookieHeader(session.value, session.maxAgeSeconds, secure(request)));
  return Response.json({ authenticated: true }, { headers });
}

/** DELETE /api/admin/session: sign out. */
export async function DELETE(request: Request) {
  const headers = adminHeaders();
  headers.append("Set-Cookie", adminCookieHeader("", 0, secure(request)));
  return Response.json({ authenticated: false }, { headers });
}
