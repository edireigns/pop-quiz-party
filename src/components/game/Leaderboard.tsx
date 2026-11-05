"use client";

import { useLayoutEffect, useRef } from "react";
import type { LeaderEntry, RivalEntry } from "@/lib/game/views";

const MEDAL = ["🥇", "🥈", "🥉"];

/** Animate rows to their new position when ranks change (FLIP). */
function useFlip(keys: string[]) {
  const refs = useRef(new Map<string, HTMLElement>());
  const prev = useRef(new Map<string, DOMRect>());
  useLayoutEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const next = new Map<string, DOMRect>();
    refs.current.forEach((el, k) => {
      const rect = el.getBoundingClientRect();
      next.set(k, rect);
      const old = prev.current.get(k);
      if (old && !reduce) {
        const dy = old.top - rect.top;
        const dx = old.left - rect.left;
        if (dx || dy) {
          el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0,0)" }], {
            duration: 650,
            easing: "cubic-bezier(.2,.9,.3,1.2)",
          });
        }
      }
    });
    prev.current = next;
  }, [keys.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps
  return (k: string) => (el: HTMLElement | null) => {
    if (el) refs.current.set(k, el);
    else refs.current.delete(k);
  };
}

function MiniLives({ lives }: { lives: number }) {
  const shown = Math.min(lives, 9);
  return (
    <span className="flex items-center gap-[0.12em]" aria-label={`${lives} lives`}>
      {Array.from({ length: Math.max(6, shown) }, (_, i) => (
        <span
          key={i}
          className={`inline-block h-[0.85em] w-[0.6em] rounded-[50%] ${i < shown ? "bg-pink shadow-[0_0_6px_#ff4fb1]" : "bg-line/60"}`}
        />
      ))}
    </span>
  );
}

/** Emoji Decode: attempts left as target pips (never the guesses). */
function AttemptPips({ left }: { left: number }) {
  const shown = Math.min(left, 5);
  return (
    <span className="flex items-center gap-[0.2em]" aria-label={`${left} attempts left`}>
      {Array.from({ length: Math.max(3, shown) }, (_, i) => (
        <span
          key={i}
          className={`inline-block h-[0.8em] w-[0.8em] rounded-full border-2 ${i < shown ? "border-cyan bg-cyan shadow-[0_0_6px_#33e6ff]" : "border-line"}`}
        />
      ))}
    </span>
  );
}

/**
 * TV leaderboard merged with the live rival tracker: rank, name, score,
 * round points, balloons left and % solved (never the guesses themselves).
 * Fits 15 players in one column and up to 30 in two, without scrolling.
 */
export function TvLeaderboard({
  entries,
  rivals,
  showRound,
  showRivals,
  mode = "hangman",
}: {
  entries: LeaderEntry[];
  rivals: RivalEntry[];
  showRound: boolean;
  showRivals: boolean;
  mode?: "hangman" | "emoji" | "mlt";
}) {
  const ref = useFlip(entries.map((e) => e.id));
  const rivalMap = new Map(rivals.map((r) => [r.id, r]));
  const twoCols = entries.length > 15;
  const perCol = twoCols ? Math.ceil(entries.length / 2) : Math.max(entries.length, 8);
  const rowH = `calc((100% - ${(perCol - 1) * 0.35}vw) / ${perCol})`;
  const fontSize = `min(${twoCols ? 0.95 : perCol <= 10 ? 1.6 : 1.3}vw, calc((100dvh - 14rem) / ${perCol} * 0.42))`;
  return (
    <ol
      className={`grid h-full content-start gap-[0.35vw] ${twoCols ? "grid-flow-col grid-cols-2 gap-x-[0.8vw]" : "grid-cols-1"}`}
      style={{ gridTemplateRows: `repeat(${perCol}, ${rowH})`, fontSize }}
      aria-label="Leaderboard"
    >
      {entries.map((e) => {
        const r = rivalMap.get(e.id);
        return (
          <li
            key={e.id}
            ref={ref(e.id)}
            className={`flex min-h-0 items-center gap-[0.6em] rounded-[0.6em] border-2 px-[0.6em] ${
              e.rank === 1 ? "border-yellow bg-panel-2" : "border-line bg-panel/90"
            }`}
          >
            <span className="font-display w-[1.8em] shrink-0 text-center font-black text-yellow">{MEDAL[e.rank - 1] ?? e.rank}</span>
            <span className="min-w-[5em] flex-1 truncate font-bold">
              {e.nickname}
              {r?.frozen && <span aria-label="frozen"> ❄️</span>}
            </span>
            {showRivals && r && (
              <span className="flex shrink-0 items-center gap-[0.5em] text-[0.8em]">
                {r.status === "solved" ? (
                  <span className="font-bold text-lime">✓ solved</span>
                ) : r.status === "out" ? (
                  <span className="font-bold text-red">💥 out</span>
                ) : r.status === "waiting" ? (
                  <span className="text-mute">next round</span>
                ) : mode === "emoji" ? (
                  <>
                    <AttemptPips left={r.lives} />
                    <span className="w-[5.5em] text-mute">answering…</span>
                  </>
                ) : (
                  <>
                    <MiniLives lives={r.lives} />
                    <span className="relative h-[0.7em] w-[4em] overflow-hidden rounded-full bg-stage" aria-label={`${r.pct}% solved`}>
                      <span className="absolute inset-y-0 left-0 bg-cyan transition-[width] duration-500" style={{ width: `${r.pct}%` }} />
                    </span>
                    <span className="w-[2.6em] text-right tabular-nums text-mute">{r.pct}%</span>
                  </>
                )}
              </span>
            )}
            {showRound && (
              <span className={`w-[3.2em] shrink-0 text-right font-bold tabular-nums ${e.roundPoints > 0 ? "text-lime" : e.roundPoints < 0 ? "text-red" : "text-mute"}`}>
                {e.roundPoints > 0 ? `+${e.roundPoints}` : e.roundPoints || ""}
              </span>
            )}
            <span className="font-display w-[3.4em] shrink-0 text-right font-black tabular-nums text-cyan">{e.score}</span>
          </li>
        );
      })}
    </ol>
  );
}
