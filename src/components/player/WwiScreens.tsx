"use client";

import { useState } from "react";
import { useRemaining } from "@/components/game/Timer";
import { Button, Panel } from "@/components/ui";
import { useTicker, type useRoom } from "@/lib/client/useRoom";
import type { PlayerView } from "@/lib/game/views";
import { Celebrate, Reactions } from "./shared";

type Room = ReturnType<typeof useRoom<PlayerView>>;
type Act = (b: Record<string, unknown>) => Promise<unknown>;

const MAX_ANSWER = 80;
const CORRECT_POINTS = 100;
const FOOL_POINTS = 15;

export function hasWwiMode(view: PlayerView) {
  return view.mode === "wwi" || (view.mode === "mixed" && view.mixedModes.includes("wwi"));
}

/** Lobby: one anonymous Who Wrote It? question per player (friend-written rounds). */
export function PromptSubmit({ view, act }: { view: PlayerView; act: Act }) {
  const [text, setText] = useState("");
  const sub = view.promptSub;
  return (
    <Panel className="flex flex-col gap-3">
      <h2 className="font-display text-xl font-bold">🕵️ Submit a Who Wrote It? question</h2>
      {sub?.status === "removed" ? (
        <p className="text-mute">The host removed your question. No worries — you&apos;ll still play every round.</p>
      ) : (
        <>
          <p className="text-sm text-mute">
            One per player, 10–120 characters. Something quick and playful everyone can answer. It&apos;s always anonymous.
          </p>
          {sub && (
            <p className="rounded-xl bg-stage px-3 py-2" role="status">
              Submitted: <strong>{sub.text}</strong>
            </p>
          )}
          <form
            className="flex flex-col gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await act({ action: "submitPrompt", text })) setText("");
            }}
          >
            <label htmlFor="fp" className="text-sm font-bold">
              Your question
            </label>
            <input
              id="fp"
              value={text}
              maxLength={120}
              onChange={(e) => setText(e.target.value)}
              placeholder="What would our group's reality show be called?"
              className="min-h-12 rounded-xl border-2 border-line bg-stage px-3"
            />
            <Button type="submit" variant="pink" disabled={text.trim().length < 10}>
              {sub ? "Replace my question" : "Submit my question"}
            </Button>
          </form>
        </>
      )}
    </Panel>
  );
}

export function WwiRound({ view, room, act, header }: { view: PlayerView; room: Room; act: Act; header: React.ReactNode }) {
  const r = view.round!;
  const w = r.wwi!;
  const mine = view.my?.wwi ?? null;
  const reactions = (
    <Panel>
      <Reactions act={act} />
    </Panel>
  );
  if (!mine)
    return (
      <>
        {header}
        <Panel className="text-center">
          <p className="text-6xl" aria-hidden>
            👀
          </p>
          <p className="font-display mt-2 text-2xl font-black">You&apos;re in from the next question</p>
          <p className="mt-2 text-mute">{r.question}</p>
        </Panel>
        {reactions}
      </>
    );

  if (w.stage === "writing" && !mine.submitted) return <Writing view={view} room={room} act={act} header={header} />;
  if (w.stage === "writing")
    return (
      <>
        {header}
        <Panel className="flex flex-col items-center gap-3 py-6 text-center">
          <p className="text-6xl" aria-hidden>
            🔒
          </p>
          <p className="font-display text-4xl font-black text-lime" role="status">
            Answer locked
          </p>
          <p className="text-mute">{r.question}</p>
          {mine.myAnswer && <p className="text-xl font-bold break-words">“{mine.myAnswer}”</p>}
          <p className="text-sm text-mute">
            {w.submitted} of {w.writers} answers in. Nobody will know it&apos;s yours… unless your face gives it away.
          </p>
        </Panel>
        {reactions}
      </>
    );
  if (w.stage === "review")
    return (
      <>
        {header}
        <Panel className="flex flex-col items-center gap-2 py-6 text-center">
          <p className="text-6xl" aria-hidden>
            ✍️
          </p>
          <p className="font-display text-3xl font-black">All answers are in!</p>
          <p className="text-mute">Get ready to guess who wrote what…</p>
        </Panel>
        {reactions}
      </>
    );
  if (w.stage === "guessing" && mine.isAuthor)
    return (
      <>
        {header}
        <Panel className="flex flex-col items-center gap-3 py-6 text-center">
          <p className="text-7xl" aria-hidden>
            😏
          </p>
          <p className="font-display text-3xl font-black text-yellow" role="status">
            Your answer is on screen. Keep a straight face 😏
          </p>
          {w.answer && <p className="text-xl font-bold break-words">“{w.answer}”</p>}
          <p className="text-sm text-mute">
            You sit this one out. +{FOOL_POINTS * r.multiplier} for every friend who guesses wrong.
          </p>
        </Panel>
        {reactions}
      </>
    );
  if (w.stage === "guessing") return <Guessing view={view} room={room} act={act} header={header} />;
  return <AnswerResult view={view} act={act} header={header} />;
}

