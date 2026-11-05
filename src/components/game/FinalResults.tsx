"use client";

import { CircleCheck, CircleX, Hourglass, RotateCcw, Trophy } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/Button";
import { MAX_GAME_SCORE, type GameMode } from "@/lib/game/config";
import type { RoundResultView } from "@/types/api";
import { TierBadge } from "./TierBadge";

interface FinalResultsProps {
  rounds: RoundResultView[];
  totalScore: number;
  mode: GameMode;
  /** UTC date of a daily challenge, e.g. "2026-11-04". */
  dailyDay: string | null;
  onPlayAgain: () => void;
}

const MODE_LABELS: Record<GameMode, string> = { daily: "Daily Challenge", random: "Random game" };

function modeLabel(mode: GameMode, day: string | null): string {
  if (mode !== "daily" || !day) return MODE_LABELS[mode];
  const date = new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${MODE_LABELS.daily} · ${date}`;
}

const MAX_SCORE = MAX_GAME_SCORE;

function verdict(total: number): string {
  const pct = total / MAX_SCORE;
  if (pct >= 0.6) return "Hall of Fame knowledge. Those are some deep cuts.";
  if (pct >= 0.45) return "All-Star showing — you know the back of the baseball card.";
  if (pct >= 0.3) return "Solid everyday starter. Dig a little deeper next time.";
  if (pct > 0) return "You know the legends. Now go find the bench guys.";
  return "Tough day at the plate. Shake it off and step back in.";
}

export function FinalResults({ rounds, totalScore, mode, dailyDay, onPlayAgain }: FinalResultsProps) {
  const playAgainRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // Keyboard users can hit Enter to replay, without scrolling past the final score.
    window.scrollTo({ top: 0 });
    playAgainRef.current?.focus({ preventScroll: true });
  }, []);

  const correct = rounds.filter((r) => r.score.valid).length;
  const best = rounds.reduce<RoundResultView | null>((top, r) => (!top || r.score.points > top.score.points ? r : top), null);

  return (
    <section className="flex flex-col gap-8 animate-rise" aria-labelledby="final-title">
      <div className="text-center">
        <Trophy className="mx-auto size-10 text-stitch-400" aria-hidden />
        <p className="mt-4 text-xs font-semibold uppercase tracking-[0.2em] text-navy-300">
          {modeLabel(mode, dailyDay)} · Final score
        </p>
        <h1 id="final-title" className="mt-2 font-mono text-7xl font-bold tabular-nums text-cream-50 animate-pop">
          {totalScore}
          <span className="text-3xl font-medium text-navy-400"> / {MAX_SCORE}</span>
        </h1>
        <p className="mx-auto mt-4 max-w-md font-display text-xl text-cream-200 text-balance">{verdict(totalScore)}</p>
        <p className="mt-2 text-sm text-navy-300">
          {correct} of {rounds.length} valid answers
          {best && best.score.points > 0 && (
            <>
              {" "}
              · best hit: <span className="text-cream-100">{best.acceptedName}</span> ({best.score.label})
            </>
          )}
        </p>
      </div>

      <div className="overflow-hidden rounded-3xl bg-cream-100 text-ink shadow-2xl shadow-black/30">
        <div className="flex items-center justify-between border-b border-cream-300 px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted sm:px-6">
          <span>Box score</span>
          <span className="flex gap-4 sm:gap-6">
            <span>Result</span>
            <span className="w-12 text-right">Pts</span>
          </span>
        </div>
        <ol className="divide-y divide-dashed divide-cream-300">
          {rounds.map((round) => {
            const Icon = round.timedOut ? Hourglass : round.score.valid ? CircleCheck : CircleX;
            const tone = round.timedOut ? "text-ink-muted" : round.score.valid ? "text-turf-600" : "text-stitch-600";
            return (
              <li key={round.position} className="flex items-center gap-3 px-5 py-3.5 sm:gap-4 sm:px-6">
                <span className="w-5 shrink-0 font-mono text-sm text-ink-muted">{round.position + 1}</span>
                <Icon className={`size-4 shrink-0 ${tone}`} aria-label={round.score.valid ? "valid" : "no points"} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">
                    {round.timedOut ? <span className="text-ink-muted">No answer</span> : round.acceptedName}
                  </p>
                  <p className="truncate text-xs text-ink-muted">{round.prompt.replace(/^Name (an MLB player|a player|a pitcher) /, "")}</p>
                </div>
                <TierBadge tier={round.score.tier} className="shrink-0" />
                <span
                  className={`w-12 shrink-0 text-right font-mono text-lg font-semibold tabular-nums ${
                    round.score.points > 0 ? "text-stitch-600" : "text-ink-muted"
                  }`}
                >
                  +{round.score.points}
                </span>
              </li>
            );
          })}
        </ol>
        <div className="flex items-center justify-between bg-navy-900 px-5 py-4 text-cream-50 sm:px-6">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-navy-300">Total</span>
          <span className="font-mono text-2xl font-bold tabular-nums">{totalScore}</span>
        </div>
      </div>

      <p className="text-center text-xs leading-relaxed text-navy-400">
        Hits are graded by how often fans give each answer, smoothed toward curated estimates while data is thin. Each
        question&apos;s hand-picked deep cut is its Plákata.
      </p>

      <div className="flex justify-center">
        <Button size="lg" onClick={onPlayAgain} ref={playAgainRef} icon={<RotateCcw className="size-5" aria-hidden />}>
          Play again
        </Button>
      </div>
    </section>
  );
}
