"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Balloons } from "@/components/Balloons";
import { Keyboard } from "@/components/game/Keyboard";
import { Pattern } from "@/components/game/Pattern";
import { Timer, useRemaining } from "@/components/game/Timer";
import { Button, ConnectionBanner, Logo, Panel, RoomGate, Stage, Toast } from "@/components/ui";
import { useRoom, useTicker, type ApiError } from "@/lib/client/useRoom";
import type { PlayerView } from "@/lib/game/views";
import { Celebrate, Reactions } from "./shared";
import { hasWwiMode, PromptSubmit, WwiRevealScreen, WwiRound } from "./WwiScreens";

export { Reactions };

type Room = ReturnType<typeof useRoom<PlayerView>>;

export function PlayerGame({ code, token, onLostSeat }: { code: string; token: string; onLostSeat: () => void }) {
  const room = useRoom<PlayerView>(code, "player", { "x-player-token": token }, { pollMs: 2500, minGapMs: 800 });
  const { view, status, errorMessage } = room;
  const [toast, setToast] = useState<{ msg: string; tone: "info" | "error" } | null>(null);

  useEffect(() => {
    if (status === "unauthorized") onLostSeat();
  }, [status, onLostSeat]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const act = useCallback(
    async (body: Record<string, unknown>) => {
      try {
        return await room.act<{ correct?: boolean | null }>("play", body);
      } catch (e) {
        const err = e as ApiError;
        if (err.error !== "already_guessed") setToast({ msg: err.message, tone: "error" });
        void room.refresh();
        return null;
      }
    },
    [room],
  );

  if (!view || status === "notFound" || status === "removed")
    return <RoomGate status={status} errorMessage={errorMessage} hasView={!!view} role="player" />;

  return (
    <Stage beams={false}>
      <ConnectionBanner status={status} />
      <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-3 px-3 pt-3 pb-6">
        <TopBar view={view} />
        <PhaseBody view={view} room={room} act={act} />
      </main>
      <Toast message={toast?.msg ?? null} tone={toast?.tone} />
    </Stage>
  );
}

function TopBar({ view }: { view: PlayerView }) {
  return (
    <header className="flex items-center justify-between gap-2">
      <div className="min-w-0">
        <div className="truncate font-bold">{view.me.nickname}</div>
        <div className="text-sm text-mute">
          {view.me.rank ? `#${view.me.rank} · ` : ""}
          {view.phase !== "lobby" && view.round ? `Round ${view.round.number}/${view.totalRounds}` : `Room ${view.code}`}
        </div>
      </div>
      <div className="text-right">
        <div className="font-display text-2xl font-black text-cyan tabular-nums" aria-label={`Score ${view.me.score}`}>
          {view.me.score}
        </div>
        <div className="text-xs text-mute">points</div>
      </div>
    </header>
  );
}

function PhaseBody({ view, room, act }: { view: PlayerView; room: Room; act: (b: Record<string, unknown>) => Promise<unknown> }) {
  switch (view.phase) {
    case "lobby":
      return <Lobby view={view} act={act} />;
    case "round":
      return <RoundScreen view={view} room={room} act={act} />;
    case "reveal":
      return <RevealScreen view={view} act={act} />;
    case "loserPick":
      return <LoserPickScreen view={view} room={room} act={act} />;
    case "dare":
      return <DareScreen view={view} act={act} />;
    case "ended":
      return <EndedScreen view={view} />;
  }
}

// ---------------------------------------------------------------------------
function Lobby({ view, act }: { view: PlayerView; act: (b: Record<string, unknown>) => Promise<unknown> }) {
  const [answer, setAnswer] = useState("");
  const [hint, setHint] = useState("");
  const [clue, setClue] = useState("");
  const sub = view.submission;
  const needsClue = view.mode === "emoji";
  const wantsClue = view.mode !== "hangman";
  return (
    <>
      <Panel className="text-center">
        <p className="font-display text-3xl font-black">You&apos;re in! 🎉</p>
        <p className="mt-2 text-mute">Eyes on the TV — the host will start soon.</p>
        <p className="mt-2 font-bold text-cyan">
          {view.mode === "emoji"
            ? "😀 Tonight: Emoji Decode"
            : view.mode === "mlt"
              ? "👑 Tonight: Most Likely To"
              : view.mode === "wwi"
                ? "🕵️ Tonight: Who Wrote It?"
                : view.mode === "mixed"
                ? `🔀 Tonight: ${view.mixedModes.map((m) => MODE_SHORT[m]).join(" + ")}`
                : "🔤 Tonight: Hangman"}
        </p>
      </Panel>
      {view.friendWords && hasMltMode(view) && <QuestionSubmit view={view} act={act} />}
      {view.friendWords && hasWwiMode(view) && <PromptSubmit view={view} act={act} />}
      {view.friendWords && hasWordMode(view) && (
        <Panel className="flex flex-col gap-3">
          <h2 className="font-display text-xl font-bold">🤝 Submit a word for the group</h2>
          {sub?.status === "removed" ? (
            <p className="text-mute">The host removed your word. No worries — you&apos;ll play every round.</p>
          ) : (
            <>
              <p className="text-sm text-mute">
                One word or phrase per player. If it&apos;s played, you sit out that round and earn +15 for every friend who
                can&apos;t solve it. Nobody sees it unless it&apos;s played.
              </p>
              {sub && (
                <p className="rounded-xl bg-stage px-3 py-2" role="status">
                  Submitted: {sub.clue && <span className="text-2xl">{sub.clue} </span>}
                  <strong>{sub.answer}</strong> {sub.hint && <span className="text-mute">({sub.hint})</span>}
                </p>
              )}
              <form
                className="flex flex-col gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (await act({ action: "submitWord", answer, hint, ...(wantsClue && clue.trim() ? { clue } : {}) })) {
                    setAnswer("");
                    setHint("");
                    setClue("");
                  }
                }}
              >
                <label htmlFor="fw" className="text-sm font-bold">
                  Word or phrase (2–40 letters)
                </label>
                <input id="fw" value={answer} maxLength={40} onChange={(e) => setAnswer(e.target.value)} className="min-h-12 rounded-xl border-2 border-line bg-stage px-3" />
                <label htmlFor="fh" className="text-sm font-bold">
                  Hint (optional)
                </label>
                <input id="fh" value={hint} maxLength={60} onChange={(e) => setHint(e.target.value)} className="min-h-12 rounded-xl border-2 border-line bg-stage px-3" />
                {wantsClue && (
                  <>
                    <label htmlFor="fc" className="text-sm font-bold">
                      Emoji clue for Emoji Decode {needsClue ? "(required — emojis only)" : "(optional — emojis only)"}
                    </label>
                    <input
                      id="fc"
                      value={clue}
                      maxLength={80}
                      onChange={(e) => setClue(e.target.value)}
                      placeholder="⛴️🇵🇹🤢"
                      className="min-h-12 rounded-xl border-2 border-line bg-stage px-3 text-2xl"
                    />
                    {!needsClue && <p className="text-xs text-mute">Without a clue, your word is only used in Hangman rounds.</p>}
                  </>
                )}
                <Button type="submit" variant="pink" disabled={answer.trim().length < 2 || (needsClue && !clue.trim())}>
                  {sub ? "Replace my word" : "Submit my word"}
                </Button>
              </form>
            </>
          )}
        </Panel>
      )}
      <Panel>
        <Reactions act={act} />
      </Panel>
    </>
  );
}

