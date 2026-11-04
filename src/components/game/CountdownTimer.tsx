import { Timer } from "lucide-react";
import { ROUND_SECONDS } from "@/data/questions";

interface CountdownTimerProps {
  remainingMs: number;
  /** True during the read period: the clock sits full and hasn't started. */
  waiting?: boolean;
}

const RADIUS = 20;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function CountdownTimer({ remainingMs, waiting = false }: CountdownTimerProps) {
  const seconds = Math.ceil(remainingMs / 1000);
  const fraction = Math.max(0, Math.min(1, remainingMs / (ROUND_SECONDS * 1000)));
  const urgent = seconds <= 10;
  const critical = seconds <= 5;

  return (
    <div
      className="flex items-center gap-3"
      role="timer"
      aria-label={waiting ? `${seconds}-second clock starts after the read period` : `${seconds} seconds remaining`}
      aria-live={critical ? "assertive" : "off"}
    >
      <div className="relative size-12">
        <svg viewBox="0 0 48 48" className="size-12 -rotate-90" aria-hidden>
          <circle cx="24" cy="24" r={RADIUS} fill="none" strokeWidth="4" className="stroke-navy-700" />
          <circle
            cx="24"
            cy="24"
            r={RADIUS}
            fill="none"
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE * (1 - fraction)}
            className={`transition-[stroke-dashoffset] duration-200 ease-linear ${
              urgent ? "stroke-stitch-400" : "stroke-cream-200"
            }`}
          />
        </svg>
        <span
          className={`absolute inset-0 flex items-center justify-center font-mono text-sm font-semibold tabular-nums ${
            urgent ? "text-stitch-400" : "text-cream-50"
          } ${critical ? "animate-pulse" : ""}`}
        >
          {seconds}
        </span>
      </div>
      <span className="hidden items-center gap-1 text-xs font-medium uppercase tracking-[0.16em] text-navy-300 sm:flex">
        <Timer className="size-3.5" aria-hidden />
        {waiting ? "Ready" : urgent ? "Hurry" : "Clock"}
      </span>
    </div>
  );
}
