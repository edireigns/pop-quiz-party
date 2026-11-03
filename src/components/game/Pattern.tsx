"use client";

import type { MaskCell } from "@/lib/game/text";

/** Word tiles. Words never break across lines; tiles shrink to fit the screen. */
export function Pattern({ cells, variant = "phone", reveal = false }: { cells: MaskCell[]; variant?: "phone" | "tv"; reveal?: boolean }) {
  const words: MaskCell[][] = [[]];
  for (const c of cells) {
    if (c.t === "space") words.push([]);
    else words[words.length - 1].push(c);
  }
  const longest = Math.max(1, ...words.map((w) => w.length));
  const tile =
    variant === "tv"
      ? `min(5.2vw, calc(56vw / ${Math.max(longest, 8)}))`
      : `min(2.6rem, calc((100vw - 2.5rem) / ${longest} - 4px))`;
  const hidden = cells.filter((c) => c.t === "letter" && !c.c).length;
  const spoken = cells
    .map((c) => (c.t === "space" ? " / " : c.t === "fixed" ? c.c : (c.c ?? "blank")))
    .join(" ");
  return (
    <div
      className={`flex flex-wrap justify-center ${variant === "tv" ? "gap-x-[2.2vw] gap-y-[1.4vw]" : "gap-x-4 gap-y-3"}`}
      role="img"
      aria-label={`Puzzle: ${spoken}. ${hidden} letters hidden.`}
    >
      {words.map((w, i) => (
        <div key={i} className="flex flex-nowrap gap-[4px]">
          {w.map((c, j) => {
            if (c.t === "fixed")
              return (
                <span
                  key={j}
                  className="font-display flex items-end justify-center font-black text-mute"
                  style={{ width: `calc(${tile} * 0.55)`, height: `calc(${tile} * 1.2)`, fontSize: `calc(${tile} * 0.75)` }}
                >
                  {c.c}
                </span>
              );
            const shown = c.t === "letter" && c.c;
            return (
              <span
                key={j}
                className={`font-display flex items-center justify-center rounded-[0.35em] border-b-4 font-black ${
                  shown
                    ? `${reveal ? "border-yellow text-yellow" : "border-lime text-ink"} animate-pop-in bg-panel-2`
                    : "border-cyan bg-stage/70"
                }`}
                style={{ width: tile, height: `calc(${tile} * 1.2)`, fontSize: `calc(${tile} * 0.7)` }}
              >
                {shown ? c.c : ""}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}