// ---------------------------------------------------------------------------
function RoundScreen({ view, room, act }: { view: PlayerView; room: Room; act: (b: Record<string, unknown>) => Promise<unknown> }) {
  const my = view.my!;
  const r = view.round!;
  const header = (
    <Panel className="flex flex-col gap-2 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-bold">
          <span aria-hidden>{r.categoryEmoji}</span> {r.category}
        </span>
        {r.kind === "final" && <span className="rounded-full bg-yellow px-2 py-0.5 text-sm font-black text-stage">2× FINAL</span>}
        {r.kind === "suddenDeath" && <span className="rounded-full bg-red px-2 py-0.5 text-sm font-black text-stage">SUDDEN DEATH</span>}
      </div>
      <Timer timer={r.timer} serverNow={room.serverNow} />
    </Panel>
  );

  if (r.mode === "wwi") return <WwiRound view={view} room={room} act={act} header={header} />;
  if (r.mode === "mlt") return <MltRound view={view} room={room} act={act} header={header} />;
  if (my.state === "playing" && r.mode === "emoji") return <EmojiPlaying view={view} room={room} act={act} header={header} />;
  if (my.state === "playing") return <Playing view={view} room={room} act={act} header={header} />;

  if (my.state === "solved")
    return (
      <>
        {header}
        <Celebrate />
        <Panel className="text-center">
          <p className="font-display text-4xl font-black text-lime">SOLVED! 🎉</p>
          <p className="mt-2 text-xl">
            You&apos;re <strong className="text-yellow">#{view.me.rank}</strong> with {view.me.score} points
          </p>
          <p className="mt-1 text-mute">+{my.points} this round. Keep it secret — wait for the others!</p>
        </Panel>
        <Panel>
          <Reactions act={act} />
        </Panel>
      </>
    );
  if (my.state === "out") return <OutScreen view={view} header={header} act={act} />;
  if (my.state === "sittingOut")
    return (
      <>
        {header}
        <Panel className="text-center">
          <p className="text-7xl" aria-hidden>
            🤫
          </p>
          <p className="font-display mt-2 text-3xl font-black">Your word is being played.</p>
          <p className="mt-2 text-mute">Sit back, keep a straight face, and earn +15 for every friend it stumps.</p>
        </Panel>
        <Panel>
          <Reactions act={act} />
        </Panel>
      </>
    );
  return (
    <>
      {header}
      <Panel className="text-center">
        <p className="text-6xl" aria-hidden>
          👀
        </p>
        <p className="font-display mt-2 text-2xl font-black">{r.kind === "suddenDeath" ? "Sudden Death!" : "You're up next round"}</p>
        <p className="mt-2 text-mute">
          {r.kind === "suddenDeath" ? `Only ${view.suddenDeath?.names.join(" & ")} are playing. Watch the TV!` : "Watch the TV and cheer on your rivals."}
        </p>
      </Panel>
      <Panel>
        <Reactions act={act} />
      </Panel>
    </>
  );
}

