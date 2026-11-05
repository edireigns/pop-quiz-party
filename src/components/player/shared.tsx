"use client";

import { useState } from "react";
import { REACTION_EMOJIS } from "@/data/categories";

export function Reactions({ act }: { act: (b: Record<string, unknown>) => Promise<unknown> }) {
  const [cool, setCool] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-center text-sm text-mute">Send a reaction to the TV</p>
      <div className="grid grid-cols-4 gap-2" role="group" aria-label="Emoji reactions">
        {REACTION_EMOJIS.map((e) => (
          <button
            key={e}
            type="button"
            disabled={cool}
            aria-label={`Send ${e}`}
            onClick={async () => {
              setCool(true);
              setTimeout(() => setCool(false), 700);
              await act({ action: "react", emoji: e });
            }}
            className="min-h-14 rounded-2xl bg-panel-2 text-3xl transition active:scale-90 disabled:opacity-60"
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}


export function Celebrate() {
  const pieces = Array.from({ length: 28 }, (_, i) => i);
  return (
    <div aria-hidden className="motion-safe-only pointer-events-none fixed inset-0 z-40 overflow-hidden">
      {pieces.map((i) => (
        <span
          key={i}
          className="animate-confetti absolute top-0 block h-3 w-2 rounded-sm"
          style={{
            left: `${(i * 37) % 100}%`,
            background: ["#ff4fb1", "#33e6ff", "#ffe14d", "#8dff6b", "#b18cff"][i % 5],
            animationDelay: `${(i % 7) * 0.12}s`,
          }}
        />
      ))}
    </div>
  );
}

