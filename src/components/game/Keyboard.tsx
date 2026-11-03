"use client";

import { useEffect } from "react";

const ROWS = ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"];

/** On-screen keyboard. Physical keyboard letters also work. */
export function Keyboard({
  correct,
  wrong,
  disabled,
  onGuess,
}: {
  correct: string[];
  wrong: string[];
  disabled: boolean;
  onGuess: (letter: string) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (disabled || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      const k = e.key.toUpperCase();
      if (/^[A-Z]$/.test(k) && !correct.includes(k) && !wrong.includes(k)) {
        e.preventDefault();
        onGuess(k);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [correct, wrong, disabled, onGuess]);

  return (
    <div className="flex w-full flex-col gap-2 select-none" role="group" aria-label="Letter keyboard">
      {ROWS.map((row) => (
        <div key={row} className="flex justify-center gap-1">
          {row.split("").map((l) => {
            const isRight = correct.includes(l);
            const isWrong = wrong.includes(l);
            const used = isRight || isWrong;
            return (
              <button
                key={l}
                type="button"
                disabled={disabled || used}
                onClick={() => onGuess(l)}
                aria-label={`${l}${isRight ? ", correct" : isWrong ? ", wrong" : ""}`}
                className={`font-display relative h-14 max-w-11 min-w-0 flex-1 rounded-xl text-xl font-black transition active:scale-90 ${
                  isRight
                    ? "bg-lime text-stage"
                    : isWrong
                      ? "bg-stage text-mute/60 line-through decoration-red decoration-4"
                      : "bg-panel-2 text-ink shadow-[inset_0_-4px_0_rgba(0,0,0,0.35)] disabled:opacity-60"
                }`}
              >
                {l}
                {isWrong && (
                  <span aria-hidden className="absolute inset-0 flex items-center justify-center text-3xl text-red">
                    ✕
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
