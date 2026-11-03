"use client";

import { useTicker } from "@/lib/client/useRoom";
import type { TimerView } from "@/lib/game/views";

export function useRemaining(timer: TimerView | undefined, serverNow: () => number) {
  useTicker(200);
  if (!timer) return 0;
  if (timer.paused) return timer.remainingMs;
  return Math.max(0, timer.deadline - serverNow());
}

/** Countdown bar + seconds. `size` tv renders huge for across-the-room reading. */
export function Timer({ timer, serverNow, size = "phone" }: { timer: TimerView; serverNow: () => number; size?: "phone" | "tv" }) {
  const ms = useRemaining(timer, serverNow);
  const secs = Math.ceil(ms / 1000);
  const frac = timer.durationMs ? ms / timer.durationMs : 0;
  const urgent = secs <= 10;
  const color = urgent ? "bg-red" : frac < 0.5 ? "bg-yellow" : "bg-lime";
  return (
    <div className={`flex items-center ${size === "tv" ? "gap-[1vw]" : "gap-3"}`}>
      <div
        className={`font-display tabular-nums font-black ${urgent ? "text-red" : "text-ink"} ${size === "tv" ? "w-[6vw] text-right text-[4vw]" : "w-12 text-right text-2xl"} ${
          urgent && !timer.paused ? "animate-pulse-glow" : ""
        }`}
        role="timer"
        aria-live={urgent ? "assertive" : "off"}
        aria-label={`${secs} seconds left${timer.paused ? ", paused" : ""}`}
      >
        {timer.paused ? "⏸" : secs}
      </div>
      <div className={`flex-1 overflow-hidden rounded-full bg-stage ${size === "tv" ? "h-[1.2vw]" : "h-3"}`} aria-hidden>
        <div className={`h-full rounded-full transition-[width] duration-200 ${color}`} style={{ width: `${frac * 100}%` }} />
      </div>
    </div>
  );
}
