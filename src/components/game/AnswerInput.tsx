"use client";

import { Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";

interface AnswerInputProps {
  /** True once time is up — no more guesses. */
  disabled: boolean;
  /** True while a guess is being checked. */
  pending: boolean;
  onSubmit: (text: string) => void;
  /** Pre-filled text, e.g. a "Did you mean …?" correction for the user to confirm. */
  initialValue?: string;
}

/**
 * Plain text answer field — deliberately no autocomplete while typing, so the
 * interface never reveals possible answers. The parent remounts it (via `key`) after each
 * rejected guess (cleared) or spelling suggestion (pre-filled), and it
 * refocuses for the next try.
 */
export function AnswerInput({ disabled, pending, onSubmit, initialValue = "" }: AnswerInputProps) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    // Cursor at the end, so Enter submits the correction or the user can keep typing.
    input.setSelectionRange(input.value.length, input.value.length);
  }, []);

  const submit = () => {
    const text = value.trim();
    if (disabled || pending || !text) return;
    onSubmit(text);
  };

  return (
    <form
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
            aria-label="Player name"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="words"
            spellCheck={false}
            enterKeyHint="send"
            maxLength={80}
            placeholder="Type a player's name…"
            value={value}
            disabled={disabled}
            // readOnly (not disabled) while checking, so focus stays in the field.
            readOnly={pending}
            onChange={(e) => setValue(e.target.value)}
            className="h-14 w-full rounded-2xl bg-cream-50 pl-12 pr-4 text-lg text-ink placeholder:text-ink-muted/70 shadow-inner ring-2 ring-transparent transition focus:outline-none focus:ring-stitch-400 disabled:opacity-60"
          />
        </div>
        <Button type="submit" size="lg" loading={pending} disabled={disabled || !value.trim()} className="sm:w-40">
          {pending ? "Checking" : "Submit"}
        </Button>
      </div>
      <p className="mt-3 hidden text-xs text-navy-300 sm:block">
        Press <kbd className="font-mono text-cream-200">Enter</kbd> to submit · wrong guesses only cost you time
      </p>
    </form>
  );
}