function Writing({ view, room, act, header }: { view: PlayerView; room: Room; act: Act; header: React.ReactNode }) {
  const r = view.round!;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const remaining = useRemaining(r.timer, room.serverNow);
  const count = [...text].length;
  const over = count > MAX_ANSWER;
  return (
    <>
      {header}
      <Panel className="flex flex-col gap-3">
        <h2 className="font-display text-2xl leading-tight font-black text-yellow">{r.question}</h2>
        <form
          className="flex flex-col gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!text.trim() || over) return;
            setBusy(true);
            await act({ action: "writeAnswer", text });
            setBusy(false);
          }}
        >
          <label htmlFor="wwi-answer" className="text-sm font-bold">
            Your answer — anonymous, locks once you submit
          </label>
          <textarea
            id="wwi-answer"
            value={text}
            rows={3}
            maxLength={MAX_ANSWER * 2}
            autoFocus
            onChange={(e) => setText(e.target.value)}
            placeholder="Be funny. Be sneaky."
            aria-describedby="wwi-count"
            className="min-h-28 resize-none rounded-2xl border-2 border-line bg-stage px-3 py-2 text-xl"
          />
          <p id="wwi-count" className={`text-right text-sm tabular-nums ${over ? "font-bold text-red" : "text-mute"}`} aria-live="polite">
            {count}/{MAX_ANSWER}
          </p>
          <Button big type="submit" variant="pink" disabled={!text.trim() || over || busy || view.paused || remaining <= 0}>
            🔒 Lock in my answer
          </Button>
        </form>
      </Panel>
    </>
  );
}

