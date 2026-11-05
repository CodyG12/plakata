"use client";

import { RotateCcw } from "lucide-react";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { api, ApiClientError } from "@/lib/game/api-client";
import { LATENCY_GRACE_MS, type GameMode } from "@/lib/game/config";
import { clientReducer, initialClientState } from "@/lib/game/reducer";
import { FinalResults } from "./FinalResults";
import { GameScreen } from "./GameScreen";
import { LandingScreen } from "./LandingScreen";
import { RoundResult } from "./RoundResult";

/** Only the game id is stored; the server holds the state, so a refresh resumes exactly. */
const STORAGE_KEY = "plakata:game-id:v4";
const MODE_KEY = "plakata:mode";

function storageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Storage unavailable (private mode, quota): the game still works, it just can't resume.
  }
}

const SUBMIT_ERRORS: Record<string, string> = {
  rate_limited: "Too many guesses at once. Wait a second.",
  not_open: "Answers open when the reading countdown ends.",
};

function messageOf(error: unknown, fallback: string): string {
  if (error instanceof ApiClientError) return error.code === "network" || error.code === "http" ? fallback : error.message;
  return fallback;
}

export function GameApp() {
  const [state, dispatch] = useReducer(clientReducer, initialClientState);
  const [hydrated, setHydrated] = useState(false);
  const [mode, setMode] = useState<GameMode>("daily");
  const inFlight = useRef(false);
  /** Text of the last submitted guess, re-sent when the user picks a namesake. */
  const lastInput = useRef("");
  const game = state.game;
  const active = game?.activeRound ?? null;

  // Resume a game in progress after a refresh: the server says where it stands.
  useEffect(() => {
    const savedMode = storageGet(MODE_KEY);
    if (savedMode === "daily" || savedMode === "random") setMode(savedMode); // eslint-disable-line react-hooks/set-state-in-effect -- one-time restore
    const gameId = storageGet(STORAGE_KEY);
    if (!gameId) {
      setHydrated(true);
      return;
    }
    dispatch({ type: "REQUEST_STARTED" });
    api
      .getGame(gameId)
      .then((view) => dispatch({ type: "GAME_LOADED", game: view, receivedAt: Date.now(), resume: true }))
      .catch((error) => {
        if (error instanceof ApiClientError && error.status === 404) storageSet(STORAGE_KEY, null);
        dispatch({ type: "RESTART" });
      })
      .finally(() => setHydrated(true));
  }, []);

  const start = useCallback(
    async (chosen: GameMode) => {
      if (state.busy) return;
      setMode(chosen);
      storageSet(MODE_KEY, chosen);
      dispatch({ type: "REQUEST_STARTED" });
      try {
        const created = await api.createGame(chosen);
        storageSet(STORAGE_KEY, created.gameId);
        const view = await api.startRound(created.gameId);
        dispatch({ type: "GAME_LOADED", game: view, receivedAt: Date.now() });
      } catch (error) {
        dispatch({ type: "REQUEST_FAILED", message: messageOf(error, "Couldn't start a game. Check your connection and try again.") });
      }
    },
    [state.busy],
  );

  const next = useCallback(async () => {
    if (!game || state.busy) return;
    if (game.status === "complete") {
      dispatch({ type: "SHOW_FINAL" });
      return;
    }
    dispatch({ type: "REQUEST_STARTED" });
    try {
      dispatch({ type: "GAME_LOADED", game: await api.startRound(game.gameId), receivedAt: Date.now() });
    } catch (error) {
      dispatch({ type: "REQUEST_FAILED", message: messageOf(error, "Couldn't start the next round. Try again.") });
    }
  }, [game, state.busy]);

  const submit = useCallback(
    async (input: string, playerId?: string) => {
      // inFlight blocks rapid repeat submits before React re-renders with pending=true.
      if (!game || !active || state.pending || state.timeUp || inFlight.current) return;
      inFlight.current = true;
      lastInput.current = input;
      dispatch({ type: "SUBMIT_STARTED" });
      try {
        const res = await api.submit(game.gameId, active.roundId, { token: active.token, input, playerId });
        const receivedAt = Date.now();
        if (res.outcome.kind === "feedback") {
          dispatch({ type: "SUBMIT_FEEDBACK", validation: res.outcome.validation, attempts: res.outcome.attempts, game: res.game, receivedAt });
        } else {
          dispatch({ type: "GAME_LOADED", game: res.game, receivedAt });
        }
      } catch (error) {
        const code = error instanceof ApiClientError ? error.code : "network";
        dispatch({ type: "REQUEST_FAILED", message: SUBMIT_ERRORS[code] ?? "Couldn't check that answer: connection problem." });
      } finally {
        inFlight.current = false;
      }
    },
    [game, active, state.pending, state.timeUp],
  );

  // When the local countdown ends, ask the server to settle the round. It decides,
  // so we wait out the latency grace first and retry if it says the round is still open.
  const roundId = active?.roundId;
  const onExpire = useCallback(() => {
    if (roundId) dispatch({ type: "TIME_UP", roundId });
  }, [roundId]);

  useEffect(() => {
    if (!state.timeUp || !game || !roundId || state.pending) return;
    let cancelled = false;
    let attempt = 0;
    const settle = async () => {
      try {
        const view = await api.completeRound(game.gameId, roundId);
        if (!cancelled) dispatch({ type: "GAME_LOADED", game: view, receivedAt: Date.now() });
      } catch (error) {
        if (cancelled) return;
        attempt++;
        const retryable = !(error instanceof ApiClientError) || error.code === "round_in_progress" || error.code === "network";
        if (retryable && attempt < 8) timer = setTimeout(settle, 400 * attempt);
        else dispatch({ type: "REQUEST_FAILED", message: messageOf(error, "Lost contact with the game server.") });
      }
    };
    let timer = setTimeout(settle, LATENCY_GRACE_MS + 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [state.timeUp, state.pending, game, roundId]);

  const restart = () => {
    storageSet(STORAGE_KEY, null);
    dispatch({ type: "RESTART" });
  };

  const total = game?.totalScore ?? 0;
  const inGame = state.screen === "playing" || state.screen === "round-result";
  const latest = game && game.rounds.length > 0 ? game.rounds[game.rounds.length - 1] : null;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 py-6 sm:px-6 sm:py-10">
      <nav className="mb-10 flex h-10 items-center justify-between sm:mb-14">
        <span className="flex items-center gap-2 font-display text-lg font-semibold text-cream-50">
          <span className="size-2.5 rounded-full bg-stitch-500" aria-hidden />
          Plákata
        </span>
        {inGame && (
          <button
            type="button"
            onClick={restart}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-navy-300 transition hover:bg-navy-900 hover:text-cream-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cream-100"
          >
            <RotateCcw className="size-3.5" aria-hidden />
            Quit game
          </button>
        )}
      </nav>

      <main className={`flex flex-1 flex-col transition-opacity duration-200 ${hydrated ? "opacity-100" : "opacity-0"}`}>
        {state.screen === "landing" && (
          <LandingScreen mode={mode} onModeChange={setMode} onStart={start} busy={state.busy} error={state.error} />
        )}

        {state.screen === "playing" && game && active && (
          <GameScreen
            key={active.roundId}
            round={active}
            rounds={game.rounds}
            roundCount={game.roundCount}
            totalScore={total}
            clockOffset={state.clockOffset}
            pending={state.pending}
            feedback={state.feedback}
            attempts={state.attempts}
            inputVersion={state.inputVersion}
            timeUp={state.timeUp}
            error={state.error}
            onExpire={onExpire}
            onSubmit={submit}
            onChoose={(playerId: string) => submit(lastInput.current, playerId)}
          />
        )}

        {state.screen === "round-result" && game && latest && (
          <RoundResult
            key={latest.position}
            round={latest}
            roundCount={game.roundCount}
            totalScore={total}
            isLast={game.status === "complete"}
            busy={state.busy}
            error={state.error}
            onNext={next}
          />
        )}

        {state.screen === "game-complete" && game && (
          <FinalResults
            rounds={game.rounds}
            totalScore={total}
            mode={game.mode}
            dailyDay={game.dailyDay}
            onPlayAgain={() => start(mode)}
          />
        )}
      </main>

      <footer className="mt-16 text-center text-xs leading-relaxed text-navy-400">
        Player data:{" "}
        <a
          href="https://sabr.org/lahman-database/"
          className="underline decoration-navy-600 underline-offset-2 hover:text-cream-200"
          target="_blank"
          rel="noreferrer"
        >
          SABR Lahman Baseball Database
        </a>{" "}
        (1871–2025), CC BY-SA 3.0. Rarity comes from fans&apos; answers, smoothed toward curated estimates.
      </footer>
    </div>
  );
}
