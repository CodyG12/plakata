"use client";

import { ArrowRight, CircleCheck, Hourglass, TriangleAlert } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/Button";
import type { RoundResultView } from "@/types/api";
import { TIER_STYLES, TierBadge } from "./TierBadge";

interface RoundResultProps {
  /** A finished round, exactly as the server scored it. */
  round: RoundResultView;
  roundCount: number;
  totalScore: number;
  /** The game is over: the button goes to the final box score. */
  isLast: boolean;
  /** The next round is being requested. */
  busy?: boolean;
  error?: string | null;
  onNext: () => void;
}

export function RoundResult({ round, roundCount, totalScore, isLast, busy = false, error = null, onNext }: RoundResultProps) {
  const nextRef = useRef<HTMLButtonElement>(null);
  const roundIndex = round.position;
  const { score, timedOut } = round;

  useEffect(() => {
    window.scrollTo({ top: 0 });
    nextRef.current?.focus({ preventScroll: true });
  }, []);

  // A round ends only with a valid answer or when time runs out.
  const status = timedOut
    ? { icon: Hourglass, title: "Time's up", chip: "bg-cream-200 text-ink-muted" }
    : { icon: CircleCheck, title: "Valid answer", chip: "bg-turf-100 text-turf-600" };
  const wrongGuesses =
    round.attempts > 0 ? `${round.attempts} incorrect ${round.attempts === 1 ? "guess" : "guesses"}` : null;
  const StatusIcon = status.icon;

  return (
    <section className="flex flex-col gap-8 animate-rise" aria-labelledby="result-title">
      <header className="flex items-center justify-between gap-4">
        <span className="text-xs font-medium uppercase tracking-[0.16em] text-navy-300">
          Round <span className="font-mono text-cream-50">{roundIndex + 1}</span> of {roundCount} · Result
        </span>
        <span className="text-xs font-medium uppercase tracking-[0.16em] text-navy-300">
          Total <span className="ml-1 font-mono text-base text-cream-50 tabular-nums">{totalScore}</span>
        </span>
      </header>

      <p className="font-display text-lg leading-snug text-navy-300 sm:text-xl">{round.prompt}</p>

      <div className="overflow-hidden rounded-3xl bg-cream-100 text-ink shadow-2xl shadow-black/30">
        <div className="flex flex-col gap-6 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
          <div className="min-w-0">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider ${status.chip}`}
            >
              <StatusIcon className="size-3.5" aria-hidden />
              {status.title}
            </span>
            <h2 id="result-title" className="mt-3 truncate font-display text-3xl font-semibold sm:text-4xl">
              {timedOut ? "No answer" : round.acceptedName}
            </h2>
          </div>
          <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted">Result</span>
            <TierBadge tier={score.tier} size="lg" celebrate className="animate-pop" />
            <span
              className={`font-mono text-4xl font-bold leading-none tabular-nums ${TIER_STYLES[score.tier].text}`}
              aria-label={`${score.points} points earned`}
            >
              +{score.points}
              <span className="ml-1.5 text-base font-medium text-ink-muted">pts</span>
            </span>
          </div>
        </div>

        <div className="border-t border-dashed border-cream-300 bg-cream-50 px-6 py-5 sm:px-8">
          <p className="text-[15px] leading-relaxed text-ink">
            {timedOut
              ? `Time expired without a valid answer${wrongGuesses ? ` (${wrongGuesses})` : ""}. Strikeout: no points this round.`
              : round.explanation}
            {!timedOut && wrongGuesses && <span className="text-ink-muted"> Found after {wrongGuesses}.</span>}
          </p>
          {score.estimateNote && <p className="mt-1.5 text-sm text-ink-muted">{score.estimateNote}.</p>}
        </div>
      </div>

      <div className="flex flex-col-reverse items-stretch gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-center text-sm text-navy-300 sm:text-left">
          <span className={`font-mono font-semibold ${score.points > 0 ? "text-cream-50" : "text-navy-300"}`}>
            +{score.points}
          </span>{" "}
          points this round ({score.label}) · <span className="font-mono text-cream-50">{totalScore}</span> total
        </p>
        <Button ref={nextRef} size="lg" onClick={onNext} disabled={busy}>
          {isLast ? "See final results" : "Next round"}
          <ArrowRight className="size-5" aria-hidden />
        </Button>
      </div>
      {error && (
        <p className="flex items-start gap-2 rounded-xl bg-navy-900/80 px-4 py-3 text-[15px] text-cream-200 ring-1 ring-navy-700">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-cream-300" aria-hidden />
          {error}
        </p>
      )}
    </section>
  );
}
