"use client";

import type { TvView } from "@/lib/game/views";

export function Podium({ view }: { view: TvView }) {
  const f = view.final!;
  const top = f.standings.slice(0, 3);
  const order = [top[1], top[0], top[2]];
  const heights = ["h-[18vh]", "h-[26vh]", "h-[13vh]"];
  const colors = ["border-cyan text-cyan", "border-yellow text-yellow", "border-pink text-pink"];
  const rest = f.standings.slice(3);
  return (
    <div className="relative grid h-[calc(100dvh-6rem)] grid-cols-[minmax(0,6fr)_minmax(0,5fr)] gap-[3vw] px-[3vw] pb-[2vw]">
      <div aria-hidden className="motion-safe-only pointer-events-none absolute inset-0 overflow-hidden">
        {Array.from({ length: 40 }, (_, i) => (
          <span
            key={i}
            className="animate-confetti absolute top-0 block h-[1vw] w-[0.6vw] rounded-sm"
            style={{
              left: `${(i * 29) % 100}%`,
              background: ["#ff4fb1", "#33e6ff", "#ffe14d", "#8dff6b", "#b18cff"][i % 5],
              animationDelay: `${(i % 9) * 0.25}s`,
              animationIterationCount: 3,
            }}
          />
        ))}
      </div>
      <section className="flex flex-col justify-end" aria-label="Podium">
        <h2 className="font-display mb-auto pt-[1vw] text-center text-[3.6vw] font-black">
          🏆 <span className="neon-text text-yellow">{top[0]?.nickname ?? "—"}</span> wins!
        </h2>
        <div className="flex items-end justify-center gap-[1.5vw]">
          {order.map((s, i) =>
            s ? (
              <div key={s.id} className="animate-pop-in flex w-[11vw] flex-col items-center gap-[0.6vw]" style={{ animationDelay: `${[0.4, 0.8, 0][i]}s` }}>
                <span className="font-display max-w-full truncate text-[1.9vw] font-black">{s.nickname}</span>
                <span className="text-[1.5vw] font-bold text-cyan tabular-nums">{s.score} pts</span>
                <div className={`neon-box flex w-full items-start justify-center rounded-t-[1vw] border-4 bg-panel pt-[1vw] ${heights[i]} ${colors[i]}`}>
                  <span className="font-display text-[4vw] font-black">{s.rank}</span>
                </div>
              </div>
            ) : (
              <div key={i} className="w-[11vw]" />
            ),
          )}
        </div>
      </section>
      <section className="flex min-h-0 flex-col gap-[1vw] pt-[1vw]" aria-label="Awards">
        <h2 className="font-display text-[2.4vw] font-black">End-of-Night Awards</h2>
        <ul className="grid grid-cols-1 gap-[0.8vw]">
          {f.awards.map((a, i) => (
            <li key={a.key} className="animate-pop-in flex items-center gap-[1vw] rounded-[1vw] border-2 border-line bg-panel px-[1.2vw] py-[0.7vw]" style={{ animationDelay: `${1 + i * 0.35}s` }}>
              <span className="text-[2.6vw]" aria-hidden>
                {a.emoji}
              </span>
              <span className="min-w-0">
                <span className="block text-[1.2vw] font-bold text-mute">{a.title}</span>
                <span className="font-display block truncate text-[1.9vw] font-black">{a.nickname}</span>
                <span className="block text-[1.1vw] text-mute">{a.detail}</span>
              </span>
            </li>
          ))}
          {f.awards.length === 0 && <li className="text-[1.5vw] text-mute">No awards this time — play more rounds!</li>}
        </ul>
        {rest.length > 0 && (
          <ol className="mt-auto grid grid-cols-3 gap-x-[1vw] gap-y-[0.3vw] text-[1.1vw] text-mute">
            {rest.map((s) => (
              <li key={s.id} className="truncate">
                #{s.rank} {s.nickname} · {s.score}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
