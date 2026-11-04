"use client";

import { CircleHelp, CircleX, Users } from "lucide-react";
import { QUESTIONS } from "@/data/questions";
import { useCountdown } from "@/lib/game/use-countdown";
import type { PlayerSummary } from "@/types/baseball";
import type { GameState } from "@/types/game";
import { AnswerInput } from "./AnswerInput";
import { CountdownTimer } from "./CountdownTimer";
import { ProgressIndicator } from "./ProgressIndicator";

interface GameScreenProps {
  state: GameState;
  totalScore: number;
  onExpire: () => void;
  onSubmitText: (text: string) => void;
  onSubmitPlayer: (player: PlayerSummary) => void;
}

export function GameScreen({ state, totalScore, onExpire, onSubmitText, onSubmitPlayer }: GameScreenProps) {
  const remainingMs = useCountdown(state.deadline, onExpire);
  const question = QUESTIONS[state.roundIndex];
  const timeUp = remainingMs <= 0;
  const feedback = state.feedback;

  return (
    <section className="flex flex-col gap-8" aria-labelledby="question">
      <header className="flex items-center justify-between gap-4">
        <ProgressIndicator roundIndex={state.roundIndex} rounds={state.rounds} />
        <div className="flex items-center gap-5">
          <div className="text-right">
            <span className="block text-xs font-medium uppercase tracking-[0.16em] text-navy-300">Score</span>
            <span className="font-mono text-xl font-semibold tabular-nums text-cream-50">{totalScore}</span>
          </div>
          <CountdownTimer remainingMs={remainingMs} />
        </div>
      </header>

      {/* GameApp keys this whole screen by round, so the input and animation reset per round. */}
      <div className="animate-rise">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-stitch-400">
          Round {state.roundIndex + 1}
        </p>
        <h1
          id="question"
          className="font-display text-3xl font-semibold leading-tight text-balance text-cream-50 sm:text-[2.6rem] sm:leading-[1.1]"
        >
          {question.prompt}
        </h1>
        <p className="mt-3 text-[15px] text-navy-300">Rarer players score more. One locked-in answer per round.</p>
      </div>

      <AnswerInput
        disabled={timeUp}
        pending={state.pending}
        onSubmitText={onSubmitText}
        onSubmitPlayer={onSubmitPlayer}
      />

      <div aria-live="polite" className="min-h-6">
        {feedback?.status === "ambiguous" && feedback.candidates && (
          <div className="rounded-2xl bg-navy-900/80 p-4 ring-1 ring-navy-700 animate-rise sm:p-5">
            <p className="flex items-start gap-2 text-[15px] text-cream-100">
              <Users className="mt-0.5 size-4 shrink-0 text-cream-300" aria-hidden />
              {feedback.reason}
            </p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {feedback.candidates.map((candidate) => (
                <button
                  key={candidate.id}
                  type="button"
                  disabled={state.pending || timeUp}
                  onClick={() => onSubmitPlayer(candidate)}
                  className="rounded-xl bg-navy-800 px-4 py-3 text-left ring-1 ring-navy-700 transition hover:bg-navy-700 hover:ring-cream-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cream-100 disabled:opacity-50"
                >
                  <span className="block font-semibold text-cream-50">{candidate.name}</span>
                  <span className="block text-xs text-navy-300">{candidate.detail}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {feedback && feedback.status !== "ambiguous" && (
          <p className="flex items-start gap-2 rounded-xl bg-stitch-600/15 px-4 py-3 text-[15px] text-stitch-100 ring-1 ring-stitch-500/40 animate-rise">
            <CircleX className="mt-0.5 size-4 shrink-0 text-stitch-400" aria-hidden />
            <span>
              {feedback.reason} <span className="text-cream-300">The clock is still running — try again.</span>
            </span>
          </p>
        )}
        {!feedback && timeUp && (
          <p className="flex items-center gap-2 text-[15px] text-cream-300">
            <CircleHelp className="size-4" aria-hidden /> Time&apos;s up…
          </p>
        )}
      </div>
    </section>
  );
}
