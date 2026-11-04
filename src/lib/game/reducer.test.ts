import { describe, expect, it } from "vitest";
import { QUESTIONS, READ_SECONDS, ROUND_COUNT, ROUND_SECONDS } from "@/data/questions";
import { MAX_GAME_SCORE } from "@/data/questions";
import { classifyRarity } from "@/lib/baseball/scoring";
import type { ScoreResult, ValidationResult } from "@/types/baseball";
import type { AnswerResponse, GameState } from "@/types/game";
import { SUBMIT_GRACE_MS, gameReducer, initialGameState, totalScore, type GameAction } from "./reducer";

const T0 = 1_000_000;
/** Answers open after the read period; the 30-second clock runs from here. */
const OPEN = T0 + READ_SECONDS * 1000;
const DEADLINE = OPEN + ROUND_SECONDS * 1000;

/** A valid answer with this estimated rarity (scored through the real tier table). */
const correct = (rarity: number): AnswerResponse => {
  const validation: ValidationResult = {
    status: "valid",
    playerId: "x",
    canonicalName: "Some Player",
    matchType: "exact",
    message: "",
  };
  const score: ScoreResult = { valid: true, ...classifyRarity(rarity), method: "curated", estimateNote: "" };
  return { validation, score };
};

/** Rejected answers carry only a status and a generic message. */
const wrongPlayer: AnswerResponse = { validation: { status: "ineligible", message: "nope" } };
const unknownName: AnswerResponse = { validation: { status: "unrecognized", message: "who?" } };
const ambiguous: AnswerResponse = { validation: { status: "ambiguous", message: "which?" } };
const suggestion: AnswerResponse = {
  validation: { status: "suggestion", suggestion: "Derek Jeter", message: "Did you mean Derek Jeter?" },
};

const run = (state: GameState, ...actions: GameAction[]) => actions.reduce(gameReducer, state);
const start = () => gameReducer(initialGameState, { type: "START", now: T0 });

/** Submit a guess for the current round and resolve it with `response`. */
const guess = (state: GameState, response: AnswerResponse, now = OPEN + 1000): GameState =>
  run(
    state,
    { type: "SUBMIT_STARTED", roundIndex: state.roundIndex, now },
    { type: "SUBMIT_RESOLVED", roundIndex: state.roundIndex, submittedText: "p", response, now },
  );

