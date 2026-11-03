"use client";

import { useEffect, useRef, useState } from "react";
import type { TvView } from "@/lib/game/views";

const COLORS = ["#ff4fb1", "#33e6ff", "#ffe14d", "#8dff6b", "#b18cff", "#ff9a3d", "#ff5d73", "#5ad1ff"];

function polar(cx: number, cy: number, r: number, deg: number) {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

export function DareWheel({ view }: { view: TvView }) {
  const d = view.dare!;
  const n = Math.max(1, d.options.length);
  const seg = 360 / n;
  const [rotation, setRotation] = useState(0);
  const [settled, setSettled] = useState(d.status !== "spun");
  const lastSpin = useRef<number | null>(null);

  useEffect(() => {
    if (d.status !== "spun" || d.resultIndex == null || lastSpin.current === d.spinId) return;
    const first = lastSpin.current === null;
    lastSpin.current = d.spinId;
    const target = 360 - (d.resultIndex * seg + seg / 2);
     
    setRotation((r) => {
      const base = Math.ceil(r / 360) * 360;
      return base + (first && d.spinId > 1 ? 0 : 360 * 6) + target;
    });
    setSettled(false);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t = setTimeout(() => setSettled(true), reduce ? 50 : 4300);
    return () => clearTimeout(t);
  }, [d.spinId, d.status, d.resultIndex, seg]);

  const result = d.resultIndex != null ? d.options[d.resultIndex] : null;
  return (
    <div className="grid h-[calc(100dvh-6rem)] grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-[3vw] px-[4vw] pb-[2vw]">
      <div className="relative mx-auto aspect-square w-[min(40vw,78vh)]">
        <div aria-hidden className="absolute top-[-1.2vw] left-1/2 z-10 -translate-x-1/2 text-[3.5vw] text-yellow drop-shadow-[0_0_12px_#ffe14d]">
          ▼
        </div>
        <svg
          viewBox="0 0 200 200"
          className="h-full w-full drop-shadow-[0_0_30px_rgba(177,140,255,0.6)]"
          style={{ transform: `rotate(${rotation}deg)`, transition: "transform 4.2s cubic-bezier(0.12, 0.8, 0.18, 1)" }}
          role="img"
          aria-label={`Dare wheel with ${n} dares`}
        >
          {d.options.map((o, i) => {
            const [x1, y1] = polar(100, 100, 96, i * seg);
            const [x2, y2] = polar(100, 100, 96, (i + 1) * seg);
            const [tx, ty] = polar(100, 100, 58, i * seg + seg / 2);
            const label = o.length > 18 ? o.slice(0, 17) + "…" : o;
            return (
              <g key={i}>
                <path d={`M100 100 L${x1} ${y1} A96 96 0 0 1 ${x2} ${y2} Z`} fill={COLORS[i % COLORS.length]} stroke="#0b0620" strokeWidth="1.5" />
                <text
                  x={tx}
                  y={ty}
                  fontSize="6"
                  fontWeight="800"
                  fill="#0b0620"
                  textAnchor="middle"
                  dominantBaseline="middle"
                  transform={`rotate(${i * seg + seg / 2 - 90} ${tx} ${ty})`}
                >
                  {label}
                </text>
              </g>
            );
          })}
          <circle cx="100" cy="100" r="14" fill="#0b0620" stroke="#ffe14d" strokeWidth="3" />
        </svg>
      </div>
      <div className="flex flex-col gap-[1.5vw]">
        <p className="font-display text-[2vw] font-bold text-mute">🎡 Dare Wheel</p>
        <h2 className="font-display text-[3.6vw] leading-tight font-black">
          <span className="text-pink">{d.nickname}</span> {d.status === "waiting" ? "is about to spin…" : "spun the wheel!"}
        </h2>
        {d.status === "spun" && settled && result && (
          <p className="animate-pop-in font-display rounded-[1.5vw] border-4 border-yellow bg-panel p-[1.5vw] text-[2.8vw] font-black text-yellow" role="status">
            {result}
          </p>
        )}
        {d.status === "passed" && <p className="font-display text-[3vw] font-black">Passed! No pressure 👋</p>}
        <p className="text-[1.5vw] text-mute">Dares are always optional — the player can pass and the host can re-spin.</p>
      </div>
    </div>
  );
}
