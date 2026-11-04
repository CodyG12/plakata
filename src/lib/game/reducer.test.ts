import { describe, expect, it } from "vitest";
import { QUESTIONS, ROUND_COUNT, ROUND_SECONDS } from "@/data/questions";
import type { ScoreResult, ValidationResult } from "@/types/baseball";
import type { AnswerResponse, GameState } from "@/types/game";
import { SUBMIT_GRACE_MS, gameReducer, initialGameState, totalScore, type GameAction } from "./reducer";

const T0 = 1_000_000;
const DEADLINE = T0 + ROUND_SECONDS * 1000;

/** A valid answer worth `points`. */
const correct = (points: number): AnswerResponse => {
  const validation: ValidationResult = {
    status: "valid",
    valid: true,
    playerId: "x",
    canonicalName: "Some Player",
    reason: "",
  };
  const score: ScoreResult = { valid: true, points, rarityScore: points, method: "curated", label: "" };
  return { validation, score };
};

/** A real player who doesn't fit the question (the API includes a zero score). */
const wrongPlayer: AnswerResponse = {
  validation: { status: "invalid", valid: false, playerId: "y", canonicalName: "Wrong Guy", reason: "nope" },
  score: { valid: false, points: 0, rarityScore: 0, method: "none", label: "No points" },
};
const unknownName: AnswerResponse = { validation: { status: "not-found", valid: false, reason: "who?" } };
const ambiguous: AnswerResponse = {
  validation: { status: "ambiguous", valid: false, reason: "which?", candidates: [{ id: "a", name: "A", detail: "" }] },
};

const run = (state: GameState, ...actions: GameAction[]) => actions.reduce(gameReducer, state);
const start = () => gameReducer(initialGameState, { type: "START", now: T0 });

/** Submit a guess for the current round and resolve it with `response`. */
const guess = (state: GameState, response: AnswerResponse, now = T0 + 1000): GameState =>
  run(
    state,
    { type: "SUBMIT_STARTED", roundIndex: state.roundIndex, now },
    { type: "SUBMIT_RESOLVED", roundIndex: state.roundIndex, submittedText: "p", response, now },
  );

