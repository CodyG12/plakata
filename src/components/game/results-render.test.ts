import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { QUESTIONS } from "@/data/questions";
import { noAnswerScore } from "@/lib/baseball/calculate-rarity";
import { classifyRarity } from "@/lib/baseball/scoring";
import type { ScoreResult } from "@/types/baseball";
import type { RoundRecord } from "@/types/game";
import { gameReducer, initialGameState } from "@/lib/game/reducer";
import { FinalResults } from "./FinalResults";
import { GameApp } from "./GameApp";
import { GameScreen } from "./GameScreen";
import { LandingScreen } from "./LandingScreen";
import { ProgressIndicator } from "./ProgressIndicator";
import { RoundResult } from "./RoundResult";
import { TIER_STYLES } from "./TierBadge";

const hit = (i: number, name: string, rarity: number): RoundRecord => {
  const score: ScoreResult = { valid: true, ...classifyRarity(rarity), method: "curated", estimateNote: "Famous answer" };
  return {
    questionId: QUESTIONS[i].id,
    submittedText: name,
    validation: { status: "valid", playerId: "x", canonicalName: name, message: "Fits." },
    score,
    timedOut: false,
    attempts: 0,
  };
};
const miss = (i: number): RoundRecord => ({
  questionId: QUESTIONS[i].id,
  submittedText: null,
  validation: null,
  score: noAnswerScore(),
  timedOut: true,
  attempts: 3,
});

const noop = () => {};

describe("results screens", () => {
  it("round result shows the tier and its fixed points", () => {
    const html = renderToStaticMarkup(
      createElement(RoundResult, { round: hit(1, "Jay Buhner", 60), roundIndex: 1, totalScore: 85, onNext: noop }),
    );
    expect(html).toContain("Jay Buhner");
    expect(html).toContain(">Triple<");
    expect(html).toContain("+75");
    expect(html).not.toContain("Estimated rarity");
    expect(html).not.toContain('role="meter"');
  });

  it("round result shows a Strikeout for a timed-out round", () => {
    const html = renderToStaticMarkup(createElement(RoundResult, { round: miss(0), roundIndex: 0, totalScore: 0, onNext: noop }));
    expect(html).toContain(">Strikeout<");
    expect(html).toContain("+0");
  });

  it("round result celebrates a Plákata", () => {
    const html = renderToStaticMarkup(
      createElement(RoundResult, { round: hit(0, "Marty Marion", 95), roundIndex: 0, totalScore: 100, onNext: noop }),
    );
    expect(html).toContain(">Plákata<");
    expect(html).toContain("animate-homer-y");
  });

  it("final results list each round's tier and points, totaling out of 700", () => {
    const rounds = [
      hit(0, "Babe Ruth", 5),
      hit(1, "Jay Buhner", 60),
      hit(2, "Ichiro Suzuki", 20),
      miss(3),
      hit(4, "Marty Marion", 90),
      hit(5, "Somebody", 45),
      miss(6),
    ];
    const total = rounds.reduce((sum, r) => sum + r.score.points, 0);
    expect(total).toBe(10 + 75 + 25 + 0 + 100 + 50 + 0);
    const html = renderToStaticMarkup(createElement(FinalResults, { rounds, totalScore: total, onPlayAgain: noop }));
    for (const label of ["Bunt", "Triple", "Single", "Strikeout", "Plákata", "Double"]) expect(html).toContain(`>${label}<`);
    expect(html).toContain(" / 700</span>");
    expect(html).toContain(`>${total}<`);
  });

  it("landing screen lists the hit ladder and 700 max", () => {
    const html = renderToStaticMarkup(createElement(LandingScreen, { onStart: noop }));
    expect(html).toContain("Bunt 10 · Single 25 · Double 50 · Triple 75 · Plákata 100");
    expect(html).toContain("700 points possible");
  });
});

describe("game shell", () => {
  it("progress labels each played round with its tier", () => {
    const html = renderToStaticMarkup(
      createElement(ProgressIndicator, { roundIndex: 2, rounds: [hit(0, "Babe Ruth", 5), miss(1)] }),
    );
    expect(html).toContain('aria-label="Round 1: Bunt, 10 points"');
    expect(html).toContain('aria-label="Round 2: Strikeout, 0 points"');
    expect(html).toContain('aria-label="Round 3: in progress"');
  });

  it("app starts on the landing screen with the new scoring rules", () => {
    const html = renderToStaticMarkup(createElement(GameApp));
    expect(html).toContain("700 points possible");
    expect(html).toContain("strikeout");
  });

  it("every tier color and animation class has a matching theme token", () => {
    const css = readFileSync(fileURLToPath(new URL("../../app/globals.css", import.meta.url)), "utf8");
    const classes = Object.values(TIER_STYLES).flatMap((s) => `${s.badge} ${s.text}`.split(/\s+/));
    const tokens = new Set(
      classes.flatMap((c) => c.match(/^(?:bg|text|ring)-((?:single|double|triple)-\d+)$/)?.[1] ?? []),
    );
    expect(tokens.size).toBeGreaterThan(0);
    for (const token of tokens) expect(css, token).toContain(`--color-${token}:`);
    for (const anim of ["glow", "homer-x", "homer-y"]) {
      expect(css).toContain(`--animate-${anim}:`);
      expect(css).toContain(`@keyframes ${anim} `);
    }
  });
});

describe("read period", () => {
  it("opens each round with only the prompt: no answer field or submit button", () => {
    const state = gameReducer(initialGameState, { type: "START", now: 1_000_000 });
    const html = renderToStaticMarkup(
      createElement(GameScreen, { state, totalScore: 0, onExpire: noop, onSubmit: noop, onChoose: noop }),
    );
    expect(html).toContain(QUESTIONS[0].prompt);
    expect(html).toMatch(/role="status"[^>]*>.*<\/p>/); // the read-period countdown
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("Submit");
    expect(html).toContain(">30<"); // the 30-second clock hasn't started
  });

  it("landing rules mention the read period", () => {
    expect(renderToStaticMarkup(createElement(LandingScreen, { onStart: noop }))).toContain(
      "3 seconds to read the prompt before the clock starts",
    );
  });
});
