"use client";

import { useEffect, useRef, useState } from "react";
import type { TvView } from "@/lib/game/views";

interface Floater {
  key: number;
  emoji: string;
  nickname: string;
  left: number;
}

/** Emoji reactions float up the TV. Only new reactions (after page load) animate. */
export function FloatingReactions({ reactions, serverNow }: { reactions: TvView["reactions"]; serverNow: () => number }) {
  const [items, setItems] = useState<Floater[]>([]);
  const seen = useRef<number | null>(null);
  useEffect(() => {
    const maxId = reactions.at(-1)?.id ?? 0;
    if (seen.current === null) {
      seen.current = maxId;
      return;
    }
    const fresh = reactions.filter((r) => r.id > seen.current! && serverNow() - r.at < 10_000);
    seen.current = Math.max(seen.current, maxId);
    if (!fresh.length) return;
    const add = fresh.slice(-12).map((r) => ({ key: r.id, emoji: r.emoji, nickname: r.nickname, left: 5 + ((r.id * 37) % 88) }));
    setItems((cur) => [...cur, ...add].slice(-30));
    // Removal timers are independent of later effect runs so floaters never get stuck.
    setTimeout(() => setItems((cur) => cur.filter((c) => !add.some((a) => a.key === c.key))), 3300);
  }, [reactions, serverNow]);
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-20 overflow-hidden">
      {items.map((it) => (
        <div key={it.key} className="animate-float-up absolute bottom-[2vh] flex flex-col items-center" style={{ left: `${it.left}%` }}>
          <span className="text-[5vw] leading-none drop-shadow-[0_0_14px_rgba(255,255,255,0.5)]">{it.emoji}</span>
          <span className="rounded-full bg-stage/80 px-[0.6vw] text-[1vw] font-bold">{it.nickname}</span>
        </div>
      ))}
    </div>
  );
}
