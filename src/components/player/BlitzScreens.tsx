"use client";

import { useEffect, useRef, useState } from "react";
import { Timer, useRemaining } from "@/components/game/Timer";
import { Button, Panel } from "@/components/ui";
import { useTicker, type useRoom } from "@/lib/client/useRoom";
import type { PlayerView } from "@/lib/game/views";
import { Celebrate, Reactions } from "./shared";

type Room = ReturnType<typeof useRoom<PlayerView>>;
type Act = (b: Record<string, unknown>) => Promise<unknown>;

function PromptHeader({ view, room }: { view: PlayerView; room: Room }) {
  const r = view.round!;
  const b = r.blitz!;
  const timer = view.my?.blitz?.timer ?? r.timer;
  return (
    <Panel className="flex flex-col gap-2 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-bold">
          <span aria-hidden>{r.categoryEmoji}</span> {b.category}
        </span>
        {r.kind === "final" && <span className="rounded-full bg-yellow px-2 py-0.5 text-sm font-black text-stage">2× FINAL</span>}
        {r.kind === "suddenDeath" && <span className="rounded-full bg-red px-2 py-0.5 text-sm font-black text-stage">SUDDEN DEATH</span>}
      </div>
      <p className="font-display text-center text-2xl font-black" aria-label={`${b.category} starting with ${b.letter}`}>
        starting with <span className="neon-text text-6xl text-yellow">{b.letter}</span>
      </p>
      {b.stage === "play" && <Timer timer={timer} serverNow={room.serverNow} />}
    </Panel>
  );
}

export function BlitzRound({ view, room, act }: { view: PlayerView; room: Room; act: Act }) {
  const r = view.round!;
  const b = r.blitz!;
  const my = view.my;
  const mine = my?.blitz ?? null;
  const reactions = (
    <Panel>
      <Reactions act={act} />
    </Panel>
  );
  const header = <PromptHeader view={view} room={room} />;
  if (!my || !mine || my.state === "waiting" || my.state === "sittingOut") {
    const sd = r.kind === "suddenDeath";
    return (
      <>
        {header}
        <Panel className="text-center">
          <p className="text-6xl" aria-hidden>
            👀
          </p>
          <p className="font-display mt-2 text-2xl font-black">{sd ? "Sudden Death!" : "You're in from the next round"}</p>
          <p className="mt-2 text-mute">{sd ? `Only ${view.suddenDeath?.names.join(" & ")} are playing. Watch the TV!` : "Watch the TV and cheer on your rivals."}</p>
        </Panel>
        {reactions}
      </>
    );
  }
  if (my.state === "out")
    return (
      <>
        {header}
        <Panel className="flex flex-col items-center py-8 text-center">
          <div className="animate-laugh text-[8rem] leading-none" role="img" aria-label="Laughing emoji">
            😂
          </div>
          <p className="font-display neon-text mt-3 text-5xl font-black text-pink" role="status">
            {view.content === "pg13" ? "YOU SUCK 😂" : "YOU'RE OUT 😂"}
          </p>
          <p className="mt-2 text-mute">That one didn&apos;t count. Fingers crossed for the others!</p>
        </Panel>
        {reactions}
      </>
    );
  if (b.stage === "review")
    return (
      <>
        {header}
        <Panel className="flex flex-col items-center gap-2 py-6 text-center">
          <p className="text-6xl" aria-hidden>
            🧐
          </p>
          <p className="font-display text-3xl font-black">Time&apos;s up!</p>
          <p className="text-mute">The host is checking a few answers. Results in a moment…</p>
          <p className="text-sm">You added {mine.answers.length} answer{mine.answers.length === 1 ? "" : "s"}.</p>
        </Panel>
        {reactions}
      </>
    );
  return <Playing view={view} room={room} act={act} header={header} />;
}

