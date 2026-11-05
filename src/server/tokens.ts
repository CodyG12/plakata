/**
 * Signed round tokens (JWT, HS256 via `jose`). A token proves the server started
 * this round with this question at this time. It is NOT the source of truth: every
 * submission is also checked against the round row in the database (status,
 * expiresAt, tokenId), so a valid-looking token can never reopen or re-score a round.
 */
import { errors, jwtVerify, SignJWT } from "jose";
import { deriveKey } from "./env";

const ISSUER = "plakata";
const AUDIENCE = "plakata:round";

export interface RoundTokenClaims {
  gameId: string;
  roundId: string;
  questionVersionId: number;
  position: number;
  /** Epoch ms. */
  startedAt: number;
  expiresAt: number;
  /** Unique token id, stored on the round. */
  jti: string;
}

const key = () => new Uint8Array(deriveKey("round-token"));

export async function signRoundToken(claims: RoundTokenClaims, graceMs: number): Promise<string> {
  return new SignJWT({
    gid: claims.gameId,
    qv: claims.questionVersionId,
    pos: claims.position,
    sat: claims.startedAt,
    eat: claims.expiresAt,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(claims.roundId)
    .setJti(claims.jti)
    .setIssuedAt(Math.floor(claims.startedAt / 1000))
    // The JWT itself stops verifying shortly after the round can no longer accept answers.
    .setExpirationTime(Math.ceil((claims.expiresAt + graceMs) / 1000) + 1)
    .sign(key());
}

/**
 * "expired" still carries the claims: jose checks the signature BEFORE the expiry,
 * so an expired token is authentic, just late.
 */
export type TokenCheck =
  | { ok: true; claims: RoundTokenClaims }
  | { ok: false; reason: "expired"; claims: RoundTokenClaims }
  | { ok: false; reason: "invalid" };

function toClaims(payload: Record<string, unknown>): RoundTokenClaims | null {
  const { gid, qv, pos, sat, eat, sub, jti } = payload;
  if (
    typeof gid !== "string" ||
    typeof sub !== "string" ||
    typeof jti !== "string" ||
    typeof qv !== "number" ||
    typeof pos !== "number" ||
    typeof sat !== "number" ||
    typeof eat !== "number"
  ) {
    return null;
  }
  return { gameId: gid, roundId: sub, questionVersionId: qv, position: pos, startedAt: sat, expiresAt: eat, jti };
}

/** Verifies signature, algorithm, issuer, audience and expiry. `now` is the server clock (ms). */
export async function verifyRoundToken(token: string, now: number): Promise<TokenCheck> {
  try {
    const { payload } = await jwtVerify(token, key(), {
      algorithms: ["HS256"],
      issuer: ISSUER,
      audience: AUDIENCE,
      currentDate: new Date(now),
    });
    const claims = toClaims(payload);
    return claims ? { ok: true, claims } : { ok: false, reason: "invalid" };
  } catch (error) {
    if (error instanceof errors.JWTExpired) {
      const claims = toClaims(error.payload);
      if (claims) return { ok: false, reason: "expired", claims };
    }
    return { ok: false, reason: "invalid" };
  }
}
