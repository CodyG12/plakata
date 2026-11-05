import { Gem, Play, Timer, TriangleAlert, Trophy } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { GAME_MODES, MAX_GAME_SCORE, READ_SECONDS, ROUND_COUNT, ROUND_SECONDS, type GameMode } from "@/lib/game/config";
import { SCORING_TIERS } from "@/lib/baseball/scoring";

/** "Bunt 10 · Single 25 · … · Plákata 100", straight from the scoring table. */
const HIT_LADDER = SCORING_TIERS.filter((t) => t.points > 0)
  .map((t) => `${t.label} ${t.points}`)
  .join(" · ");

interface LandingScreenProps {
  mode: GameMode;
  onModeChange: (mode: GameMode) => void;
  onStart: (mode: GameMode) => void;
  /** A game is being created. */
  busy?: boolean;
  error?: string | null;
}

const MODE_OPTIONS: Record<GameMode, { label: string; hint: string }> = {
  daily: { label: "Daily", hint: "Today’s seven, the same for everyone" },
  random: { label: "Random", hint: "Seven fresh prompts from the full bank" },
};

const RULES = [
  {
    icon: Timer,
    title: `${ROUND_COUNT} prompts, ${ROUND_SECONDS} seconds each`,
    body: `Each round asks for a player who fits: 300 homers, a Montreal Expo, someone born in Japan… You get ${READ_SECONDS} seconds to read the prompt before the clock starts.`,
  },
  {
    icon: Gem,
    title: "Obscure beats obvious",
    body: `Every valid player is a hit, and rarer answers hit harder: ${HIT_LADDER}. Babe Ruth won’t get you far.`,
  },
  {
    icon: Trophy,
    title: `${MAX_GAME_SCORE} points possible`,
    body: "Wrong guesses cost nothing but time — keep trying until the clock hits zero. A round with no valid answer is a strikeout: zero points.",
  },
];

export function LandingScreen({ mode, onModeChange, onStart, busy = false, error = null }: LandingScreenProps) {
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

      <div className="flex w-full flex-col items-center gap-4">
        <div role="radiogroup" aria-label="Game mode" className="inline-flex rounded-full bg-navy-900/70 p-1 ring-1 ring-navy-800">
          {GAME_MODES.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => onModeChange(m)}
              className={`rounded-full px-4 py-1.5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cream-100 ${
                mode === m ? "bg-cream-100 text-ink" : "text-navy-300 hover:text-cream-100"
              }`}
            >
              {MODE_OPTIONS[m].label}
            </button>
          ))}
        </div>
        <p className="-mt-1 text-sm text-navy-300">{MODE_OPTIONS[mode].hint}</p>

        <Button
          size="lg"
          onClick={() => onStart(mode)}
          disabled={busy}
          icon={<Play className="size-5 fill-current" aria-hidden />}
          className="w-full sm:w-auto sm:px-12"
        >
          Swing Away
        </Button>

        {error && (
          <p role="alert" className="flex items-start gap-2 rounded-xl bg-navy-900/80 px-4 py-3 text-left text-[15px] text-cream-200 ring-1 ring-navy-700">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-cream-300" aria-hidden />
            {error}
          </p>
        )}
      </div>
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