describe("gameReducer", () => {
  it("starts a game at round 1 with a 3-second read, then a 30-second clock", () => {
    expect(start()).toMatchObject({
      status: "playing",
      roundIndex: 0,
      answerOpensAt: T0 + 3000,
      deadline: T0 + 33_000,
      rounds: [],
      attempts: 0,
    });
    expect(DEADLINE - OPEN).toBe(30_000);
  });

  describe("read period", () => {
    it("rejects any submission before answers open", () => {
      const s = start();
      expect(gameReducer(s, { type: "SUBMIT_STARTED", roundIndex: 0, now: T0 })).toBe(s);
      expect(gameReducer(s, { type: "SUBMIT_STARTED", roundIndex: 0, now: OPEN - 1 })).toBe(s);
      expect(gameReducer(s, { type: "SUBMIT_STARTED", roundIndex: 0, now: OPEN }).pending).toBe(true);
    });

    it("cannot score during the read period", () => {
      const s = guess(start(), correct(60), T0 + 1000);
      expect(s).toMatchObject({ status: "playing", rounds: [], attempts: 0, pending: false });
    });

    it("gives every round its own read period", () => {
      let s = guess(start(), correct(60));
      s = gameReducer(s, { type: "NEXT_ROUND", now: T0 + 50_000 });
      expect(s).toMatchObject({ roundIndex: 1, answerOpensAt: T0 + 53_000, deadline: T0 + 83_000 });
    });

    it("restores a save from before the read period as already open", () => {
      const { answerOpensAt: _omit, ...old } = start();
      void _omit;
      const restored = gameReducer(initialGameState, { type: "HYDRATE", state: old as GameState, now: T0 + 1000 });
      expect(restored.answerOpensAt).toBeNull();
      expect(gameReducer(restored, { type: "SUBMIT_STARTED", roundIndex: 0, now: T0 + 1000 }).pending).toBe(true);
    });
  });

  /** Plays a full game: a number is a valid answer with that rarity, null is a timeout. */
  const playGame = (rarities: Array<number | null>) => {
    let s = start();
    for (const r of rarities) {
      s = r !== null ? guess(s, correct(r), s.deadline! - 1000) : gameReducer(s, { type: "TIMER_EXPIRED", roundIndex: s.roundIndex });
      expect(s.status).toBe("round-result");
      s = gameReducer(s, { type: "NEXT_ROUND", now: T0 });
    }
    return s;
  };

  it("plays all seven rounds and totals the fixed tier points", () => {
    const s = playGame([5, 20, 40, 60, 75, null, 100]);
    expect(s.status).toBe("game-complete");
    expect(s.rounds).toHaveLength(ROUND_COUNT);
    expect(s.rounds.map((r) => r.questionId)).toEqual(QUESTIONS.map((q) => q.id));
    expect(s.rounds.map((r) => r.score.tier)).toEqual(["bunt", "single", "double", "triple", "triple", "strikeout", "plakata"]);
    expect(s.rounds.map((r) => r.score.points)).toEqual([10, 25, 50, 75, 75, 0, 100]);
    expect(totalScore(s)).toBe(335);
    expect(totalScore(s)).toBe(s.rounds.reduce((sum, r) => sum + r.score.points, 0));
  });

  it("scores 700 for a perfect game and 0 for seven strikeouts", () => {
    expect(totalScore(playGame(Array(7).fill(100)))).toBe(MAX_GAME_SCORE);
    expect(MAX_GAME_SCORE).toBe(700);
    const shutout = playGame(Array(7).fill(null));
    expect(totalScore(shutout)).toBe(0);
    expect(shutout.rounds.every((r) => r.score.tier === "strikeout")).toBe(true);
  });

  it("awards a rarity-0 answer a Bunt, never zero", () => {
    const s = guess(start(), correct(0));
    expect(s.rounds[0].score).toMatchObject({ tier: "bunt", points: 10 });
  });

  describe("multiple attempts", () => {
    it("keeps the round open after a wrong player", () => {
      const s = guess(start(), wrongPlayer);
      expect(s).toMatchObject({ status: "playing", pending: false, attempts: 1, rounds: [], deadline: DEADLINE });
      expect(s.feedback?.status).toBe("ineligible");
    });

    it("keeps the round open after an unknown name", () => {
      const s = guess(start(), unknownName);
      expect(s).toMatchObject({ status: "playing", attempts: 1, rounds: [] });
      expect(s.feedback?.status).toBe("unrecognized");
    });

    it("allows many incorrect guesses, never touching the timer or score", () => {
      let s = start();
      for (let i = 1; i <= 5; i++) {
        s = guess(s, i % 2 ? wrongPlayer : unknownName, OPEN + i * 1000);
        expect(s).toMatchObject({ status: "playing", attempts: i, deadline: DEADLINE });
      }
      expect(totalScore(s)).toBe(0);
    });

    it("ends the round on the first valid answer and records prior wrong guesses", () => {
      let s = guess(guess(start(), wrongPlayer), unknownName);
      s = guess(s, correct(60));
      expect(s.status).toBe("round-result");
      expect(s.rounds[0]).toMatchObject({ timedOut: false, attempts: 2, submittedText: "Some Player" });
      expect(totalScore(s)).toBe(75); // rarity 60 → Triple
    });

    it("keeps the round open after an ambiguous name, counting it as an attempt", () => {
      const s = guess(start(), ambiguous);
      expect(s).toMatchObject({ status: "playing", attempts: 1, deadline: DEADLINE, rounds: [] });
      expect(s.feedback?.status).toBe("ambiguous");
    });

    it("treats a spelling suggestion as neither a wrong guess nor an answer", () => {
      const s = guess(guess(start(), wrongPlayer), suggestion);
      expect(s).toMatchObject({ status: "playing", attempts: 1, deadline: DEADLINE, rounds: [] });
      expect(s.feedback).toMatchObject({ status: "suggestion", suggestion: "Derek Jeter" });
    });

    it("keeps the round open while the user picks between namesakes", () => {
      const choose: AnswerResponse = {
        validation: {
          status: "choose",
          message: "Which one?",
          options: [
            { playerId: "a", name: "Luis Castillo", detail: "2017–2025" },
            { playerId: "b", name: "Luis Castillo", detail: "1996–2011" },
          ],
        },
      };
      const before = guess(start(), wrongPlayer);
      const s = guess(before, choose);
      expect(s).toMatchObject({ status: "playing", attempts: 1, deadline: DEADLINE, rounds: [] });
      expect(s.inputVersion).toBe(before.inputVersion); // typed text stays put
      expect(s.feedback?.options).toHaveLength(2);
      // Picking one sends another request; a valid answer then ends the round.
      expect(guess(s, correct(75)).rounds[0]).toMatchObject({ timedOut: false });
    });

    it("refreshes the input after every rejected guess or suggestion", () => {
      let s = start();
      expect(s.inputVersion).toBe(0);
      s = guess(s, wrongPlayer);
      expect(s.inputVersion).toBe(1);
      s = guess(s, suggestion);
      expect(s.inputVersion).toBe(2);
      s = guess(s, suggestion); // same suggestion again still re-fills the field
      expect(s.inputVersion).toBe(3);
    });

    it("ends the round if a suggestion arrives after the deadline", () => {
      const s = run(start(), { type: "SUBMIT_STARTED", roundIndex: 0, now: DEADLINE - 100 }, { type: "TIMER_EXPIRED", roundIndex: 0 });
      const after = gameReducer(s, { type: "SUBMIT_RESOLVED", roundIndex: 0, submittedText: "p", response: suggestion, now: DEADLINE + 100 });
      expect(after.status).toBe("round-result");
      expect(totalScore(after)).toBe(0);
    });

    it("clears the previous error message when a new guess is submitted", () => {
      const s = guess(start(), wrongPlayer);
      const next = gameReducer(s, { type: "SUBMIT_STARTED", roundIndex: 0, now: OPEN + 2000 });
      expect(next.feedback).toBeNull();
    });

    it("does not count a network failure as an attempt", () => {
      const s = run(
        start(),
        { type: "SUBMIT_STARTED", roundIndex: 0, now: OPEN },
        { type: "SUBMIT_FAILED", roundIndex: 0, message: "offline" },
      );
      expect(s).toMatchObject({ status: "playing", pending: false, attempts: 0, error: "offline" });
    });
  });

  describe("duplicate submissions", () => {
    it("ignores a second submit while one is pending", () => {
      const s = run(start(), { type: "SUBMIT_STARTED", roundIndex: 0, now: OPEN });
      expect(gameReducer(s, { type: "SUBMIT_STARTED", roundIndex: 0, now: OPEN })).toBe(s);
    });

    it("ignores a duplicate response for an already-resolved request", () => {
      const s = guess(start(), wrongPlayer);
      const dup = gameReducer(s, {
        type: "SUBMIT_RESOLVED", roundIndex: 0, submittedText: "p", response: wrongPlayer, now: OPEN + 1000,
      });
      expect(dup).toBe(s);
      expect(dup.attempts).toBe(1);
    });

    it("cannot score twice in the same round", () => {
      const s = guess(start(), correct(40));
      const again = guess(s, correct(100));
      expect(again.rounds).toHaveLength(1);
      expect(totalScore(again)).toBe(50); // rarity 40 → Double
    });
  });

  describe("timer", () => {
    it("expiring with no submission is a Strikeout worth zero", () => {
      const s = run(start(), { type: "TIMER_EXPIRED", roundIndex: 0 });
      expect(s.status).toBe("round-result");
      expect(s.rounds[0]).toMatchObject({ timedOut: true, submittedText: null, attempts: 0 });
      expect(s.rounds[0].score).toMatchObject({ tier: "strikeout", label: "Strikeout", points: 0, estimatedRarity: null });
    });

    it("records wrong guesses on a timed-out round, still a Strikeout", () => {
      const s = run(guess(guess(start(), wrongPlayer), wrongPlayer), { type: "TIMER_EXPIRED", roundIndex: 0 });
      expect(s.rounds[0]).toMatchObject({ timedOut: true, attempts: 2 });
      expect(s.rounds[0].score).toMatchObject({ tier: "strikeout", points: 0 });
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
      expect(totalScore(resolved)).toBe(75); // rarity 60 → Triple
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
    expect(s).toMatchObject({
      roundIndex: 1, attempts: 0, inputVersion: 0, feedback: null, error: null, deadline: T0 + 5000 + (READ_SECONDS + ROUND_SECONDS) * 1000,
    });
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
      const s = run(start(), { type: "SUBMIT_STARTED", roundIndex: 0, now: OPEN });
      expect(gameReducer(initialGameState, { type: "HYDRATE", state: s, now: T0 }).pending).toBe(false);
    });

    it("rejects corrupted saves", () => {
      const bad = { ...initialGameState, status: "round-result", rounds: [] } as GameState;
      expect(gameReducer(initialGameState, { type: "HYDRATE", state: bad, now: T0 })).toEqual(initialGameState);
      expect(
        gameReducer(initialGameState, { type: "HYDRATE", state: "nonsense" as unknown as GameState, now: T0 }),
      ).toEqual(initialGameState);
      // A save from before tiered scoring (points but no tier) is discarded.
      const done = guess(start(), correct(60));
      const legacy = {
        ...done,
        rounds: done.rounds.map((r) => ({ ...r, score: { valid: true, points: 60, rarityScore: 60 } })),
      } as unknown as GameState;
      expect(gameReducer(initialGameState, { type: "HYDRATE", state: legacy, now: T0 })).toEqual(initialGameState);
    });
  });
});
