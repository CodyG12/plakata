import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { QUESTION_BANK } from "@/data/question-bank";
import { classifyRarity, noAnswerScore } from "@/lib/baseball/scoring";
import type { ScoreResult } from "@/types/baseball";
import type { ActiveRoundView, RoundResultView } from "@/types/api";
import { FinalResults } from "./FinalResults";
import { GameApp } from "./GameApp";
import { GameScreen } from "./GameScreen";
import { LandingScreen } from "./LandingScreen";
import { ProgressIndicator } from "./ProgressIndicator";
import { RoundResult } from "./RoundResult";
import { TIER_STYLES } from "./TierBadge";

const prompt = (i: number) => QUESTION_BANK[i].prompt;
const hit = (i: number, name: string, rarity: number): RoundResultView => {
  const score: ScoreResult = {
    valid: true,
    ...classifyRarity(rarity),
    method: rarity >= 80 ? "plakata" : "community",
    estimateNote: "Rarer than 40% of answers",
  };
  return { position: i, prompt: prompt(i), status: "answered", acceptedName: name, explanation: "Fits.", score, timedOut: false, attempts: 0 };
};
const miss = (i: number): RoundResultView => ({
  position: i,
  prompt: prompt(i),
  status: "expired",
  acceptedName: null,
  explanation: null,
  score: noAnswerScore(),
  timedOut: true,
  attempts: 3,
});

const noop = () => {};

describe("results screens", () => {
  it("round result shows the tier and its fixed points", () => {
    const html = renderToStaticMarkup(
      createElement(RoundResult, { round: hit(1, "Jay Buhner", 60), roundCount: 7, totalScore: 85, isLast: false, onNext: noop }),
    );
    expect(html).toContain("Jay Buhner");
    expect(html).toContain(">Triple<");
    expect(html).toContain("+75");
    expect(html).not.toContain("Estimated rarity");
    expect(html).not.toContain('role="meter"');
  });

  it("round result shows a Strikeout for a timed-out round", () => {
    const html = renderToStaticMarkup(createElement(RoundResult, { round: miss(0), roundCount: 7, totalScore: 0, isLast: false, onNext: noop }));
    expect(html).toContain(">Strikeout<");
    expect(html).toContain("+0");
  });

  it("round result celebrates a Plákata", () => {
    const html = renderToStaticMarkup(
      createElement(RoundResult, { round: hit(0, "Marty Marion", 95), roundCount: 7, totalScore: 100, isLast: false, onNext: noop }),
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
    const html = renderToStaticMarkup(createElement(FinalResults, { rounds, totalScore: total, mode: "daily", dailyDay: "2026-11-04", onPlayAgain: noop }));
    for (const label of ["Bunt", "Triple", "Single", "Strikeout", "Plákata", "Double"]) expect(html).toContain(`>${label}<`);
    expect(html).toContain(" / 700</span>");
    expect(html).toContain(`>${total}<`);
    expect(html).toContain("Daily Challenge · Nov 4");
  });

  it("landing screen lists the hit ladder and 700 max", () => {
    const html = renderToStaticMarkup(createElement(LandingScreen, { mode: "daily", onModeChange: noop, onStart: noop }));
    expect(html).toContain("Bunt 10 · Single 25 · Double 50 · Triple 75 · Plákata 100");
    expect(html).toContain("700 points possible");
  });
});

describe("game shell", () => {
  it("progress labels each played round with its tier", () => {
    const html = renderToStaticMarkup(
      createElement(ProgressIndicator, { roundIndex: 2, roundCount: 7, rounds: [hit(0, "Babe Ruth", 5), miss(1)] }),
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

  it("landing offers Daily (default) and Random modes only", () => {
    const html = renderToStaticMarkup(createElement(LandingScreen, { mode: "daily", onModeChange: noop, onStart: noop }));
    expect(html).toContain('role="radiogroup"');
    expect(html).toMatch(/aria-checked="true"[^>]*>Daily</);
    expect(html).toContain(">Random<");
    expect(html).not.toContain("Classic");
    expect(html).toContain("Swing Away");
  });

  it("round result shows the server's explanation and rarity note", () => {
    const html = renderToStaticMarkup(
      createElement(RoundResult, { round: hit(1, "Jay Buhner", 60), roundCount: 7, totalScore: 75, isLast: true, onNext: noop }),
    );
    expect(html).toContain("Fits.");
    expect(html).toContain("Rarer than 40% of answers.");
    expect(html).toContain("See final results");
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
    const now = Date.now();
    const round: ActiveRoundView = {
      roundId: "r1",
      position: 0,
      prompt: prompt(0),
      startedAt: now,
      opensAt: now + 3000,
      expiresAt: now + 33000,
      token: "t",
      attempts: 0,
    };
    const html = renderToStaticMarkup(
      createElement(GameScreen, {
        round,
        rounds: [],
        roundCount: 7,
        totalScore: 0,
        clockOffset: 0,
        pending: false,
        feedback: null,
        attempts: 0,
        inputVersion: 0,
        timeUp: false,
        error: null,
        onExpire: noop,
        onSubmit: noop,
        onChoose: noop,
      }),
    );
    expect(html).toContain(prompt(0));
    expect(html).toMatch(/role="status"[^>]*>.*<\/p>/); // the read-period countdown
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("Submit");
    expect(html).toContain(">30<"); // the 30-second clock hasn't started
  });

  it("landing rules mention the read period", () => {
    expect(renderToStaticMarkup(createElement(LandingScreen, { mode: "daily", onModeChange: noop, onStart: noop }))).toContain(
      "3 seconds to read the prompt before the clock starts",
    );
  });
});