describe("gameReducer", () => {
  it("starts a game at round 1 with a 30-second deadline", () => {
    expect(start()).toMatchObject({ status: "playing", roundIndex: 0, deadline: DEADLINE, rounds: [], attempts: 0 });
  });

  it("plays all seven rounds and totals the score", () => {
    let s = start();
    const points = [5, 20, 40, 60, 75, 0, 100];
    for (const p of points) {
      s = p > 0 ? guess(s, correct(p), s.deadline! - 1000) : gameReducer(s, { type: "TIMER_EXPIRED", roundIndex: s.roundIndex });
      expect(s.status).toBe("round-result");
      s = gameReducer(s, { type: "NEXT_ROUND", now: T0 });
    }
    expect(s.status).toBe("game-complete");
    expect(s.rounds).toHaveLength(ROUND_COUNT);
    expect(s.rounds.map((r) => r.questionId)).toEqual(QUESTIONS.map((q) => q.id));
    expect(totalScore(s)).toBe(points.reduce((a, b) => a + b, 0));
  });

  describe("multiple attempts", () => {
    it("keeps the round open after a wrong player", () => {
      const s = guess(start(), wrongPlayer);
      expect(s).toMatchObject({ status: "playing", pending: false, attempts: 1, rounds: [], deadline: DEADLINE });
      expect(s.feedback?.status).toBe("invalid");
    });

    it("keeps the round open after an unknown name", () => {
      const s = guess(start(), unknownName);
      expect(s).toMatchObject({ status: "playing", attempts: 1, rounds: [] });
      expect(s.feedback?.status).toBe("not-found");
    });

    it("allows many incorrect guesses, never touching the timer or score", () => {
      let s = start();
      for (let i = 1; i <= 5; i++) {
        s = guess(s, i % 2 ? wrongPlayer : unknownName, T0 + i * 1000);
        expect(s).toMatchObject({ status: "playing", attempts: i, deadline: DEADLINE });
      }
      expect(totalScore(s)).toBe(0);
    });

    it("ends the round on the first valid answer and records prior wrong guesses", () => {
      let s = guess(guess(start(), wrongPlayer), unknownName);
      s = guess(s, correct(60));
      expect(s.status).toBe("round-result");
      expect(s.rounds[0]).toMatchObject({ timedOut: false, attempts: 2, submittedText: "Some Player" });
      expect(totalScore(s)).toBe(60);
    });

    it("does not count an ambiguous name as an attempt", () => {
      const s = guess(start(), ambiguous);
      expect(s).toMatchObject({ status: "playing", attempts: 0 });
      expect(s.feedback?.status).toBe("ambiguous");
    });

    it("clears the previous error message when a new guess is submitted", () => {
      const s = guess(start(), wrongPlayer);
      const next = gameReducer(s, { type: "SUBMIT_STARTED", roundIndex: 0, now: T0 + 2000 });
      expect(next.feedback).toBeNull();
    });

    it("does not count a network failure as an attempt", () => {
      const s = run(
        start(),
        { type: "SUBMIT_STARTED", roundIndex: 0, now: T0 },
        { type: "SUBMIT_FAILED", roundIndex: 0, message: "offline" },
      );
      expect(s).toMatchObject({ status: "playing", pending: false, attempts: 0, error: "offline" });
    });
  });

  describe("duplicate submissions", () => {
    it("ignores a second submit while one is pending", () => {
      const s = run(start(), { type: "SUBMIT_STARTED", roundIndex: 0, now: T0 });
      expect(gameReducer(s, { type: "SUBMIT_STARTED", roundIndex: 0, now: T0 })).toBe(s);
    });

    it("ignores a duplicate response for an already-resolved request", () => {
      const s = guess(start(), wrongPlayer);
      const dup = gameReducer(s, {
        type: "SUBMIT_RESOLVED", roundIndex: 0, submittedText: "p", response: wrongPlayer, now: T0 + 1000,
      });
      expect(dup).toBe(s);
      expect(dup.attempts).toBe(1);
    });

    it("cannot score twice in the same round", () => {
      const s = guess(start(), correct(40));
      const again = guess(s, correct(100));
      expect(again.rounds).toHaveLength(1);
      expect(totalScore(again)).toBe(40);
    });
  });

  describe("timer", () => {
    it("expiring gives zero points and shows the result", () => {
      const s = run(start(), { type: "TIMER_EXPIRED", roundIndex: 0 });
      expect(s.status).toBe("round-result");
      expect(s.rounds[0]).toMatchObject({ timedOut: true, submittedText: null, attempts: 0 });
      expect(s.rounds[0].score.points).toBe(0);
    });

    it("records wrong guesses on a timed-out round", () => {
      const s = run(guess(guess(start(), wrongPlayer), wrongPlayer), { type: "TIMER_EXPIRED", roundIndex: 0 });
      expect(s.rounds[0]).toMatchObject({ timedOut: true, attempts: 2 });
    });

    it("rejects a submission started at or after the deadline", () => {
      const s = start();
      expect(gameReducer(s, { type: "SUBMIT_STARTED", roundIndex: 0, now: DEADLINE })).toBe(s);
    });

    it("rejects submissions after the round has expired", () => {
      const s = run(start(), { type: "TIMER_EXPIRED", roundIndex: 0 });
      const after = guess(s, correct(100));
      expect(after.rounds).toHaveLength(1);
      expect(totalScore(after)).toBe(0);
    });

    it("waits for an in-flight guess, then honors a correct one sent before the deadline", () => {
      const s = run(start(), { type: "SUBMIT_STARTED", roundIndex: 0, now: DEADLINE - 100 }, { type: "TIMER_EXPIRED", roundIndex: 0 });
      expect(s.status).toBe("playing");
      const resolved = gameReducer(s, {
        type: "SUBMIT_RESOLVED", roundIndex: 0, submittedText: "p", response: correct(60), now: DEADLINE + 500,
      });
      expect(resolved.rounds[0]).toMatchObject({ timedOut: false });
      expect(totalScore(resolved)).toBe(60);
    });

    it("never awards points for a correct response that arrives far too late", () => {
      const s = run(start(), { type: "SUBMIT_STARTED", roundIndex: 0, now: DEADLINE - 100 });
      const late = gameReducer(s, {
        type: "SUBMIT_RESOLVED", roundIndex: 0, submittedText: "p", response: correct(60), now: DEADLINE + SUBMIT_GRACE_MS + 1,
      });
      expect(late.rounds[0]).toMatchObject({ timedOut: true });
      expect(totalScore(late)).toBe(0);
    });

    it("ends the round if an incorrect guess resolves after the deadline", () => {
      const s = run(start(), { type: "SUBMIT_STARTED", roundIndex: 0, now: DEADLINE - 100 }, { type: "TIMER_EXPIRED", roundIndex: 0 });
      for (const response of [wrongPlayer, unknownName, ambiguous]) {
        const after = gameReducer(s, { type: "SUBMIT_RESOLVED", roundIndex: 0, submittedText: "p", response, now: DEADLINE + 100 });
        expect(after.status).toBe("round-result");
        expect(after.rounds[0]).toMatchObject({ timedOut: true, attempts: 0 });
      }
    });
  });

  it("ignores stale actions for an earlier round", () => {
    let s = guess(start(), correct(20));
    s = gameReducer(s, { type: "NEXT_ROUND", now: T0 });
    expect(gameReducer(s, { type: "TIMER_EXPIRED", roundIndex: 0 })).toBe(s);
    expect(gameReducer(s, { type: "SUBMIT_STARTED", roundIndex: 0, now: T0 })).toBe(s);
    expect(
      gameReducer(s, { type: "SUBMIT_RESOLVED", roundIndex: 0, submittedText: "p", response: correct(99), now: T0 }),
    ).toBe(s);
  });

  it("starts each round with a fresh attempt count and no messages", () => {
    let s = guess(guess(start(), wrongPlayer), correct(40));
    s = gameReducer(s, { type: "NEXT_ROUND", now: T0 + 5000 });
    expect(s).toMatchObject({ roundIndex: 1, attempts: 0, feedback: null, error: null, deadline: T0 + 5000 + ROUND_SECONDS * 1000 });
  });

  it("cannot skip ahead to an unplayed round", () => {
    const s = start();
    expect(gameReducer(s, { type: "NEXT_ROUND", now: T0 })).toBe(s);
  });

  it("restart resets everything", () => {
    const s = guess(guess(start(), wrongPlayer), correct(75));
    expect(gameReducer(s, { type: "RESTART" })).toEqual(initialGameState);
    const mid = guess(start(), wrongPlayer);
    expect(gameReducer(mid, { type: "RESTART" })).toEqual(initialGameState);
    expect(gameReducer(mid, { type: "START", now: T0 + 5 })).toMatchObject({
      roundIndex: 0, rounds: [], attempts: 0, feedback: null, status: "playing",
    });
  });

  describe("HYDRATE", () => {
    it("restores an in-progress round, keeping its deadline and attempts", () => {
      const s = guess(start(), wrongPlayer);
      const restored = gameReducer(initialGameState, { type: "HYDRATE", state: s, now: T0 + 2000 });
      expect(restored).toMatchObject({ status: "playing", deadline: DEADLINE, attempts: 1, feedback: null });
    });

    it("expires a round whose deadline passed while away", () => {
      const restored = gameReducer(initialGameState, { type: "HYDRATE", state: start(), now: DEADLINE + 1 });
      expect(restored.status).toBe("round-result");
      expect(restored.rounds[0].timedOut).toBe(true);
    });

    it("clears a stale pending flag", () => {
      const s = run(start(), { type: "SUBMIT_STARTED", roundIndex: 0, now: T0 });
      expect(gameReducer(initialGameState, { type: "HYDRATE", state: s, now: T0 }).pending).toBe(false);
    });

    it("rejects corrupted saves", () => {
      const bad = { ...initialGameState, status: "round-result", rounds: [] } as GameState;
      expect(gameReducer(initialGameState, { type: "HYDRATE", state: bad, now: T0 })).toEqual(initialGameState);
      expect(
        gameReducer(initialGameState, { type: "HYDRATE", state: "nonsense" as unknown as GameState, now: T0 }),
      ).toEqual(initialGameState);
    });
  });
});