function Guessing({ view, room, act, header }: { view: PlayerView; room: Room; act: Act; header: React.ReactNode }) {
  const my = view.my!;
  const mine = my.wwi!;
  const r = view.round!;
  const w = r.wwi!;
  const now = useTicker(250, room.serverNow);
  const remaining = useRemaining(r.timer, room.serverNow);
  const frozenMs = Math.max(0, my.frozenUntil - now);
  const [busy, setBusy] = useState(false);
  const [freezePicker, setFreezePicker] = useState(false);
  const locked = mine.picks.length >= mine.pickLimit;
  const disabled = view.paused || frozenMs > 0 || remaining <= 0;
  const picked = mine.picks.length > 0;
  const noPowerups = view.me.powerupsLeft <= 0;
  return (
    <>
      {header}
      <Panel className="flex flex-col gap-2 py-4 text-center">
        <p className="text-sm text-mute">
          Answer {w.index} of {w.total} · {r.question}
        </p>
        <p className="font-display text-3xl leading-tight font-black break-words text-yellow">“{w.answer}”</p>
        <p className="font-bold">{locked ? "🔒 Guess locked — watch the TV for the reveal!" : "Who wrote it?"}</p>
        {mine.doubleGuess && !locked && (
          <p className="font-bold text-pink">✌️ Double Guess — {picked ? "pick one more name" : "pick two names"}</p>
        )}
        {mine.eliminated && !locked && <p className="font-bold text-lime">✂️ Two wrong names removed</p>}
      </Panel>

      <div className="relative">
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Who wrote it?">
          {mine.choices.map((c) => {
            const on = mine.picks.includes(c.id);
            return (
              <button
                key={c.id}
                type="button"
                aria-pressed={on}
                disabled={disabled || busy || locked || on}
                onClick={async () => {
                  setBusy(true);
                  await act({ action: "wwiGuess", targetId: c.id });
                  setBusy(false);
                }}
                className={`font-display min-h-20 rounded-2xl border-2 px-3 text-xl font-black break-words transition active:scale-95 ${
                  on ? "border-yellow bg-yellow text-stage" : "border-line bg-panel-2 text-ink"
                } disabled:opacity-70`}
              >
                {on && "✓ "}
                {c.nickname}
              </button>
            );
          })}
        </div>
        {frozenMs > 0 && (
          <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-cyan/85 text-center" role="alert">
            <p className="font-display text-3xl font-black text-stage">❄️ FROZEN {Math.ceil(frozenMs / 1000)}s</p>
          </div>
        )}
        {view.paused && (
          <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-stage/90" role="status">
            <p className="font-display text-3xl font-black">⏸ Paused</p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="col-span-2 text-center text-sm text-mute" aria-label={`${view.me.powerupsLeft} power-ups left this game`}>
          ⚡ Power-ups left: <strong className="text-ink">{view.me.powerupsLeft}</strong>
        </div>
        <Button variant="primary" disabled={disabled || noPowerups || my.freezeTargets.length === 0} onClick={() => setFreezePicker(true)}>
          ❄️ Freeze rival
        </Button>
        <Button
          variant="lime"
          disabled={disabled || noPowerups || picked || mine.eliminated || mine.doubleGuess || mine.choices.length < 3}
          onClick={() => act({ action: "powerup", type: "reveal" })}
        >
          ✂️ Eliminate Two
        </Button>
        <Button
          variant="yellow"
          className="col-span-2"
          disabled={disabled || noPowerups || picked || mine.doubleGuess || mine.eliminated}
          onClick={() => act({ action: "powerup", type: "extraLife" })}
        >
          ✌️ Double Guess
        </Button>
      </div>

      {freezePicker && (
        <div className="fixed inset-0 z-40 flex items-end bg-stage/80" role="dialog" aria-modal="true" aria-labelledby="wfreeze-title">
          <Panel className="mx-auto mb-4 flex w-[calc(100%-1.5rem)] max-w-md flex-col gap-2">
            <h2 id="wfreeze-title" className="font-display text-xl font-bold">
              Freeze whose guess buttons for 5s?
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

/** After an answer's author is revealed: celebration, "YOU SUCK 😂", or how many the author fooled. */
function AnswerResult({ view, act, header }: { view: PlayerView; act: Act; header: React.ReactNode }) {
  const r = view.round!;
  const w = r.wwi!;
  const mine = view.my!.wwi!;
  const rv = w.revealed;
  const summary = rv && (
    <Panel className="text-center">
      <p className="text-lg break-words">“{rv.text}”</p>
      <p className="font-display mt-1 text-2xl font-black text-yellow">✍️ {rv.authorName} wrote it!</p>
      <p className="mt-1 text-sm text-mute">
        {rv.correct} of {rv.guessers} guessed right · you&apos;re #{view.me.rank} with {view.me.score} points
      </p>
    </Panel>
  );
  const reactions = (
    <Panel>
      <Reactions act={act} />
    </Panel>
  );
  if (mine.result === "correct")
    return (
      <>
        {header}
        <Celebrate />
        <Panel className="text-center">
          <p className="text-6xl" aria-hidden>
            🎯
          </p>
          <p className="font-display text-4xl font-black text-lime" role="status">
            You got it! +{CORRECT_POINTS * r.multiplier}
          </p>
        </Panel>
        {summary}
        {reactions}
      </>
    );
  if (mine.result === "wrong" || mine.result === "missed")
    return (
      <>
        {header}
        <Panel className="flex flex-col items-center py-6 text-center">
          <div className="animate-laugh text-[7rem] leading-none" role="img" aria-label="Laughing emoji">
            😂
          </div>
          <p className="font-display neon-text mt-3 text-5xl font-black text-pink" role="status">
            {view.content === "pg13" ? "YOU SUCK 😂" : "YOU'RE OUT 😂"}
          </p>
          <p className="mt-2 text-mute">{mine.result === "missed" ? "You didn't guess in time." : "Wrong writer!"}</p>
        </Panel>
        {summary}
        {reactions}
      </>
    );
  if (mine.result === "author") {
    const fooled = mine.fooled ?? 0;
    return (
      <>
        {header}
        {fooled > 0 && <Celebrate />}
        <Panel className="text-center">
          <p className="text-6xl" aria-hidden>
            {fooled > 0 ? "🥸" : "📖"}
          </p>
          <p className="font-display text-3xl font-black text-yellow" role="status">
            {fooled > 0 ? `Your answer fooled ${fooled} player${fooled === 1 ? "" : "s"}!` : "Nobody was fooled — they know you too well!"}
          </p>
          {fooled > 0 && <p className="mt-1 text-xl font-bold text-lime">+{FOOL_POINTS * fooled * r.multiplier}</p>}
        </Panel>
        {summary}
        {reactions}
      </>
    );
  }
  return (
    <>
      {header}
      {summary}
      {reactions}
    </>
  );
}

/** Round over: every answer that was shown, with its author. Never the ones that weren't shown. */
export function WwiRevealScreen({ view, act }: { view: PlayerView; act: Act }) {
  const rv = view.reveal!;
  const answers = rv.wwi?.answers ?? [];
  const my = view.my;
  return (
    <>
      <Panel className="flex flex-col gap-2">
        <p className="text-center text-sm text-mute">{rv.answer}</p>
        {rv.wwi?.noAnswers ? (
          <p className="font-display text-center text-2xl font-black">Nobody wrote an answer — no points this round.</p>
        ) : answers.length === 0 ? (
          <p className="font-display text-center text-2xl font-black">Question skipped — no points</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {answers.map((a, i) => (
              <li key={i} className="rounded-xl bg-stage px-3 py-2">
                <p className="break-words">“{a.text}”</p>
                <p className="text-sm text-mute">
                  ✍️ <strong className="text-ink">{a.authorName}</strong> · {a.correct}/{a.guessers} guessed right
                </p>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel className="text-center">
        <p className="font-display text-4xl font-black text-lime">{my && my.points > 0 ? `+${my.points}` : (my?.points ?? 0)}</p>
        <p className="text-mute">points this round</p>
        <p className="mt-2 text-xl">
          You&apos;re <strong className="text-yellow">#{view.me.rank}</strong> overall
        </p>
        <p className="mt-2 text-sm text-mute">Waiting for the host to continue…</p>
      </Panel>
      <Panel>
        <Reactions act={act} />
      </Panel>
    </>
  );
}