function OutScreen({ view, header, act }: { view: PlayerView; header: React.ReactNode; act: (b: Record<string, unknown>) => Promise<unknown> }) {
  const pg = view.content === "pg13";
  return (
    <>
      {header}
      <Panel className="flex flex-col items-center py-8 text-center">
        <div className="animate-laugh text-[9rem] leading-none" role="img" aria-label="Laughing emoji">
          😂
        </div>
        <p className="font-display neon-text mt-4 text-5xl font-black text-pink" role="status">
          {pg ? "YOU SUCK 😂" : "YOU'RE OUT 😂"}
        </p>
        <p className="mt-3 text-mute">
          {view.round?.mode === "emoji" ? "No attempts left." : "All your balloons popped."} The answer is revealed when the round ends.
        </p>
      </Panel>
      <Panel>
        <Reactions act={act} />
      </Panel>
    </>
  );
}

function Playing({ view, room, act, header }: { view: PlayerView; room: Room; act: (b: Record<string, unknown>) => Promise<unknown>; header: React.ReactNode }) {
  const my = view.my!;
  const r = view.round!;
  const now = useTicker(250, room.serverNow);
  const frozenMs = Math.max(0, my.frozenUntil - now);
  const remaining = useRemaining(r.timer, room.serverNow);
  const [pending, setPending] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const [freezePicker, setFreezePicker] = useState(false);
  const busy = useRef(false);
  const correct = my.guessed.filter((l) => !my.wrong.includes(l));
  const disabled = view.paused || frozenMs > 0 || remaining <= 0;

  const onGuess = useCallback(
    async (l: string) => {
      if (busy.current) return;
      busy.current = true;
      setPending(l);
      const res = (await act({ action: "guess", letter: l })) as { correct?: boolean | null } | null;
      if (res && res.correct === false) setShake((n) => n + 1);
      setPending(null);
      busy.current = false;
    },
    [act],
  );

  const sd = r.kind === "suddenDeath";
  return (
    <>
      {header}
      <Panel className="flex flex-col items-center gap-4 py-5">
        <div key={shake} className={shake ? "animate-shake" : ""}>
          <Pattern cells={my.pattern!} />
        </div>
        <Balloons lives={my.lives} max={sd ? 1 : 6} size={30} />
        {my.hint ? (
          <p className="rounded-xl bg-stage px-3 py-2 text-center" role="status">
            💡 {my.hint}
          </p>
        ) : null}
        <p className="sr-only" aria-live="polite">
          {pending ? `Guessing ${pending}` : ""}
        </p>
      </Panel>

      <div className="relative">
        <Keyboard correct={correct} wrong={my.wrong} disabled={disabled || !!pending} onGuess={onGuess} />
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

      {!sd && (
        <div className="grid grid-cols-2 gap-2">
          <Button variant="yellow" disabled={!!my.hint || disabled} onClick={() => act({ action: "hint" })} aria-label="Reveal hint, costs 20 points">
            💡 Hint <span className="text-sm">(−20)</span>
          </Button>
          <div className="flex items-center justify-center rounded-2xl bg-panel text-sm text-mute" aria-label={`${view.me.powerupsLeft} power-ups left this game`}>
            ⚡ Power-ups left: <strong className="ml-1 text-ink">{view.me.powerupsLeft}</strong>
          </div>
          <Button
            variant="primary"
            disabled={disabled || view.me.powerupsLeft <= 0 || my.freezeTargets.length === 0}
            onClick={() => setFreezePicker(true)}
          >
            ❄️ Freeze rival
          </Button>
          <Button variant="lime" disabled={disabled || view.me.powerupsLeft <= 0} onClick={() => act({ action: "powerup", type: "reveal" })}>
            🔦 Reveal letter
          </Button>
          <Button variant="pink" className="col-span-2" disabled={disabled || view.me.powerupsLeft <= 0} onClick={() => act({ action: "powerup", type: "extraLife" })}>
            🎈 Extra life
          </Button>
        </div>
      )}

      {freezePicker && (
        <div className="fixed inset-0 z-40 flex items-end bg-stage/80" role="dialog" aria-modal="true" aria-labelledby="freeze-title">
          <Panel className="mx-auto mb-4 flex w-[calc(100%-1.5rem)] max-w-md flex-col gap-2">
            <h2 id="freeze-title" className="font-display text-xl font-bold">
              Freeze whose keyboard for 5s?
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

// ---------------------------------------------------------------------------
// Emoji Decode
// ---------------------------------------------------------------------------
function AttemptsLeft({ left, max }: { left: number; max: number }) {
  return (
    <div className="flex items-center justify-center gap-2" role="img" aria-label={`${left} ${left === 1 ? "attempt" : "attempts"} left`}>
      {Array.from({ length: Math.max(max, left) }, (_, i) => (
        <span key={i} aria-hidden className={`text-3xl ${i < left ? "" : "opacity-25 grayscale"}`}>
          🎯
        </span>
      ))}
    </div>
  );
}

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function EmojiPlaying({ view, room, act, header }: { view: PlayerView; room: Room; act: (b: Record<string, unknown>) => Promise<unknown>; header: React.ReactNode }) {
  const my = view.my!;
  const r = view.round!;
  const now = useTicker(250, room.serverNow);
  const frozenMs = Math.max(0, my.frozenUntil - now);
  const remaining = useRemaining(r.timer, room.serverNow);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const [showClue, setShowClue] = useState(false);
  const [freezePicker, setFreezePicker] = useState(false);
  const sd = r.kind === "suddenDeath";
  const disabled = view.paused || frozenMs > 0 || remaining <= 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || disabled || busy) return;
    setBusy(true);
    const res = (await act({ action: "answer", answer: text })) as { correct?: boolean | null; attemptsLeft?: number | null } | null;
    setBusy(false);
    if (res && res.correct === false) {
      setShake((n) => n + 1);
      const left = res.attemptsLeft ?? 0;
      setFeedback(left > 0 ? `❌ Not quite — ${left} ${left === 1 ? "attempt" : "attempts"} left` : "❌ Not quite");
      setText("");
    } else if (res && res.correct) {
      setFeedback(null);
    }
  }

  return (
    <>
      {header}
      <Panel className="flex flex-col items-center gap-3 py-4 text-center">
        <p className="font-display text-xl font-bold">👀 Decode the emojis on the TV</p>
        <Button variant="ghost" aria-expanded={showClue} aria-controls="clue" onClick={() => setShowClue((v) => !v)}>
          {showClue ? "Hide clue" : "Show clue"}
        </Button>
        {showClue && r.clue && (
          <p id="clue" className="text-6xl leading-tight break-all" role="img" aria-label={`Emoji clue: ${r.clue}`}>
            {r.clue}
          </p>
        )}
        {r.hostHints.length > 0 && (
          <ul className="flex flex-col gap-1" aria-label="Hints from the host">
            {r.hostHints.map((h) => (
              <li key={h} className="rounded-xl bg-stage px-3 py-1 font-bold text-yellow">
                💡 {h}
              </li>
            ))}
          </ul>
        )}
        {my.revealedLetters.length > 0 && (
          <ul className="flex flex-col gap-1" aria-label="Letters revealed to you">
            {my.revealedLetters.map((l) => (
              <li key={l.position} className="rounded-xl bg-stage px-3 py-1 font-bold text-lime">
                🔦 The {ordinal(l.position + 1)} letter is “{l.letter}”
              </li>
            ))}
          </ul>
        )}
        <AttemptsLeft left={my.lives} max={my.maxAttempts} />
      </Panel>

      <form onSubmit={submit} className="relative flex flex-col gap-2">
        <label htmlFor="emoji-answer" className="sr-only">
          Your answer
        </label>
        <div key={shake} className={shake ? "animate-shake" : ""}>
          <input
            id="emoji-answer"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={60}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            enterKeyHint="send"
            placeholder="Type your answer…"
            disabled={disabled}
            aria-describedby="emoji-feedback"
            className="font-display h-20 w-full rounded-2xl border-4 border-cyan bg-stage px-4 text-center text-3xl font-bold text-ink placeholder:text-line disabled:opacity-60"
          />
        </div>
        <Button big variant="pink" type="submit" disabled={disabled || busy || !text.trim()}>
          {busy ? "Checking…" : "Submit answer"}
        </Button>
        <p id="emoji-feedback" role="status" aria-live="assertive" className="min-h-6 text-center font-bold text-red">
          {feedback}
        </p>
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
      </form>
      {my.wrong.length > 0 && <p className="text-center text-sm text-mute">Tried: {my.wrong.join(" · ")}</p>}

      {!sd && (
        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-2 text-center text-sm text-mute" aria-label={`${view.me.powerupsLeft} power-ups left this game`}>
            ⚡ Power-ups left: <strong className="text-ink">{view.me.powerupsLeft}</strong>
          </div>
          <Button variant="primary" disabled={disabled || view.me.powerupsLeft <= 0 || my.freezeTargets.length === 0} onClick={() => setFreezePicker(true)}>
            ❄️ Freeze rival
          </Button>
          <Button variant="lime" disabled={disabled || view.me.powerupsLeft <= 0} onClick={() => act({ action: "powerup", type: "reveal" })}>
            🔦 Reveal a letter
          </Button>
          <Button variant="yellow" className="col-span-2" disabled={disabled || view.me.powerupsLeft <= 0} onClick={() => act({ action: "powerup", type: "extraLife" })}>
            🎯 Extra attempt
          </Button>
        </div>
      )}

      {freezePicker && (
        <div className="fixed inset-0 z-40 flex items-end bg-stage/80" role="dialog" aria-modal="true" aria-labelledby="efreeze-title">
          <Panel className="mx-auto mb-4 flex w-[calc(100%-1.5rem)] max-w-md flex-col gap-2">
            <h2 id="efreeze-title" className="font-display text-xl font-bold">
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

// ---------------------------------------------------------------------------
// Most Likely To
// ---------------------------------------------------------------------------
const MODE_SHORT = { hangman: "Hangman", emoji: "Emoji Decode", mlt: "Most Likely To", wwi: "Who Wrote It?", blitz: "Category Blitz" } as const;

function hasWordMode(view: PlayerView) {
  return view.mode === "hangman" || view.mode === "emoji" || (view.mode === "mixed" && view.mixedModes.some((m) => m === "hangman" || m === "emoji"));
}

function hasMltMode(view: PlayerView) {
  return view.mode === "mlt" || (view.mode === "mixed" && view.mixedModes.includes("mlt"));
}

function QuestionSubmit({ view, act }: { view: PlayerView; act: (b: Record<string, unknown>) => Promise<unknown> }) {
  const [text, setText] = useState("");
  const sub = view.questionSub;
  return (
    <Panel className="flex flex-col gap-3">
      <h2 className="font-display text-xl font-bold">👑 Submit a Most Likely To question</h2>
      {sub?.status === "removed" ? (
        <p className="text-mute">The host removed your question. No worries — you&apos;ll still vote every round.</p>
      ) : (
        <>
          <p className="text-sm text-mute">
            One per player, 10–120 characters. Keep it playful and kind. It&apos;s always anonymous — nobody sees who wrote it.
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
              if (await act({ action: "submitQuestion", text })) setText("");
            }}
          >
            <label htmlFor="fq" className="text-sm font-bold">
              Who is most likely to…
            </label>
            <input
              id="fq"
              value={text}
              maxLength={120}
              onChange={(e) => setText(e.target.value)}
              placeholder="adopt a goat named Kevin"
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

function MltRound({ view, room, act, header }: { view: PlayerView; room: Room; act: (b: Record<string, unknown>) => Promise<unknown>; header: React.ReactNode }) {
  const my = view.my!;
  const r = view.round!;
  if (my.state === "playing") return <MltVoting view={view} room={room} act={act} header={header} />;
  if (my.state === "voted")
    return (
      <>
        {header}
        <Panel className="flex flex-col items-center gap-3 py-6 text-center">
          <p className="text-6xl" aria-hidden>
            🔒
          </p>
          <p className="font-display text-4xl font-black text-lime" role="status">
            Vote locked
          </p>
          <p className="text-mute">{r.question}</p>
          {my.peek && <PeekNote peek={my.peek} />}
          <p className="text-sm text-mute">
            {r.answered.done} of {r.answered.total} votes in. Watch the TV for the reveal!
          </p>
        </Panel>
        <Panel>
          <Reactions act={act} />
        </Panel>
      </>
    );
  const inSd = r.kind === "suddenDeath" && view.suddenDeath?.playerIds.includes(view.me.id);
  return (
    <>
      {header}
      <Panel className="text-center">
        <p className="text-6xl" aria-hidden>
          {inSd ? "😬" : "👀"}
        </p>
        <p className="font-display mt-2 text-2xl font-black">{inSd ? "You're in the Sudden Death!" : "You're up next round"}</p>
        <p className="mt-2 text-mute">{inSd ? "Everyone else is voting on who deserves the crown. Fingers crossed!" : r.question}</p>
      </Panel>
      <Panel>
        <Reactions act={act} />
      </Panel>
    </>
  );
}

function PeekNote({ peek }: { peek: { names: string[]; votes: number } }) {
  return (
    <p className="rounded-xl bg-stage px-3 py-2 font-bold text-cyan" role="status">
      👀 Peek:{" "}
      {peek.names.length === 0
        ? "no votes yet when you peeked"
        : `${peek.names.join(" & ")} ${peek.names.length > 1 ? "were tied" : "was leading"} with ${peek.votes} vote${peek.votes === 1 ? "" : "s"}`}
    </p>
  );
}

function MltVoting({ view, room, act, header }: { view: PlayerView; room: Room; act: (b: Record<string, unknown>) => Promise<unknown>; header: React.ReactNode }) {
  const my = view.my!;
  const r = view.round!;
  const now = useTicker(250, room.serverNow);
  const frozenMs = Math.max(0, my.frozenUntil - now);
  const remaining = useRemaining(r.timer, room.serverNow);
  const [choice, setChoice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [freezePicker, setFreezePicker] = useState(false);
  const sd = r.kind === "suddenDeath";
  const disabled = view.paused || frozenMs > 0 || remaining <= 0;
  const chosen = r.candidates.find((c) => c.id === choice) ?? null;

  return (
    <>
      {header}
      <Panel className="flex flex-col gap-2 py-4 text-center">
        <h2 className="font-display text-2xl leading-tight font-black text-yellow">{r.question}</h2>
        {my.voteReset && (
          <p className="rounded-xl bg-orange px-3 py-2 font-bold text-stage" role="alert">
            The player you voted for left the game — please vote again.
          </p>
        )}
        {my.doubleVote && <p className="font-bold text-pink">✌️ Double Vote is on — your vote counts twice</p>}
        {my.peek && <PeekNote peek={my.peek} />}
      </Panel>

      <div className="relative">
        <ul
          className="flex max-h-[46dvh] flex-col gap-2 overflow-y-auto overscroll-contain rounded-2xl pr-1"
          role="radiogroup"
          aria-label="Vote for a player"
        >
          {r.candidates.map((c) => {
            const on = c.id === choice;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={disabled || busy}
                  onClick={() => setChoice(c.id)}
                  className={`font-display flex min-h-14 w-full items-center justify-between rounded-2xl border-2 px-4 text-left text-xl font-bold transition ${
                    on ? "border-yellow bg-yellow text-stage" : "border-line bg-panel-2 text-ink"
                  } disabled:opacity-60`}
                >
                  <span className="truncate">{c.nickname}</span>
                  {c.id === view.me.id && <span className={`text-sm font-normal ${on ? "text-stage" : "text-mute"}`}>(you)</span>}
                </button>
              </li>
            );
          })}
        </ul>
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
      <Button
        big
        variant="pink"
        disabled={!chosen || disabled || busy}
        onClick={async () => {
          if (!chosen) return;
          setBusy(true);
          await act({ action: "vote", targetId: chosen.id });
          setBusy(false);
        }}
      >
        {chosen ? `🔒 Lock vote: ${chosen.nickname}` : "Pick a player to vote"}
      </Button>

      {!sd && (
        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-2 text-center text-sm text-mute" aria-label={`${view.me.powerupsLeft} power-ups left this game`}>
            ⚡ Power-ups left: <strong className="text-ink">{view.me.powerupsLeft}</strong>
          </div>
          <Button variant="primary" disabled={disabled || view.me.powerupsLeft <= 0 || my.freezeTargets.length === 0} onClick={() => setFreezePicker(true)}>
            ❄️ Freeze rival
          </Button>
          <Button variant="lime" disabled={disabled || view.me.powerupsLeft <= 0} onClick={() => act({ action: "powerup", type: "reveal" })}>
            👀 Peek at leader
          </Button>
          <Button
            variant="yellow"
            className="col-span-2"
            disabled={disabled || view.me.powerupsLeft <= 0 || my.doubleVote}
            onClick={() => act({ action: "powerup", type: "extraLife" })}
          >
            ✌️ Double Vote
          </Button>
        </div>
      )}

      {freezePicker && (
        <div className="fixed inset-0 z-40 flex items-end bg-stage/80" role="dialog" aria-modal="true" aria-labelledby="mfreeze-title">
          <Panel className="mx-auto mb-4 flex w-[calc(100%-1.5rem)] max-w-md flex-col gap-2">
            <h2 id="mfreeze-title" className="font-display text-xl font-bold">
              Freeze whose voting screen for 5s?
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

/** After the reveal: "You read the room!" or the out-of-lives screen. */
function MltResult({ view, act }: { view: PlayerView; act: (b: Record<string, unknown>) => Promise<unknown> }) {
  const rv = view.reveal!;
  const my = view.my;
  const sd = view.round?.kind === "suddenDeath";
  const crowned = rv.crowned.map((c) => c.nickname).join(" & ");
  const result = my?.voteResult ?? null;
  const summary = (
    <Panel className="text-center">
      <p className="text-sm text-mute">{rv.answer}</p>
      <p className="font-display mt-1 text-2xl font-black text-yellow">
        {rv.skipped ? "Question skipped — no points" : crowned ? `👑 ${crowned}` : "Nobody voted — no crown"}
      </p>
      {!sd && !rv.skipped && my && (
        <p className="mt-2">
          <strong className="text-lime">{my.points > 0 ? `+${my.points}` : my.points}</strong> points this round · you&apos;re{" "}
          <strong className="text-yellow">#{view.me.rank}</strong>
        </p>
      )}
      <p className="mt-2 text-sm text-mute">Waiting for the host to continue…</p>
    </Panel>
  );
  if (sd) {
    return (
      <>
        <Panel className="text-center">
          <p className="font-display text-3xl font-black">{rv.sdWinnerId === view.me.id ? "🏆 You won the crown!" : "Sudden Death is over!"}</p>
        </Panel>
        {summary}
      </>
    );
  }
  if (result === "correct")
    return (
      <>
        <Celebrate />
        <Panel className="text-center">
          <p className="text-6xl" aria-hidden>
            🎯
          </p>
          <p className="font-display text-4xl font-black text-lime" role="status">
            You read the room!
          </p>
        </Panel>
        {summary}
        <Panel>
          <Reactions act={act} />
        </Panel>
      </>
    );
  if (result === "wrong" || result === "missed")
    return (
      <>
        <Panel className="flex flex-col items-center py-6 text-center">
          <div className="animate-laugh text-[7rem] leading-none" role="img" aria-label="Laughing emoji">
            😂
          </div>
          <p className="font-display neon-text mt-3 text-5xl font-black text-pink" role="status">
            {view.content === "pg13" ? "YOU SUCK 😂" : "YOU'RE OUT 😂"}
          </p>
          <p className="mt-2 text-mute">{result === "missed" ? "You didn't vote in time." : "Your vote didn't match the crown."}</p>
        </Panel>
        {summary}
        <Panel>
          <Reactions act={act} />
        </Panel>
      </>
    );
  return (
    <>
      {summary}
      <Panel>
        <Reactions act={act} />
      </Panel>
    </>
  );
}

// ---------------------------------------------------------------------------
function RevealScreen({ view, act }: { view: PlayerView; act: (b: Record<string, unknown>) => Promise<unknown> }) {
  const rv = view.reveal!;
  const my = view.my;
  const sd = view.round?.kind === "suddenDeath";
  const iWon = sd && rv.sdWinnerId === view.me.id;
  if (rv.mode === "mlt") return <MltResult view={view} act={act} />;
  if (rv.mode === "wwi") return <WwiRevealScreen view={view} act={act} />;
  return (
    <>
      <Panel className="flex flex-col items-center gap-3 text-center">
        <p className="text-sm font-bold tracking-widest text-mute uppercase">{rv.skipped ? "Word skipped — no points" : "The answer was"}</p>
        <p className="font-display text-3xl font-black break-words text-yellow">{rv.answer}</p>
        {rv.isFriend && rv.authorName && (
          <p className="text-mute">
            🤝 Written by <strong className="text-ink">{rv.authorName}</strong>
            {rv.authorBonus > 0 && ` (+${rv.authorBonus} for stumping ${rv.stumpedCount})`}
          </p>
        )}
      </Panel>
      <Panel className="text-center">
        {sd ? (
          <p className="font-display text-3xl font-black">{iWon ? "🏆 You won Sudden Death!" : rv.sdWinnerId ? "Sudden Death is over!" : "Nobody solved it — another word!"}</p>
        ) : (
          <>
            <p className="font-display text-4xl font-black text-lime">
              {my && my.points > 0 ? `+${my.points}` : my?.points ?? 0}
            </p>
            {rv.mode === "emoji" && !rv.skipped && (
              <p className="text-sm text-mute">
                {rv.solvedCount} of {rv.totalPlayers} got it{rv.fastest ? ` · ⚡ fastest: ${rv.fastest.nickname}` : ""}
              </p>
            )}
            <p className="text-mute">points this round</p>
            <p className="mt-2 text-xl">
              You&apos;re <strong className="text-yellow">#{view.me.rank}</strong> overall
            </p>
          </>
        )}
        <p className="mt-2 text-sm text-mute">Waiting for the host to continue…</p>
      </Panel>
      <Panel>
        <Reactions act={act} />
      </Panel>
    </>
  );
}

function LoserPickScreen({ view, room, act }: { view: PlayerView; room: Room; act: (b: Record<string, unknown>) => Promise<unknown> }) {
  const lp = view.loserPick!;
  useTicker(250);
  const secs = Math.max(0, Math.ceil((lp.deadline - room.serverNow()) / 1000));
  if (lp.playerId !== view.me.id)
    return (
      <>
        <Panel className="text-center">
          <p className="text-6xl" aria-hidden>
            🎯
          </p>
          <p className="font-display mt-2 text-2xl font-black">
            {lp.nickname} is picking the next {lp.kind === "pack" ? "question pack" : "category"}…
          </p>
          <p className="text-mute">{secs}s left</p>
        </Panel>
        <Panel>
          <Reactions act={act} />
        </Panel>
      </>
    );
  return (
    <Panel className="flex flex-col gap-3">
      <h2 className="font-display text-2xl font-black">🎯 Loser Picks! You choose the next {lp.kind === "pack" ? "question pack" : "category"}</h2>
      <p className="text-mute" role="timer">
        {secs}s left — otherwise it&apos;s random.
      </p>
      <div className="grid grid-cols-2 gap-2">
        {lp.options.map((o) => (
          <Button key={o.id} variant="ghost" className="min-h-16" onClick={() => act({ action: "pickCategory", category: o.id })}>
            <span aria-hidden>{o.emoji}</span> {o.label}
          </Button>
        ))}
      </div>
    </Panel>
  );
}

function DareScreen({ view, act }: { view: PlayerView; act: (b: Record<string, unknown>) => Promise<unknown> }) {
  const d = view.dare!;
  const mine = d.playerId === view.me.id;
  const result = d.resultIndex != null ? d.options[d.resultIndex] : null;
  return (
    <>
      <Panel className="flex flex-col items-center gap-3 text-center">
        <p className="text-6xl" aria-hidden>
          🎡
        </p>
        <h2 className="font-display text-2xl font-black">{mine ? "You're spinning the Dare Wheel!" : `${d.nickname} is on the Dare Wheel`}</h2>
        {d.status === "waiting" && mine && (
          <Button big variant="pink" onClick={() => act({ action: "spinDare" })}>
            Spin it! 🎡
          </Button>
        )}
        {d.status === "waiting" && !mine && <p className="text-mute">Waiting for the spin… watch the TV!</p>}
        {d.status === "spun" && result && <p className="text-xl font-bold text-yellow">“{result}”</p>}
        {d.status === "passed" && <p className="text-xl font-bold">Passed — no worries! 👋</p>}
        {mine && d.status === "spun" && (
          <Button variant="ghost" onClick={() => act({ action: "passDare" })}>
            Pass on this dare
          </Button>
        )}
        <p className="text-sm text-mute">Dares are always optional.</p>
      </Panel>
      {!mine && (
        <Panel>
          <Reactions act={act} />
        </Panel>
      )}
    </>
  );
}

function EndedScreen({ view }: { view: PlayerView }) {
  const f = view.final!;
  const me = f.standings.find((s) => s.id === view.me.id);
  const myAwards = f.awards.filter((a) => a.playerId === view.me.id);
  const won = f.winnerId === view.me.id || me?.rank === 1;
  return (
    <>
      {won && <Celebrate />}
      <Panel className="text-center">
        <Logo size="sm" />
        <p className="font-display mt-3 text-5xl font-black text-yellow">#{me?.rank ?? "—"}</p>
        <p className="text-xl">{won ? "🏆 Champion of the night!" : `with ${view.me.score} points`}</p>
      </Panel>
      {myAwards.length > 0 && (
        <Panel className="flex flex-col gap-2">
          <h2 className="font-display text-xl font-bold">Your awards</h2>
          {myAwards.map((a) => (
            <p key={a.key}>
              <span aria-hidden>{a.emoji}</span> <strong>{a.title}</strong> — {a.detail}
            </p>
          ))}
        </Panel>
      )}
      <Panel>
        <h2 className="font-display mb-2 text-xl font-bold">Final standings</h2>
        <ol className="flex flex-col gap-1">
          {f.standings.slice(0, 10).map((s) => (
            <li key={s.id} className={`flex justify-between rounded-lg px-2 py-1 ${s.id === view.me.id ? "bg-panel-2" : ""}`}>
              <span>
                #{s.rank} {s.nickname}
              </span>
              <span className="font-bold text-cyan tabular-nums">{s.score}</span>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-center text-sm text-mute">If the host taps Play Again, you&apos;ll go straight back to the lobby.</p>
      </Panel>
    </>
  );
}
