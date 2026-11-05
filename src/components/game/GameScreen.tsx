"use client";

import {
  BookOpen,
  CircleHelp,
  CircleX,
  CornerDownLeft,
  SearchX,
  SpellCheck,
  TriangleAlert,
  Users,
} from "lucide-react";
import { useCountdown } from "@/lib/game/use-countdown";
import type { ValidationResult, ValidationStatus } from "@/types/baseball";
import type { ActiveRoundView, RoundResultView } from "@/types/api";
import { AnswerInput } from "./AnswerInput";
import { CountdownTimer } from "./CountdownTimer";
import { ProgressIndicator } from "./ProgressIndicator";

interface GameScreenProps {
  /** The running round, from the server. Its times are on the server clock. */
  round: ActiveRoundView;
  /** Completed rounds, for the progress bar. */
  rounds: RoundResultView[];
  roundCount: number;
  totalScore: number;
  /** Server clock minus local clock (ms). */
  clockOffset: number;
  pending: boolean;
  feedback: ValidationResult | null;
  attempts: number;
  inputVersion: number;
  /** The local countdown has run out; the server is settling the round. */
  timeUp: boolean;
  error: string | null;
  onExpire: () => void;
  onSubmit: (text: string) => void;
  /** Pick one of several namesakes who all fit the question. */
  onChoose: (playerId: string) => void;
}

const FEEDBACK_ICONS: Partial<Record<ValidationStatus, typeof CircleX>> = {
  ineligible: CircleX,
  ambiguous: Users,
  unrecognized: SearchX,
};

