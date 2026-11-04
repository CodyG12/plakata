"use client";

import { ArrowRight, CircleCheck, CircleX, Hourglass, Info } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/Button";
import { QUESTIONS, ROUND_COUNT } from "@/data/questions";
import type { RoundRecord } from "@/types/game";
import { RarityMeter } from "./RarityMeter";

interface RoundResultProps {
  round: RoundRecord;
  roundIndex: number;
  totalScore: number;
  onNext: () => void;
}

export function RoundResult({ round, roundIndex, totalScore, onNext }: RoundResultProps) {
  const nextRef = useRef<HTMLButtonElement>(null);
  const isLast = roundIndex + 1 >= ROUND_COUNT;
  const { score, validation, timedOut } = round;

  useEffect(() => {
    window.scrollTo({ top: 0 });
    nextRef.current?.focus({ preventScroll: true });
  }, []);

  const status = timedOut
    ? { icon: Hourglass, title: "Time's up", chip: "bg-cream-200 text-ink-muted" }
    : score.valid
      ? { icon: CircleCheck, title: "Valid answer", chip: "bg-turf-100 text-turf-600" }
      : { icon: CircleX, title: "Not a match", chip: "bg-stitch-100 text-stitch-600" };
  const StatusIcon = status.icon;

  return (
    <section className="flex flex-col gap-8 animate-rise" aria-labelledby="result-title">
      <header className="flex items-center justify-between gap-4">
        <span className="text-xs font-medium uppercase tracking-[0.16em] text-navy-300">
          Round <span className="font-mono text-cream-50">{roundIndex + 1}</span> of {ROUND_COUNT} · Result
        </span>
        <span className="text-xs font-medium uppercase tracking-[0.16em] text-navy-300">
          Total <span className="ml-1 font-mono text-base text-cream-50 tabular-nums">{totalScore}</span>
        </span>
      </header>

      <p className="font-display text-lg leading-snug text-navy-300 sm:text-xl">{QUESTIONS[roundIndex].prompt}</p>

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
              {timedOut ? "No answer" : round.submittedText}
            </h2>
          </div>
          <div className="shrink-0 text-left sm:text-right">
            <span className="block text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted">
              Estimated Rarity
            </span>
            <span className="font-mono text-6xl font-bold leading-none tabular-nums text-stitch-600 animate-pop">
              {score.rarityScore}
            </span>
            <span className="ml-1 font-mono text-lg text-ink-muted">/100</span>
          </div>
        </div>

        <div className="border-t border-dashed border-cream-300 bg-cream-50 px-6 py-5 sm:px-8">
          <p className="text-[15px] leading-relaxed text-ink">
            {timedOut
              ? "The clock ran out before an answer was locked in, so this round scores zero."
              : validation?.reason}
          </p>
          {score.valid && (
            <>
              <RarityMeter score={score.rarityScore} className="mt-5" />
              <p className="mt-4 flex items-start gap-2 text-sm text-ink-muted">
                <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  <strong className="font-semibold text-ink">{score.label}.</strong>{" "}
                  {score.method === "curated"
                    ? "Based on a curated estimate of how often fans name this player for this question."
                    : "This player isn't on our list of commonly named answers, so they get a provisional deep-cut score."}{" "}
                  Not yet based on real player submissions.
                </span>
              </p>
            </>
          )}
        </div>
      </div>

      <div className="flex flex-col-reverse items-stretch gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-center text-sm text-navy-300 sm:text-left">
          <span className={`font-mono font-semibold ${score.points > 0 ? "text-cream-50" : "text-navy-300"}`}>
            +{score.points}
          </span>{" "}
          points this round · <span className="font-mono text-cream-50">{totalScore}</span> total
        </p>
        <Button ref={nextRef} size="lg" onClick={onNext}>
          {isLast ? "See final results" : "Next round"}
          <ArrowRight className="size-5" aria-hidden />
        </Button>
      </div>
    </section>
  );
}
