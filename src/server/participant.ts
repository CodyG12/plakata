/**
 * Anonymous participant identity: a random UUID the SERVER issues, in an HttpOnly
 * cookie signed with HMAC-SHA256. A client can't choose or forge an ID, but it can
 * always drop the cookie and get a new one. That's the Sybil limit of anonymous
 * play (see README "Limitations"), mitigated by IP-hash rate limits.
 */
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { deriveKey } from "./env";

export const PARTICIPANT_COOKIE = "plakata_pid";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function sign(id: string): string {
  return createHmac("sha256", deriveKey("participant-cookie")).update(id).digest("base64url");
}

export function encodeParticipantCookie(id: string): string {
  return `${id}.${sign(id)}`;
}

/** Returns the participant id if the cookie value is authentic, else null. */
export function decodeParticipantCookie(value: string | undefined): string | null {
  if (!value) return null;
  const dot = value.indexOf(".");
  if (dot < 0) return null;
  const id = value.slice(0, dot);
  if (!UUID_RE.test(id)) return null;
  const given = Buffer.from(value.slice(dot + 1));
  const expected = Buffer.from(sign(id));
  return given.length === expected.length && timingSafeEqual(given, expected) ? id : null;
}

export function newParticipantId(): string {
  return randomUUID();
}

/** One-way, keyed hash of an IP address. The raw IP is never stored. */
export function hashIp(ip: string | null): string | null {
  if (!ip) return null;
  return createHmac("sha256", deriveKey("ip-hash")).update(ip).digest("base64url").slice(0, 22);
}

export function participantCookieHeader(id: string, secure: boolean): string {
  const parts = [
    `${PARTICIPANT_COOKIE}=${encodeParticipantCookie(id)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${60 * 60 * 24 * 365}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}
