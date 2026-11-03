"use client";

// All TV audio is synthesised in code with the Web Audio API — original,
// license-free, and nothing to download. Phones never play sound.
import { useEffect, useRef, useState } from "react";
import { getPref, setPref } from "@/lib/client/storage";
import type { TvView } from "@/lib/game/views";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;

/** Must be called from a user gesture (the "Start TV" button). */
export function unlockAudio() {
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    }
    void ctx.resume();
  } catch {}
}

function setMuted(m: boolean) {
  muted = m;
  if (master && ctx) master.gain.setTargetAtTime(m ? 0 : 0.5, ctx.currentTime, 0.05);
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = "square", vol = 0.15, slideTo?: number) {
  if (!ctx || !master || muted) return;
  const t0 = ctx.currentTime + start;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

function noise(start: number, dur: number, vol = 0.25, hp = 800) {
  if (!ctx || !master || muted) return;
  const t0 = ctx.currentTime + start;
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 2;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = "highpass";
  f.frequency.value = hp;
  const g = ctx.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(master);
  src.start(t0);
}

export const sfx = {
  join: () => {
    tone(660, 0, 0.08, "square", 0.08);
    tone(990, 0.07, 0.12, "square", 0.08);
  },
  roundStart: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.18, "sawtooth", 0.09)),
  tick: () => tone(1400, 0, 0.04, "square", 0.06),
  solved: () => [784, 988, 1319].forEach((f, i) => tone(f, i * 0.06, 0.16, "triangle", 0.12)),
  pop: () => {
    noise(0, 0.12, 0.35, 1200);
    tone(300, 0, 0.1, "sine", 0.1, 80);
  },
  reveal: () => {
    tone(392, 0, 0.15, "sawtooth", 0.1);
    tone(523, 0.15, 0.15, "sawtooth", 0.1);
    tone(784, 0.3, 0.5, "sawtooth", 0.12);
  },
  final: () => {
    for (let i = 0; i < 16; i++) noise(i * 0.06, 0.05, 0.15 + i * 0.01, 300);
    [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 1.0 + i * 0.1, 0.4, "sawtooth", 0.1));
  },
  freeze: () => tone(2000, 0, 0.4, "sine", 0.08, 600),
  spin: (n = 24) => {
    let t = 0;
    for (let i = 0; i < n; i++) {
      tone(900 + (i % 2) * 200, t, 0.03, "square", 0.05);
      t += 0.05 + (i / n) ** 2 * 0.25;
    }
  },
  fanfare: () => {
    const notes = [523, 523, 523, 659, 784, 659, 784, 1047];
    notes.forEach((f, i) => tone(f, i * 0.14, i === notes.length - 1 ? 0.9 : 0.13, "sawtooth", 0.11));
  },
  reaction: () => tone(1200 + Math.random() * 600, 0, 0.06, "sine", 0.04),
};

// Lightweight background loop: an original 4-chord arpeggio.
const CHORDS = [
  [220, 277, 330],
  [196, 247, 294],
  [175, 220, 262],
  [196, 247, 330],
];
function useMusic(on: boolean) {
  useEffect(() => {
    if (!on) return;
    let step = 0;
    const id = setInterval(() => {
      const chord = CHORDS[Math.floor(step / 8) % CHORDS.length];
      tone(chord[step % 3] * 2, 0, 0.12, "triangle", 0.035);
      if (step % 4 === 0) tone(chord[0] / 2, 0, 0.25, "sine", 0.06);
      step++;
    }, 180);
    return () => clearInterval(id);
  }, [on]);
}

export function useTvSound(view: TvView, serverNow: () => number) {
  const [isMuted, setIsMuted] = useState(false);
  useEffect(() => {
    const m = getPref("muted") === "1";
    setMuted(m);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync persisted preference after mount
    setIsMuted(m);
  }, []);
  const toggle = () => {
    const m = !isMuted;
    setIsMuted(m);
    setMuted(m);
    setPref("muted", m ? "1" : "0");
    unlockAudio();
  };

  const prev = useRef<TvView | null>(null);
  useEffect(() => {
    const p = prev.current;
    prev.current = view;
    if (!p) return;
    if (view.phase === "lobby" && (view.lobby?.players.length ?? 0) > (p.lobby?.players.length ?? 0)) sfx.join();
    const newRound = view.phase === "round" && (p.phase !== "round" || p.round?.number !== view.round?.number || p.round?.sdAttempt !== view.round?.sdAttempt);
    if (newRound) {
      if (view.round?.kind === "final") sfx.final();
      else sfx.roundStart();
    }
    if (view.phase === "reveal" && p.phase === "round") sfx.reveal();
    if (view.phase === "ended" && p.phase !== "ended") sfx.fanfare();
    if (view.phase === "dare" && view.dare && view.dare.spinId !== (p.dare?.spinId ?? 0) && view.dare.status === "spun") sfx.spin();
    if (view.phase === "round" && p.phase === "round") {
      const before = new Map(p.rivals.map((r) => [r.id, r]));
      let solved = false;
      let popped = false;
      let froze = false;
      for (const r of view.rivals) {
        const b = before.get(r.id);
        if (!b) continue;
        if (r.status === "solved" && b.status !== "solved") solved = true;
        if (r.lives < b.lives && r.status !== "waiting") popped = true;
        if (r.frozen && !b.frozen) froze = true;
      }
      if (solved) sfx.solved();
      else if (popped) sfx.pop();
      if (froze) sfx.freeze();
    }
    const lastSeen = p.reactions.at(-1)?.id ?? 0;
    if (view.reactions.some((r) => r.id > lastSeen)) sfx.reaction();
  }, [view]);

  // countdown ticks for the last 5 seconds
  const deadline = view.phase === "round" && !view.paused && view.round ? view.round.timer.deadline : null;
  useEffect(() => {
    if (!deadline) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let s = 5; s >= 1; s--) {
      const at = deadline - s * 1000 - serverNow();
      if (at > 0) timers.push(setTimeout(sfx.tick, at));
    }
    return () => timers.forEach(clearTimeout);
  }, [deadline, serverNow]);

  useMusic(!isMuted && (view.phase === "round" || view.phase === "lobby") && !view.paused);
  return { muted: isMuted, toggle };
}

export function MuteButton({ sound }: { sound: { muted: boolean; toggle: () => void } }) {
  return (
    <button
      className="min-h-12 rounded-xl border-2 border-line bg-panel px-4 text-lg font-bold hover:border-violet"
      onClick={sound.toggle}
      aria-pressed={sound.muted}
      aria-label={sound.muted ? "Unmute sound" : "Mute sound"}
    >
      {sound.muted ? "🔇 Muted" : "🔊 Sound on"}
    </button>
  );
}
