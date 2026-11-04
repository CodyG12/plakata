"use client";

import { useEffect, useRef, useState } from "react";
import { ROUND_SECONDS } from "@/data/questions";

const TICK_MS = 200;

/**
 * Milliseconds remaining until `deadline` (epoch ms), re-rendering a few times
 * per second. Calls `onExpire` on every tick at or past the deadline; the game
 * reducer ignores repeats, so a round can never be expired twice. Exactly one
 * interval exists per deadline, and it is cleared when the deadline changes or
 * the component unmounts.
 */
export function useCountdown(deadline: number | null, onExpire: () => void): number {
  const [now, setNow] = useState<number | null>(null);
  const onExpireRef = useRef(onExpire);

  useEffect(() => {
    onExpireRef.current = onExpire;
  }, [onExpire]);

  useEffect(() => {
    if (deadline === null) return;
    const tick = () => {
      const t = Date.now();
      setNow(t);
      if (t >= deadline) onExpireRef.current();
    };
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, TICK_MS);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [deadline]);

  if (deadline === null) return 0;
  // Before the first tick (one frame), assume a full round rather than reading the clock during render.
  if (now === null) return ROUND_SECONDS * 1000;
  return Math.max(0, deadline - now);
}