function Playing({ view, room, act, header }: { view: PlayerView; room: Room; act: Act; header: React.ReactNode }) {
  const my = view.my!;
  const mine = my.blitz!;
  const now = useTicker(250, room.serverNow);
  const remaining = useRemaining(mine.timer, room.serverNow);
  const frozenMs = Math.max(0, my.frozenUntil - now);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [freezePicker, setFreezePicker] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const full = mine.answers.length >= mine.max;
  const over = remaining <= 0;
  const disabled = view.paused || frozenMs > 0 || over || full;
  const sd = view.round!.kind === "suddenDeath";
  const noPowerups = view.me.powerupsLeft <= 0;

  // Keep the answer box focused so players can type answer after answer.
  useEffect(() => {
    if (!disabled && !busy && !freezePicker) input.current?.focus();
  }, [disabled, busy, freezePicker, mine.answers.length]);

  const submit = async () => {
    const value = text.trim();
    if (!value || disabled || busy) return;
    setBusy(true);
    if (await act({ action: "blitzAnswer", text: value })) setText("");
    setBusy(false);
  };

  return (
    <>
      {header}
      {mine.suggestion && (
        <p className="rounded-2xl bg-lime px-4 py-2 text-center font-bold text-stage" role="status">
          💡 Psst… try <strong>“{mine.suggestion}”</strong> (only you can see this)
        </p>
      )}
      <div className="relative">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label htmlFor="blitz-answer" className="sr-only">
            Your answer
          </label>
          <input
            id="blitz-answer"
            ref={input}
            value={text}
            maxLength={60}
            autoFocus
            autoComplete="off"
            autoCapitalize="words"
            enterKeyHint="send"
            disabled={disabled}
            onChange={(e) => setText(e.target.value)}
            placeholder={full ? "That's 20 — nice!" : over ? "Time's up!" : "Type and press Enter"}
            className="min-h-16 min-w-0 flex-1 rounded-2xl border-2 border-line bg-stage px-4 text-2xl"
          />
          <Button type="submit" variant="pink" className="min-h-16" disabled={disabled || busy || !text.trim()}>
            Add
          </Button>
        </form>
        {frozenMs > 0 && (
          <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-cyan/85 text-center" role="alert">
            <p className="font-display text-2xl font-black text-stage">❄️ FROZEN {Math.ceil(frozenMs / 1000)}s</p>
          </div>
        )}
        {view.paused && (
          <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-stage/90" role="status">
            <p className="font-display text-2xl font-black">⏸ Paused</p>
          </div>
        )}
      </div>
      {sd && <p className="text-center text-sm font-bold text-orange">Sudden Death: first valid answer wins — a wrong one and you&apos;re out!</p>}

      <Panel className="flex flex-col gap-2">
        <h2 className="flex justify-between font-bold">
          <span>Your answers</span>
          <span className="tabular-nums text-mute" aria-label={`${mine.answers.length} of ${mine.max} answers`}>
            {mine.answers.length}/{mine.max}
          </span>
        </h2>
        {mine.answers.length === 0 ? (
          <p className="text-sm text-mute">Nothing yet — go go go!</p>
        ) : (
          <ul className="flex flex-wrap gap-2" aria-live="polite">
            {mine.answers.map((a, i) => (
              <li key={i} className="rounded-full bg-panel-2 px-3 py-1 text-sm">
                {a} <span className="text-mute">· Added</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {!sd && (
        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-2 text-center text-sm text-mute" aria-label={`${view.me.powerupsLeft} power-ups left this game`}>
            ⚡ Power-ups left: <strong className="text-ink">{view.me.powerupsLeft}</strong>
          </div>
          <Button variant="primary" disabled={view.paused || over || noPowerups || my.freezeTargets.length === 0} onClick={() => setFreezePicker(true)}>
            ❄️ Freeze rival
          </Button>
          <Button variant="lime" disabled={view.paused || over || noPowerups || !!mine.suggestion} onClick={() => act({ action: "powerup", type: "reveal" })}>
            💡 Get a Suggestion
          </Button>
          <Button
            variant="yellow"
            className="col-span-2"
            disabled={view.paused || over || noPowerups || mine.extraTime}
            onClick={() => act({ action: "powerup", type: "extraLife" })}
          >
            ⏱ Extra Time (+5s for you)
          </Button>
        </div>
      )}

      {freezePicker && (
        <div className="fixed inset-0 z-40 flex items-end bg-stage/80" role="dialog" aria-modal="true" aria-labelledby="bfreeze-title">
          <Panel className="mx-auto mb-4 flex w-[calc(100%-1.5rem)] max-w-md flex-col gap-2">
            <h2 id="bfreeze-title" className="font-display text-xl font-bold">
              Freeze whose answer box for 5s?
            </h2>
            <div className="grid max-h-[50dvh] grid-cols-2 gap-2 overflow-y-auto">
              {my.freezeTargets.map((t) => (
                <Button
                  key={t.id}
                  variant="primary"
                  onClick={async () => {
                    setFreezePicker(false);
                    await act({ action: "powerup", type: "freeze", targetId: t.id });
                  }}
                >
                  {t.nickname}
                </Button>
              ))}
            </div>
            <Button variant="ghost" onClick={() => setFreezePicker(false)} autoFocus>
              Cancel
            </Button>
          </Panel>
        </div>
      )}
    </>
  );
}

/** Round over: your valid/unique counts (or the laughing emoji), then a few answers from the room. */
export function BlitzRevealScreen({ view, act }: { view: PlayerView; act: Act }) {
  const rv = view.reveal!;
  const sd = view.round?.kind === "suddenDeath";
  const result = view.my?.blitz?.result ?? null;
  const reactions = (
    <Panel>
      <Reactions act={act} />
    </Panel>
  );
  if (sd)
    return (
      <>
        <Panel className="text-center">
          <p className="font-display text-3xl font-black">
            {rv.sdWinnerId === view.me.id ? "🏆 You won Sudden Death!" : rv.sdWinnerId ? "Sudden Death is over!" : "Nobody got one — another prompt!"}
          </p>
          <p className="mt-2 text-sm text-mute">Waiting for the host to continue…</p>
        </Panel>
        {reactions}
      </>
    );
  const summary = (
    <Panel className="flex flex-col gap-2 text-center">
      <p className="text-sm text-mute">{rv.answer}</p>
      {rv.skipped && <p className="font-display text-2xl font-black">Skipped — no points</p>}
      {rv.blitz && rv.blitz.popular.length > 0 && (
        <p className="text-sm">
          🔥 Popular: {rv.blitz.popular.map((p) => `${p.text} (${p.count})`).join(" · ")}
        </p>
      )}
      <p className="mt-1">
        You&apos;re <strong className="text-yellow">#{view.me.rank}</strong> with {view.me.score} points
      </p>
      <p className="text-sm text-mute">Waiting for the host to continue…</p>
    </Panel>
  );
  if (!result || rv.skipped)
    return (
      <>
        {summary}
        {reactions}
      </>
    );
  if (result.points === 0)
    return (
      <>
        <Panel className="flex flex-col items-center py-6 text-center">
          <div className="animate-laugh text-[7rem] leading-none" role="img" aria-label="Laughing emoji">
            😂
          </div>
          <p className="font-display neon-text mt-3 text-5xl font-black text-pink" role="status">
            {view.content === "pg13" ? "YOU SUCK 😂" : "YOU'RE OUT 😂"}
          </p>
          <p className="mt-2 text-mute">No valid answers this round.</p>
        </Panel>
        {summary}
        {reactions}
      </>
    );
  return (
    <>
      <Celebrate />
      <Panel className="text-center">
        <p className="font-display text-4xl font-black text-lime" role="status">
          +{result.points}
        </p>
        <p className="mt-1 text-xl">
          <strong>{result.valid}</strong> valid · <strong className="text-cyan">{result.unique}</strong> unique
        </p>
      </Panel>
      {summary}
      {reactions}
    </>
  );
}
