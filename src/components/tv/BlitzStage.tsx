"use client";

import type { TvView } from "@/lib/game/views";

/**
 * Category Blitz on the TV. During a round it only knows the prompt and how many
 * answers each player has added (in the leaderboard) — never any answer text.
 */
export function BlitzTv({ view }: { view: TvView }) {
  const r = view.round!;
  const b = r.blitz!;
  const rv = view.reveal;
  const total = view.rivals.reduce((n, x) => n + (x.count ?? 0), 0);

  if (rv?.blitz) {
    const x = rv.blitz;
    return (
      <div className="flex w-full flex-col items-center gap-[1vw] text-center text-ink">
        <h2 className="font-display text-[2.4vw] leading-tight font-black text-yellow">{rv.answer}</h2>
        {x.popular.length > 0 && (
          <div className="flex max-w-[52vw] flex-col items-center gap-[0.5vw]">
            <p className="text-[1.4vw] font-bold tracking-widest text-mute uppercase">🔥 Popular answers</p>
            <ul className="flex flex-wrap justify-center gap-[0.6vw]">
              {x.popular.map((p) => (
                <li key={p.text} className="animate-pop-in rounded-full border-2 border-cyan bg-stage/80 px-[1.1vw] py-[0.3vw] text-[1.6vw] font-bold">
                  {p.text} <span className="text-mute">×{p.count}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {x.uniques.length > 0 && (
          <div className="flex max-w-[52vw] flex-col items-center gap-[0.5vw]">
            <p className="text-[1.4vw] font-bold tracking-widest text-mute uppercase">💡 Only one person said…</p>
            <ul className="flex flex-wrap justify-center gap-[0.6vw]">
              {x.uniques.map((u, i) => (
                <li key={i} className="animate-pop-in rounded-full border-2 border-pink bg-stage/80 px-[1.1vw] py-[0.3vw] text-[1.5vw] font-bold">
                  {u.text} <span className="text-pink">— {u.nickname}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {x.popular.length === 0 && x.uniques.length === 0 && <p className="font-display text-[2.4vw] font-black">No valid answers this round!</p>}
        <ol className="grid max-w-[52vw] grid-cols-2 gap-x-[2vw] gap-y-[0.3vw] text-[1.3vw]" aria-label="Round results">
          {x.players.slice(0, 16).map((p) => (
            <li key={p.id} className="flex justify-between gap-[1vw]">
              <span className="truncate font-bold">{p.nickname}</span>
              <span className="text-mute tabular-nums">
                {p.valid} valid · {p.unique} unique · <strong className="text-lime">+{p.points}</strong>
              </span>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  if (rv) return null; // Sudden Death results / skipped: the shared reveal text covers it

  return (
    <div className="flex w-full flex-col items-center gap-[1.6vw] text-center text-ink">
      <p className="font-display text-[3.4vw] font-black">{b.category}</p>
      <p className="font-display text-[2.2vw] font-bold text-mute">starting with</p>
      <p className="font-display neon-text text-[12vw] leading-none font-black text-yellow" aria-label={`the letter ${b.letter}`}>
        {b.letter}
      </p>
      {b.stage === "review" ? (
        <p className="font-display text-[2.2vw] font-black" aria-live="polite">
          🧐 The host is checking {b.review?.total ?? 0} answer{b.review?.total === 1 ? "" : "s"}… ({b.review?.decided ?? 0} done)
        </p>
      ) : (
        <>
          <p className="font-display text-[2.2vw] font-black" aria-live="polite">
            📝 <span className="text-cyan">{total}</span> answers so far
          </p>
          {b.extraTime ? (
            <p className="text-[1.6vw] font-bold text-orange">⏱ Extra time for someone!</p>
          ) : (
            <p className="text-[1.4vw] text-mute">Type as many as you can on your phone — answers stay secret until the reveal.</p>
          )}
        </>
      )}
    </div>
  );
}
