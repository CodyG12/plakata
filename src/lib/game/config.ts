import { MAX_POINTS_PER_ROUND } from "@/lib/baseball/scoring";

/** Game rules shared by the server (authoritative) and the client (display only). */
export const ROUND_COUNT = 7;
/** Seconds to answer, counted by the server from when answers open. */
export const ROUND_SECONDS = 30;
/** Seconds to read each prompt before answers open (not part of the 30-second clock). */
export const READ_SECONDS = 3;
/**
 * Network allowance: a submission the server RECEIVES up to this long after
 * expiresAt is still on time. It covers a guess sent at 29.9s that arrives at
 * 30.2s. It can't be stretched: the client never sees or sets this clock.
 */
export const LATENCY_GRACE_MS = 750;
/** Best possible game: a Plákata every round (7 × 100 = 700). */
export const MAX_GAME_SCORE = ROUND_COUNT * MAX_POINTS_PER_ROUND;

export const GAME_MODES = ["daily", "random"] as const;
export type GameMode = (typeof GAME_MODES)[number];
