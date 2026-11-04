"use client";

import { CornerDownLeft, Search } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/Button";
import type { PlayerSummary } from "@/types/baseball";

interface AnswerInputProps {
  disabled: boolean;
  pending: boolean;
  /** Submit free text (resolved on the server). */
  onSubmitText: (text: string) => void;
  /** Submit an exact player picked from the suggestions. */
  onSubmitPlayer: (player: PlayerSummary) => void;
}

const DEBOUNCE_MS = 120;

export function AnswerInput({ disabled, pending, onSubmitText, onSubmitPlayer }: AnswerInputProps) {
  const [value, setValue] = useState("");
  const [suggestions, setSuggestions] = useState<PlayerSummary[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const locked = disabled || pending;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounced autocomplete. Searches ALL players, so it never hints at validity.
  useEffect(() => {
    const query = value.trim();
    if (query.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/players/search?q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
        });
        if (!res.ok) return;
        const data: { results: PlayerSummary[] } = await res.json();
        setSuggestions(data.results);
        setActiveIndex(-1);
      } catch {
        // Aborted or offline — autocomplete is optional, typing still works.
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [value]);

  const showList = open && !locked && value.trim().length >= 2 && suggestions.length > 0;

  const submit = () => {
    if (locked) return;
    if (showList && activeIndex >= 0) {
      onSubmitPlayer(suggestions[activeIndex]);
      setOpen(false);
      return;
    }
    const text = value.trim();
    if (text) {
      onSubmitText(text);
      setOpen(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" && suggestions.length > 0) {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((i) => (i + 1) % suggestions.length);
    } else if (event.key === "ArrowUp" && suggestions.length > 0) {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      submit();
    } else if (event.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
    }
  };

  return (
    <form
      className="relative"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-ink-muted"
            aria-hidden
          />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={showList}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={showList && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
            aria-label="Player name"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="words"
            spellCheck={false}
            enterKeyHint="send"
            maxLength={80}
            placeholder="Type a player's name…"
            value={value}
            disabled={locked}
            onChange={(e) => {
              setValue(e.target.value);
              setOpen(true);
              setActiveIndex(-1); // never submit a highlight left over from older suggestions
              if (e.target.value.trim().length < 2) setSuggestions([]);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={onKeyDown}
            className="h-14 w-full rounded-2xl bg-cream-50 pl-12 pr-4 text-lg text-ink placeholder:text-ink-muted/70 shadow-inner ring-2 ring-transparent transition focus:outline-none focus:ring-stitch-400 disabled:opacity-60"
          />

          {showList && (
            <ul
              id={listId}
              role="listbox"
              aria-label="Matching players"
              className="absolute inset-x-0 top-[calc(100%+0.5rem)] z-20 max-h-80 overflow-y-auto rounded-2xl bg-cream-50 p-1.5 text-ink shadow-2xl shadow-black/40 ring-1 ring-cream-300 animate-rise"
            >
              {suggestions.map((player, i) => (
                <li
                  key={player.id}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === activeIndex}
                  // mousedown (not click) so the input's blur doesn't close the list first
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onSubmitPlayer(player);
                    setOpen(false);
                  }}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={`flex cursor-pointer items-center justify-between gap-3 rounded-xl px-3.5 py-2.5 transition-colors ${
                    i === activeIndex ? "bg-navy-900 text-cream-50" : "hover:bg-cream-200"
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{player.name}</span>
                    <span
                      className={`block truncate text-xs ${i === activeIndex ? "text-navy-300" : "text-ink-muted"}`}
                    >
                      {player.detail}
                    </span>
                  </span>
                  {i === activeIndex && <CornerDownLeft className="size-4 shrink-0 text-navy-300" aria-hidden />}
                </li>
              ))}
            </ul>
          )}
        </div>
        <Button type="submit" size="lg" loading={pending} disabled={locked || !value.trim()} className="sm:w-40">
          {pending ? "Checking" : "Submit"}
        </Button>
      </div>
      <p className="mt-3 hidden text-xs text-navy-300 sm:block">
        <kbd className="font-mono text-cream-200">↑</kbd> <kbd className="font-mono text-cream-200">↓</kbd> to
        browse suggestions · <kbd className="font-mono text-cream-200">Enter</kbd> to lock in your answer
      </p>
    </form>
  );
}
