import { describe, expect, it } from "vitest";
import { decodeParticipantCookie, encodeParticipantCookie, hashIp, newParticipantId } from "./participant";
import { signRoundToken, verifyRoundToken } from "./tokens";

const claims = {
  gameId: "11111111-1111-4111-8111-111111111111",
  roundId: "22222222-2222-4222-8222-222222222222",
  questionVersionId: 3,
  position: 2,
  startedAt: Date.UTC(2026, 10, 4, 12),
  expiresAt: Date.UTC(2026, 10, 4, 12) + 33_000,
  jti: "33333333-3333-4333-8333-333333333333",
};

describe("round tokens (HS256)", () => {
  it("round-trips the round's claims", async () => {
    const token = await signRoundToken(claims, 750);
    expect(token.split(".")).toHaveLength(3);
    expect(await verifyRoundToken(token, claims.startedAt + 1000)).toEqual({ ok: true, claims });
  });

  it("reports an authentic expired token as expired, with its claims", async () => {
    const token = await signRoundToken(claims, 750);
    const check = await verifyRoundToken(token, claims.expiresAt + 60_000);
    expect(check).toMatchObject({ ok: false, reason: "expired", claims: { roundId: claims.roundId } });
  });

  it("rejects tampering, other algorithms and garbage", async () => {
    const token = await signRoundToken(claims, 750);
    const [h, p, s] = token.split(".");
    const payload = JSON.parse(Buffer.from(p, "base64url").toString());
    const forged = `${h}.${Buffer.from(JSON.stringify({ ...payload, pos: 0 })).toString("base64url")}.${s}`;
    expect((await verifyRoundToken(forged, claims.startedAt)).ok).toBe(false);
    const none = `${Buffer.from('{"alg":"none"}').toString("base64url")}.${p}.`;
    expect(await verifyRoundToken(none, claims.startedAt)).toEqual({ ok: false, reason: "invalid" });
    expect(await verifyRoundToken("garbage", claims.startedAt)).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("participant cookie", () => {
  it("accepts only server-signed ids", () => {
    const id = newParticipantId();
    expect(decodeParticipantCookie(encodeParticipantCookie(id))).toBe(id);
    expect(decodeParticipantCookie(id)).toBeNull();
    expect(decodeParticipantCookie(`${newParticipantId()}.${encodeParticipantCookie(id).split(".")[1]}`)).toBeNull();
    expect(decodeParticipantCookie("not-a-uuid.sig")).toBeNull();
    expect(decodeParticipantCookie(undefined)).toBeNull();
  });

  it("hashes IPs one-way and consistently", () => {
    expect(hashIp("203.0.113.9")).toBe(hashIp("203.0.113.9"));
    expect(hashIp("203.0.113.9")).not.toContain("203");
    expect(hashIp(null)).toBeNull();
  });
});
