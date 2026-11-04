import { ROUND_COUNT } from "@/data/questions";
import type { RoundRecord } from "@/types/game";

interface ProgressIndicatorProps {
  roundIndex: number;
  rounds: RoundRecord[];
}

/** Seven "innings": filled for played rounds (red if scored), outlined for the current one. */
export function ProgressIndicator({ roundIndex, rounds }: ProgressIndicatorProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium uppercase tracking-[0.16em] text-navy-300">
        Round <span className="font-mono text-cream-50">{roundIndex + 1}</span> of {ROUND_COUNT}
      </span>
      <ol className="flex items-center gap-1.5" aria-label="Round progress">
        {Array.from({ length: ROUND_COUNT }, (_, i) => {
          const played = rounds[i];
          const current = i === roundIndex && !played;
          const scored = played && played.score.points > 0;
          return (
            <li
              key={i}
              aria-label={`Round ${i + 1}: ${played ? `${played.score.label}, ${played.score.points} points` : current ? "in progress" : "upcoming"}`}
              className={[
                "h-1.5 rounded-full transition-all duration-300",
                current ? "w-7 bg-cream-100" : "w-4",
                played ? (scored ? "bg-stitch-500" : "bg-navy-600") : current ? "" : "bg-navy-800",
              ].join(" ")}
            />
          );
        })}
      </ol>
    </div>
  );
}