export function GameScreen({
  round,
  rounds,
  roundCount,
  totalScore,
  clockOffset,
  pending,
  feedback,
  attempts,
  inputVersion,
  timeUp: settling,
  error,
  onExpire,
  onSubmit,
  onChoose,
}: GameScreenProps) {
  // Display only: the server's expiresAt converted to this device's clock. The server
  // independently enforces the deadline, so a wrong local clock can't buy extra time.
  const remaining = useCountdown(round.expiresAt - clockOffset, onExpire);
  // The answer clock runs from opensAt to expiresAt; before that, the player reads.
  const answerWindowMs = round.expiresAt - round.opensAt;
  const reading = remaining === null || remaining > answerWindowMs;
  const readSecondsLeft =
    remaining === null ? null : Math.ceil((remaining - answerWindowMs) / 1000);
  const clockMs =
    remaining === null ? answerWindowMs : Math.min(remaining, answerWindowMs);
  const timeUp = settling || (remaining !== null && remaining <= 0);
  const FeedbackIcon = feedback
    ? (FEEDBACK_ICONS[feedback.status] ?? CircleX)
    : CircleX;
  const suggestion =
    feedback?.status === "suggestion" ? feedback.suggestion : undefined;
  const options = feedback?.status === "choose" ? feedback.options : undefined;

  return (
    <section className="flex flex-col gap-8" aria-labelledby="question">
      <header className="flex items-center justify-between gap-4">
        <ProgressIndicator
          roundIndex={round.position}
          roundCount={roundCount}
          rounds={rounds}
        />
        <div className="flex items-center gap-5">
          <div className="text-right">
            <span className="block text-xs font-medium uppercase tracking-[0.16em] text-navy-300">
              Score
            </span>
            <span className="font-mono text-xl font-semibold tabular-nums text-cream-50">
              {totalScore}
            </span>
          </div>
          <CountdownTimer remainingMs={clockMs} waiting={reading} />
        </div>
      </header>

      {/* GameApp keys this whole screen by round, so everything resets per round. */}
      <div className="animate-rise">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-stitch-400">
          Round {round.position + 1}
        </p>
        <h1
          id="question"
          className="font-display text-3xl font-semibold leading-tight text-balance text-cream-50 sm:text-[2.6rem] sm:leading-[1.1]"
        >
          {round.prompt}
        </h1>
        <p className="mt-3 text-[15px] text-navy-300">
          Rarer players score more. Guess as often as you like before time runs
          out.
        </p>
      </div>

      {/* Hidden while reading; it mounts (and focuses) when answers open. Remounting on each
          rejected attempt clears and refocuses the field. */}
      {!reading && (
        <AnswerInput
          key={inputVersion}
          disabled={timeUp}
          pending={pending}
          onSubmit={onSubmit}
          initialValue={suggestion ?? ""}
        />
      )}

      <div aria-live="polite" className="min-h-6">
        {reading && (
          <p
            className="flex items-center gap-3 text-[15px] text-cream-200"
            role="status"
          >
            <BookOpen className="size-4 shrink-0 text-cream-300" aria-hidden />
            Take a swing in
            <span
              key={readSecondsLeft ?? "start"}
              className="inline-flex size-8 items-center justify-center rounded-full bg-cream-100 font-mono text-base font-bold text-ink animate-pop"
            >
              {readSecondsLeft ?? "…"}
            </span>
          </p>
        )}

        {/* Generic, name-free feedback: never lists or hints at players. */}
        {suggestion && !timeUp && (
          <div
            key={`suggestion-${inputVersion}`}
            className="flex items-start gap-2 rounded-xl bg-navy-900/80 px-4 py-3 text-[15px] ring-1 ring-navy-600 animate-rise"
          >
            <SpellCheck
              className="mt-0.5 size-4 shrink-0 text-cream-300"
              aria-hidden
            />
            <p className="text-cream-100">
              Did you mean{" "}
              <strong className="font-semibold text-cream-50">
                {suggestion}
              </strong>
              ?{" "}
              <span className="inline-flex items-center gap-1 text-sm text-navy-300">
                Press <CornerDownLeft className="size-3.5" aria-label="Enter" />{" "}
                to submit it, or edit your answer.
              </span>
            </p>
          </div>
        )}

        {options && !timeUp && (
          <div className="rounded-2xl bg-navy-900/80 p-4 ring-1 ring-navy-600 animate-rise sm:p-5">
            <p className="flex items-start gap-2 text-[15px] text-cream-100">
              <Users
                className="mt-0.5 size-4 shrink-0 text-cream-300"
                aria-hidden
              />
              {feedback?.message}
            </p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {options.map((option) => (
                <button
                  key={option.playerId}
                  type="button"
                  disabled={pending}
                  onClick={() => onChoose(option.playerId)}
                  className="rounded-xl bg-navy-800 px-4 py-3 text-left ring-1 ring-navy-700 transition hover:bg-navy-700 hover:ring-cream-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cream-100 disabled:opacity-50"
                >
                  <span className="block font-semibold text-cream-50">
                    {option.name}
                  </span>
                  <span className="block text-xs text-navy-300">
                    {option.detail}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {feedback && !suggestion && !options && !timeUp && (
          // key = attempt number, so the message re-animates on every rejected guess.
          <div
            key={attempts}
            className="flex items-start gap-2 rounded-xl bg-stitch-600/15 px-4 py-3 text-[15px] ring-1 ring-stitch-500/40 animate-rise"
          >
            <FeedbackIcon
              className="mt-0.5 size-4 shrink-0 text-stitch-400"
              aria-hidden
            />
            <p className="font-medium text-stitch-100">
              {feedback.message}
              {attempts > 1 && (
                <span className="ml-2 font-mono text-xs font-normal text-stitch-100/70">
                  ×{attempts}
                </span>
              )}
            </p>
          </div>
        )}

        {error && !timeUp && (
          <p className="flex items-start gap-2 rounded-xl bg-navy-900/80 px-4 py-3 text-[15px] text-cream-200 ring-1 ring-navy-700 animate-rise">
            <TriangleAlert
              className="mt-0.5 size-4 shrink-0 text-cream-300"
              aria-hidden
            />
            {error} Your guess wasn&apos;t counted. Try again.
          </p>
        )}

        {timeUp && (
          <p className="flex items-center gap-2 text-[15px] text-cream-300">
            <CircleHelp className="size-4" aria-hidden /> Time&apos;s up…
          </p>
        )}
      </div>
    </section>
  );
}
