import { describe, expect, it } from "vitest";
import { QUESTIONS, ROUND_COUNT, ROUND_SECONDS } from "@/data/questions";
import type { ScoreResult, ValidationResult } from "@/types/baseball";
import type { AnswerResponse, GameState } from "@/types/game";
import { SUBMIT_GRACE_MS, gameReducer, initialGameState, totalScore, type GameAction } from "./reducer";

const T0 = 1_000_000;

const answer = (points: number): AnswerResponse => {
  const validation: ValidationResult = {
    status: points > 0 ? "valid" : "invalid",
    valid: points > 0,
    playerId: "x",
    canonicalName: "Some Player",
    reason: "",
  };
  const score: ScoreResult = { valid: points > 0, points, rarityScore: points, method: "curated", label: "" };
  return { validation, score };
};

const run = (state: GameState, ...actions: GameAction[]) => actions.reduce(gameReducer, state);

/** Submit and resolve the current round with the given points. */
const play = (state: GameState, points: number, now = T0): GameState =>
  run(
    state,
    { type: "SUBMIT_STARTED", roundIndex: state.roundIndex },
    { type: "SUBMIT_RESOLVED", roundIndex: state.roundIndex, submittedText: "p", response: answer(points), now },
  );

describe("gameReducer", () => {
  it("starts a game at round 1 with a 30-second deadline", () => {
    const s = gameReducer(initialGameState, { type: "START", now: T0 });
    expect(s).toMatchObject({ status: "playing", roundIndex: 0, deadline: T0 + ROUND_SECONDS * 1000, rounds: [] });
  });

  it("plays all seven rounds and totals the score", () => {
    let s = gameReducer(initialGameState, { type: "START", now: T0 });
    const points = [5, 20, 40, 60, 75, 0, 100];
    for (const p of points) {
      s = play(s, p);
      expect(s.status).toBe("round-result");
      s = gameReducer(s, { type: "NEXT_ROUND", now: T0 });
    }
    expect(s.status).toBe("game-complete");
    expect(s.rounds).toHaveLength(ROUND_COUNT);
    expect(s.rounds.map((r) => r.questionId)).toEqual(QUESTIONS.map((q) => q.id));
    expect(totalScore(s)).toBe(points.reduce((a, b) => a + b, 0));
  });

  it("prevents a second submission while one is pending", () => {
    const s = run(
      initialGameState,
      { type: "START", now: T0 },
      { type: "SUBMIT_STARTED", roundIndex: 0 },
    );
    expect(gameReducer(s, { type: "SUBMIT_STARTED", roundIndex: 0 })).toBe(s);
  });

  it("prevents submitting twice for the same round", () => {
    const s = play(gameReducer(initialGameState, { type: "START", now: T0 }), 40);
    const again = play(s, 100);
    expect(again.rounds).toHaveLength(1);
    expect(totalScore(again)).toBe(40);
  });

  it("gives zero points when the timer expires and shows the result", () => {
    const s = run(initialGameState, { type: "START", now: T0 }, { type: "TIMER_EXPIRED", roundIndex: 0 });
    expect(s.status).toBe("round-result");
    expect(s.rounds[0]).toMatchObject({ timedOut: true, submittedText: null });
    expect(s.rounds[0].score.points).toBe(0);
  });

  it("rejects submissions after the timer expires", () => {
    const s = run(initialGameState, { type: "START", now: T0 }, { type: "TIMER_EXPIRED", roundIndex: 0 });
    const after = play(s, 100);
    expect(after.rounds).toHaveLength(1);
    expect(totalScore(after)).toBe(0);
  });

  it("lets an in-flight submission resolve, but not one that is far too late", () => {
    const start = run(
      initialGameState,
      { type: "START", now: T0 },
      { type: "SUBMIT_STARTED", roundIndex: 0 },
      { type: "TIMER_EXPIRED", roundIndex: 0 },
    );
    expect(start.status).toBe("playing"); // waits for the pending response
    const deadline = start.deadline!;

    const onTime = gameReducer(start, {
      type: "SUBMIT_RESOLVED", roundIndex: 0, submittedText: "p", response: answer(60), now: deadline + 500,
    });
    expect(onTime.rounds[0].score.points).toBe(60);

    const late = gameReducer(start, {
      type: "SUBMIT_RESOLVED", roundIndex: 0, submittedText: "p", response: answer(60), now: deadline + SUBMIT_GRACE_MS + 1,
    });
    expect(late.rounds[0]).toMatchObject({ timedOut: true });
    expect(late.rounds[0].score.points).toBe(0);
  });

  it("keeps the round open for not-found or ambiguous answers", () => {
    const s = run(
      initialGameState,
      { type: "START", now: T0 },
      { type: "SUBMIT_STARTED", roundIndex: 0 },
      {
        type: "SUBMIT_RESOLVED",
        roundIndex: 0,
        submittedText: "Roy Hobbs",
        response: { validation: { status: "not-found", valid: false, reason: "nope" } },
        now: T0,
      },
    );
    expect(s).toMatchObject({ status: "playing", pending: false, rounds: [] });
    expect(s.feedback?.status).toBe("not-found");
  });

  it("expires the round if a retryable answer comes back after the deadline", () => {
    const s = run(
      initialGameState,
      { type: "START", now: T0 },
      { type: "SUBMIT_STARTED", roundIndex: 0 },
      { type: "TIMER_EXPIRED", roundIndex: 0 },
    );
    const after = gameReducer(s, {
      type: "SUBMIT_RESOLVED",
      roundIndex: 0,
      submittedText: "Roy Hobbs",
      response: { validation: { status: "not-found", valid: false, reason: "nope" } },
      now: s.deadline! + 100,
    });
    expect(after.status).toBe("round-result");
    expect(after.rounds[0].timedOut).toBe(true);
  });

  it("ignores stale actions for other rounds", () => {
    let s = play(gameReducer(initialGameState, { type: "START", now: T0 }), 20);
    s = gameReducer(s, { type: "NEXT_ROUND", now: T0 });
    expect(gameReducer(s, { type: "TIMER_EXPIRED", roundIndex: 0 })).toBe(s);
    expect(gameReducer(s, { type: "SUBMIT_STARTED", roundIndex: 0 })).toBe(s);
  });

  it("cannot skip ahead to an unplayed round", () => {
    const s = gameReducer(initialGameState, { type: "START", now: T0 });
    expect(gameReducer(s, { type: "NEXT_ROUND", now: T0 })).toBe(s);
  });

  it("restart resets everything", () => {
    const s = play(gameReducer(initialGameState, { type: "START", now: T0 }), 75);
    expect(gameReducer(s, { type: "RESTART" })).toEqual(initialGameState);
    const replay = gameReducer(s, { type: "START", now: T0 + 5 });
    expect(replay).toMatchObject({ roundIndex: 0, rounds: [], status: "playing" });
  });

  describe("HYDRATE", () => {
    it("restores an in-progress round", () => {
      const s = gameReducer(initialGameState, { type: "START", now: T0 });
      const restored = gameReducer(initialGameState, { type: "HYDRATE", state: s, now: T0 + 1000 });
      expect(restored).toMatchObject({ status: "playing", deadline: s.deadline });
    });

    it("expires a round whose deadline passed while away", () => {
      const s = gameReducer(initialGameState, { type: "START", now: T0 });
      const restored = gameReducer(initialGameState, { type: "HYDRATE", state: s, now: s.deadline! + 1 });
      expect(restored.status).toBe("round-result");
      expect(restored.rounds[0].timedOut).toBe(true);
    });

    it("clears a stale pending flag", () => {
      const s = run(initialGameState, { type: "START", now: T0 }, { type: "SUBMIT_STARTED", roundIndex: 0 });
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
