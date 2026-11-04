import { Gem, Play, Timer, Trophy } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { MAX_POINTS_PER_ROUND, ROUND_COUNT, ROUND_SECONDS } from "@/data/questions";

interface LandingScreenProps {
  onStart: () => void;
}

const RULES = [
  {
    icon: Timer,
    title: `${ROUND_COUNT} prompts, ${ROUND_SECONDS} seconds each`,
    body: "Each round asks for a player who fits — 300 homers, an MVP, a Mariner…",
  },
  {
    icon: Gem,
    title: "Obscure beats obvious",
    body: "Any valid player counts, but rarer answers earn up to 100 points. Babe Ruth won’t get you far.",
  },
  {
    icon: Trophy,
    title: `${ROUND_COUNT * MAX_POINTS_PER_ROUND} points possible`,
    body: "Wrong guesses cost nothing but time — keep trying until the clock hits zero. A round with no valid answer scores zero.",
  },
];

export function LandingScreen({ onStart }: LandingScreenProps) {
  return (
    <section className="flex flex-col items-center gap-10 text-center animate-rise">
      <div className="flex flex-col items-center">
        <BaseballMark />
        <p className="mt-6 text-xs font-semibold uppercase tracking-[0.28em] text-stitch-400">Baseball trivia</p>
        <h1 className="mt-3 font-display text-6xl font-semibold tracking-tight text-cream-50 sm:text-7xl">
          Plákata
        </h1>
        <p className="mt-4 max-w-md text-lg leading-relaxed text-navy-300 text-balance">
          Everyone knows Babe Ruth. The points are in the players nobody else thinks of.
        </p>
      </div>

      <ul className="grid w-full gap-3 text-left sm:grid-cols-3">
        {RULES.map(({ icon: Icon, title, body }) => (
          <li key={title} className="rounded-2xl bg-navy-900/70 p-5 ring-1 ring-navy-800">
            <Icon className="size-5 text-stitch-400" aria-hidden />
            <h2 className="mt-3 font-semibold text-cream-50">{title}</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-navy-300">{body}</p>
          </li>
        ))}
      </ul>

      <Button size="lg" onClick={onStart} icon={<Play className="size-5 fill-current" aria-hidden />} className="w-full sm:w-auto sm:px-12">
        Play Game
      </Button>
    </section>
  );
}

/** A minimal baseball: cream circle with two red stitch seams. */
function BaseballMark() {
  return (
    <svg viewBox="0 0 64 64" className="size-16 drop-shadow-[0_8px_24px_rgb(204_58_47/0.35)]" aria-hidden>
      <circle cx="32" cy="32" r="30" className="fill-cream-100" />
      <path
        d="M14 9c7 6 10 14 10 23s-3 17-10 23M50 9c-7 6-10 14-10 23s3 17 10 23"
        fill="none"
        strokeWidth="2.2"
        strokeDasharray="3 3"
        className="stroke-stitch-500"
      />
    </svg>
  );
}
