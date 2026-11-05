/**
 * Server secrets. PLAKATA_SECRET signs round tokens and participant cookies and
 * keys the IP hash. It must be at least 32 characters in production. Local dev
 * falls back to a fixed, insecure value, with a warning.
 */
import { createHmac } from "node:crypto";

const DEV_SECRET = "plakata-local-development-secret-do-not-use-in-production";
let warned = false;

function rootSecret(): string {
  const secret = process.env.PLAKATA_SECRET;
  if (secret && secret.length >= 32) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("PLAKATA_SECRET must be set to at least 32 random characters in production.");
  }
  if (!warned) {
    warned = true;
    console.warn("[plakata] PLAKATA_SECRET is not set; using an insecure development secret.");
  }
  return DEV_SECRET;
}

/** A per-purpose key derived from the root secret (HMAC-SHA256), so one leak can't forge another. */
export function deriveKey(purpose: "round-token" | "participant-cookie" | "ip-hash"): Buffer {
  return createHmac("sha256", rootSecret()).update(`plakata:${purpose}`).digest();
}
