"use client";

import { useEffect, useRef, useState } from "react";

const COLORS = ["#ff4fb1", "#33e6ff", "#ffe14d", "#8dff6b", "#b18cff", "#ff9a3d", "#ff5d73", "#33e6ff", "#ff4fb1"];

/** An original neon balloon: glowing oval, little knot, curly string. */
export function Balloon({ color, size = 40, popped = false, popping = false }: { color: string; size?: number; popped?: boolean; popping?: boolean }) {
  if (popped && !popping) {
    return (
      <svg width={size} height={size * 1.45} viewBox="0 0 40 58" aria-hidden className="opacity-35">
        <path d="M20 30 l-4 -6 m4 6 l5 -5 m-5 5 l-6 1 m6 -1 l6 2" stroke={color} strokeWidth="2" strokeLinecap="round" fill="none" />
        <path d="M20 33 q-3 6 0 12 q3 6 0 12" stroke="#c9c1ee" strokeWidth="1.2" fill="none" opacity="0.5" />
      </svg>
    );
  }
  return (
    <svg
      width={size}
      height={size * 1.45}
      viewBox="0 0 40 58"
      aria-hidden
      className={popping ? "animate-balloon-pop" : "animate-bob"}
      style={{ filter: `drop-shadow(0 0 6px ${color})` }}
    >
      <defs>
        <radialGradient id={`g-${color.slice(1)}`} cx="35%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
          <stop offset="25%" stopColor={color} stopOpacity="0.95" />
          <stop offset="100%" stopColor={color} stopOpacity="0.55" />
        </radialGradient>
      </defs>
      <ellipse cx="20" cy="17" rx="14" ry="16" fill={`url(#g-${color.slice(1)})`} stroke={color} strokeWidth="2" />
      <path d="M17 33 l3 -2 l3 2 z" fill={color} />
      <path d="M20 34 q-3 6 0 12 q3 6 0 12" stroke="#c9c1ee" strokeWidth="1.2" fill="none" />
    </svg>
  );
}

/** Row of balloons representing lives. Newly lost lives pop with an animation. */
export function Balloons({ lives, max = 6, size = 36, label = true }: { lives: number; max?: number; size?: number; label?: boolean }) {
  const total = Math.max(max, lives);
  const prev = useRef(lives);
  const [popping, setPopping] = useState<number[]>([]);
  useEffect(() => {
    if (lives < prev.current) {
      const gone = Array.from({ length: prev.current - lives }, (_, i) => lives + i);
      setPopping(gone);
      const t = setTimeout(() => setPopping([]), 500);
      prev.current = lives;
      return () => clearTimeout(t);
    }
    prev.current = lives;
  }, [lives]);
  return (
    <div className="flex items-end justify-center gap-1" role="img" aria-label={`${lives} ${lives === 1 ? "life" : "lives"} left`}>
      {Array.from({ length: total }, (_, i) => (
        <Balloon key={i} color={COLORS[i % COLORS.length]} size={size} popped={i >= lives} popping={popping.includes(i)} />
      ))}
      {label && <span className="sr-only">{lives} lives left</span>}
    </div>
  );
}
