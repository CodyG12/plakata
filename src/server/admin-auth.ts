/**
 * Admin access for the Question Builder. Server-side only:
 *  - The password lives in ADMIN_PASSWORD (≥ 12 chars) and never reaches the browser.
 *    Without it, every admin endpoint answers 503: the Builder is off.
 *  - A correct password earns an HMAC-signed session cookie (HttpOnly, SameSite=Strict,
 *    Secure on HTTPS) that expires after 8 hours. The signature also covers a hash of
 *    the password, so changing the password logs every session out.
 *  - Login attempts are rate-limited per IP hash (see admin-http.ts).
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { deriveKey } from "./env";

export const ADMIN_COOKIE = "plakata_admin";
export const ADMIN_SESSION_MS = 8 * 60 * 60 * 1000;
const MIN_PASSWORD_LENGTH = 12;

const sha256 = (s: string) => createHash("sha256").update(s).digest();

export function adminPassword(): string | null {
  const p = process.env.ADMIN_PASSWORD;
  return p && p.length >= MIN_PASSWORD_LENGTH ? p : null;
}

/** Constant-time password check (both sides hashed, so lengths always match). */
export function checkAdminPassword(given: string): boolean {
  const expected = adminPassword();
  if (!expected || typeof given !== "string") return false;
  return timingSafeEqual(sha256(given), sha256(expected));
}

function signature(expiresAt: number, password: string): string {
  return createHmac("sha256", deriveKey("admin-session"))
    .update(`admin:${expiresAt}:`)
    .update(sha256(password))
    .digest("base64url");
}

export function issueAdminSession(now: number): { value: string; maxAgeSeconds: number } {
  const password = adminPassword();
  if (!password) throw new Error("ADMIN_PASSWORD is not configured");
  const expiresAt = now + ADMIN_SESSION_MS;
  return { value: `${expiresAt}.${signature(expiresAt, password)}`, maxAgeSeconds: ADMIN_SESSION_MS / 1000 };
}

export function verifyAdminSession(value: string | undefined, now: number): boolean {
  const password = adminPassword();
  if (!password || !value) return false;
  const dot = value.indexOf(".");
  if (dot <= 0) return false;
  const expiresAt = Number(value.slice(0, dot));
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) return false;
  const given = Buffer.from(value.slice(dot + 1));
  const expected = Buffer.from(signature(expiresAt, password));
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function adminCookieHeader(value: string, maxAgeSeconds: number, secure: boolean): string {
  const parts = [`${ADMIN_COOKIE}=${value}`, "Path=/", "HttpOnly", "SameSite=Strict", `Max-Age=${maxAgeSeconds}`];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}
