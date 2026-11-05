"use client";

import { useEffect, useState } from "react";
import type { TvView } from "@/lib/game/views";
import { sfx } from "./sound";

/** Most Likely To on the TV: the question and how many votes are in. */
export function MltQuestion({ view }: { view: TvView }) {
  const r = view.round!;
  return (
    <div className="flex w-full flex-col items-center gap-[2vw] text-center text-ink">
      <p className="text-[4vw] leading-none" aria-hidden>
        👑
      </p>
      <h2 className="font-display neon-text max-w-[52vw] text-[3.6vw] leading-tight font-black text-yellow">{r.question}</h2>
      <p className="font-display text-[2.4vw] font-black" aria-live="polite">
        🗳️ <span className="text-cyan">{r.answered.done}</span> of {r.answered.total} votes in
      </p>
      <p className="text-[1.4vw] text-mute">Vote on your phone — votes are secret, only totals are shown.</p>
    </div>
  );
}

/**
 * Suspense reveal: vote totals appear from lowest to highest, then the crown.
 * Only totals are known to the TV — never who voted for whom.
 */
export function MltReveal({ view }: { view: TvView }) {
  const r = view.round!;
  const rv = view.reveal!;
  const totals = rv.totals ?? [];
  const key = `${r.number}-${r.sdAttempt}`;
  const [reduce] = useState(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [step, setShown] = useState(0);
  const [stepKey, setStepKey] = useState(key);
  if (stepKey !== key) {
    setStepKey(key);
    setShown(0);
  }
  // Reduced motion: show every total and the crown at once.
  const steps = (totals.some((t) => t.votes === 0) ? 1 : 0) + totals.filter((t) => t.votes > 0).length;
  const shown = reduce ? steps + 1 : step;
  useEffect(() => {
    if (reduce || shown > steps) return;
    const t = setTimeout(() => {
      if (shown < steps) sfx.tick();
      else if (rv.crowned.length) sfx.fanfare();
      setShown((n) => n + 1);
    }, shown === 0 ? 600 : 1100);
    return () => clearTimeout(t);
  }, [reduce, shown, steps, rv.crowned.length]);

  // Players with no votes are summarised in one line; only players with votes
  // get a bar, lowest first, so 15–30 players still fit on one screen.
  const zeros = totals.filter((t) => t.votes === 0);
  const voted = totals.filter((t) => t.votes > 0);
  const offset = zeros.length ? 1 : 0;
  const max = Math.max(1, ...voted.map((t) => t.votes));
  const crownedIds = new Set(rv.crowned.map((c) => c.id));
  const crownTime = shown > steps;
  const twoCols = voted.length > 10;
  const compact = voted.length > 6;
  return (
    <div className="flex w-full flex-col items-center gap-[1vw] text-ink">
      <h2 className="font-display max-w-[52vw] text-center text-[2.2vw] leading-tight font-black text-yellow">{rv.answer}</h2>
      {rv.skipped ? null : voted.length === 0 ? (
        <p className="font-display text-[2.6vw] font-black">Nobody voted — no crown this round</p>
      ) : (
        <>
          {zeros.length > 0 && (
            <p className={`max-w-[50vw] text-center text-[1.3vw] text-mute transition-opacity duration-300 ${shown >= 1 ? "opacity-100" : "opacity-0"}`}>
              No votes: {zeros.length > 8 ? `${zeros.length} players` : zeros.map((z) => z.nickname).join(", ")}
            </p>
          )}
          <ol
            className={`grid w-full max-w-[52vw] gap-x-[1.5vw] ${compact ? "gap-y-[0.35vw]" : "gap-y-[0.6vw]"} ${twoCols ? "grid-cols-2" : "grid-cols-1"}`}
            aria-label="Vote totals, lowest to highest"
          >
            {voted.map((t, i) => {
              const visible = i + offset < shown;
              const crowned = crownTime && crownedIds.has(t.id);
              return (
                <li
                  key={t.id}
                  className={`flex items-center gap-[0.6vw] transition-opacity duration-300 ${visible ? "opacity-100" : "opacity-0"}`}
                  aria-hidden={!visible}
                >
                  <span className={`truncate text-right font-bold ${twoCols ? "w-[8vw]" : "w-[11vw]"} ${compact ? "text-[1.2vw]" : "text-[1.6vw]"} ${crowned ? "text-yellow" : ""}`}>
                    {crowned && "👑 "}
                    {t.nickname}
                  </span>
                  <span className={`relative flex-1 overflow-hidden rounded-full bg-stage ${compact ? "h-[1.1vw]" : "h-[1.8vw]"}`}>
                    <span
                      className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ${crowned ? "bg-yellow" : "bg-cyan"}`}
                      style={{ width: visible ? `${(t.votes / max) * 100}%` : "0%" }}
                    />
                  </span>
                  <span className={`font-display w-[2.5vw] font-black tabular-nums ${compact ? "text-[1.3vw]" : "text-[1.7vw]"}`}>{visible ? t.votes : ""}</span>
                </li>
              );
            })}
          </ol>
        </>
      )}
      {crownTime && rv.crowned.length > 0 && (
        <p className="animate-pop-in font-display neon-text text-[3vw] font-black text-yellow" role="status">
          👑 {rv.crowned.map((c) => c.nickname).join(" & ")} {rv.crowned.length > 1 ? "share the crown!" : "takes the crown!"}
        </p>
      )}
    </div>
  );
}
