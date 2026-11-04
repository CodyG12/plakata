"use client";

import { RotateCcw } from "lucide-react";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { QUESTIONS } from "@/data/questions";
import { gameReducer, initialGameState, totalScore } from "@/lib/game/reducer";
import type { AnswerResponse, GameState } from "@/types/game";
import { FinalResults } from "./FinalResults";
import { GameScreen } from "./GameScreen";
import { LandingScreen } from "./LandingScreen";
import { RoundResult } from "./RoundResult";

// v2: saved state now includes per-round attempt counts.
const STORAGE_KEY = "plakata:game:v2";

function loadSavedGame(): GameState | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as GameState) : null;
  } catch {
    return null;
  }
}

function saveGame(state: GameState) {
  try {
    if (state.status === "landing") window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage unavailable (private mode, quota) — the game still works without it.
  }
}

export function GameApp() {
  const [state, dispatch] = useReducer(gameReducer, initialGameState);
  const [hydrated, setHydrated] = useState(false);
  const inFlight = useRef(false);
  /** Text of the last submitted guess, re-sent when the user picks a namesake. */
  const lastInput = useRef("");

  // Restore an in-progress game after mount (localStorage is browser-only).
  useEffect(() => {
    const saved = loadSavedGame();
    if (saved) dispatch({ type: "HYDRATE", state: saved, now: Date.now() });
    setHydrated(true); // eslint-disable-line react-hooks/set-state-in-effect -- one-time mount flag
  }, []);

  useEffect(() => {
    if (hydrated) saveGame(state);
  }, [state, hydrated]);

  const submit = useCallback(
    async (input: string, playerId?: string) => {
      // inFlight blocks rapid repeat submits before React re-renders with pending=true.
      if (state.status !== "playing" || state.pending || inFlight.current)
        return;
      const now = Date.now();
      if (state.deadline !== null && now >= state.deadline) return;
      const roundIndex = state.roundIndex;
      inFlight.current = true;
      lastInput.current = input;
      dispatch({ type: "SUBMIT_STARTED", roundIndex, now });
      try {
        const res = await fetch("/api/answers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            questionId: QUESTIONS[roundIndex].id,
            input,
            playerId,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const response: AnswerResponse = await res.json();
        dispatch({
          type: "SUBMIT_RESOLVED",
          roundIndex,
          submittedText: input,
          response,
          now: Date.now(),
        });
      } catch {
        dispatch({
          type: "SUBMIT_FAILED",
          roundIndex,
          message: "Couldn't check that answer — connection problem.",
        });
      } finally {
        inFlight.current = false;
      }
    },
    [state.status, state.pending, state.roundIndex, state.deadline],
  );

  const roundIndex = state.roundIndex;
  const onExpire = useCallback(
    () => dispatch({ type: "TIMER_EXPIRED", roundIndex }),
    [roundIndex],
  );

  const total = totalScore(state);
  const inGame = state.status === "playing" || state.status === "round-result";

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
            onClick={() => dispatch({ type: "RESTART" })}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-navy-300 transition hover:bg-navy-900 hover:text-cream-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cream-100"
          >
            <RotateCcw className="size-3.5" aria-hidden />
            Quit game
          </button>
        )}
      </nav>

      <main
        className={`flex flex-1 flex-col transition-opacity duration-200 ${hydrated ? "opacity-100" : "opacity-0"}`}
      >
        {state.status === "landing" && (
          <LandingScreen
            onStart={() => dispatch({ type: "START", now: Date.now() })}
          />
        )}

        {state.status === "playing" && (
          <GameScreen
            key={state.roundIndex}
            state={state}
            totalScore={total}
            onExpire={onExpire}
            onSubmit={submit}
            onChoose={(playerId: string) => submit(lastInput.current, playerId)}
          />
        )}

        {state.status === "round-result" && state.rounds[state.roundIndex] && (
          <RoundResult
            key={state.roundIndex}
            round={state.rounds[state.roundIndex]}
            roundIndex={state.roundIndex}
            totalScore={total}
            onNext={() => dispatch({ type: "NEXT_ROUND", now: Date.now() })}
          />
        )}

        {state.status === "game-complete" && (
          <FinalResults
            rounds={state.rounds}
            totalScore={total}
            onPlayAgain={() => dispatch({ type: "START", now: Date.now() })}
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
        (1871–2025), CC BY-SA 3.0. Rarity scores are provisional estimates.
      </footer>
    </div>
  );
}
