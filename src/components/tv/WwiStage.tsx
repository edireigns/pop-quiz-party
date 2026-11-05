"use client";

import { useEffect, useRef } from "react";
import type { TvView } from "@/lib/game/views";
import { sfx } from "./sound";

/**
 * Who Wrote It? on the TV. During a round it only ever has totals and the
 * answer text — the author arrives in the view at that answer's reveal.
 */
export function WwiTv({ view }: { view: TvView }) {
  const r = view.round!;
  const w = r.wwi!;
  const rv = view.reveal;
  const revealKey = w.stage === "answerReveal" && w.revealed ? `${r.number}-${w.index}` : null;
  const lastKey = useRef<string | null>(null);
  useEffect(() => {
    if (revealKey && revealKey !== lastKey.current) sfx.reveal();
    lastKey.current = revealKey;
  }, [revealKey]);

  if (rv) {
    const answers = rv.wwi?.answers ?? [];
    return (
      <div className="flex w-full flex-col items-center gap-[1.2vw] text-center text-ink">
        <h2 className="font-display max-w-[52vw] text-[2.2vw] leading-tight font-black text-yellow">{rv.answer}</h2>
        {rv.wwi?.noAnswers ? (
          <p className="font-display text-[2.6vw] font-black">Nobody wrote an answer — no points this round</p>
        ) : answers.length === 0 ? (
          <p className="font-display text-[2.6vw] font-black text-orange">Skipped — no points this round</p>
        ) : (
          <ol className="flex w-full max-w-[52vw] flex-col gap-[0.8vw]" aria-label="This round's answers and who wrote them">
            {answers.map((a, i) => (
              <li key={i} className="animate-pop-in rounded-[1vw] border-2 border-line bg-stage/80 px-[1.2vw] py-[0.6vw] text-left">
                <p className={`font-bold break-words ${answers.length > 3 ? "text-[1.5vw]" : "text-[1.9vw]"}`}>“{a.text}”</p>
                <p className="text-[1.3vw] text-mute">
                  ✍️ <strong className="text-pink">{a.authorName}</strong> · {a.correct} of {a.guessers} guessed right
                </p>
              </li>
            ))}
          </ol>
        )}
      </div>
    );
  }

  if (w.stage === "writing")
    return (
      <div className="flex w-full flex-col items-center gap-[2vw] text-center text-ink">
        <p className="text-[4vw] leading-none" aria-hidden>
          ✍️
        </p>
        <h2 className="font-display neon-text max-w-[52vw] text-[3.6vw] leading-tight font-black text-yellow">{r.question}</h2>
        <p className="font-display text-[2.4vw] font-black" aria-live="polite">
          📝 <span className="text-cyan">{w.submitted}</span> of {w.writers} answers in
        </p>
        <p className="text-[1.4vw] text-mute">Write your answer on your phone — nobody will know it&apos;s yours.</p>
      </div>
    );

  if (w.stage === "review")
    return (
      <div className="flex w-full flex-col items-center gap-[2vw] text-center text-ink">
        <p className="text-[4vw] leading-none" aria-hidden>
          🕵️
        </p>
        <h2 className="font-display neon-text text-[3.6vw] font-black text-yellow">All answers are in!</h2>
        <p className="font-display text-[2.2vw] font-bold">
          {w.total} {w.total === 1 ? "answer" : "answers"} coming up — who wrote what?
        </p>
        <p className="max-w-[52vw] text-[1.5vw] text-mute">{r.question}</p>
      </div>
    );

  if (w.stage === "guessing")
    return (
      <div className="flex w-full flex-col items-center gap-[1.6vw] text-center text-ink">
        <p className="text-[1.6vw] font-bold tracking-widest text-mute uppercase">
          Answer {w.index} of {w.total} · who wrote it?
        </p>
        <p className="max-w-[52vw] text-[1.6vw] text-mute">{r.question}</p>
        <p className="animate-pop-in font-display neon-text max-w-[52vw] text-[4vw] leading-tight font-black break-words text-yellow">
          “{w.answer}”
        </p>
        <p className="font-display text-[2.4vw] font-black" aria-live="polite">
          🕵️ <span className="text-cyan">{w.guessed}</span> of {w.guessers} guessed
        </p>
        <p className="text-[1.4vw] text-mute">Guess on your phone. The writer keeps a straight face. 😏</p>
      </div>
    );

  const x = w.revealed;
  return (
    <div className="flex w-full flex-col items-center gap-[1.4vw] text-center text-ink">
      <p className="text-[1.6vw] font-bold tracking-widest text-mute uppercase">
        Answer {w.index} of {w.total}
      </p>
      {x && (
        <>
          <p className="max-w-[52vw] text-[2.4vw] font-bold break-words">“{x.text}”</p>
          <p className="animate-pop-in font-display neon-text text-[4.6vw] leading-tight font-black text-pink" role="status">
            ✍️ {x.authorName}!
          </p>
          <p className="text-[2vw]">
            <strong className="text-lime">{x.correct}</strong> of {x.guessers} guessed right
            {x.wrong > 0 && (
              <>
                {" "}
                · <strong className="text-yellow">{x.wrong}</strong> fooled
              </>
            )}
          </p>
        </>
      )}
    </div>
  );
}
