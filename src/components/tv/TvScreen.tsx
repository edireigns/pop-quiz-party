"use client";

import { useEffect, useRef, useState } from "react";
import { Pattern } from "@/components/game/Pattern";
import { TvLeaderboard } from "@/components/game/Leaderboard";
import { Timer } from "@/components/game/Timer";
import { QrCode } from "@/components/QrCode";
import { ConnectionBanner, Logo, Stage } from "@/components/ui";
import { siteUrl } from "@/lib/client/storage";
import { useTicker, type useRoom } from "@/lib/client/useRoom";
import type { TvView } from "@/lib/game/views";
import { DareWheel } from "./DareWheel";
import { MltQuestion, MltReveal } from "./MltStage";
import { Podium } from "./Podium";
import { FloatingReactions } from "./FloatingReactions";
import { useTvSound, MuteButton } from "./sound";

type Room = ReturnType<typeof useRoom<TvView>>;

export function FullscreenButton() {
  const [fs, setFs] = useState(false);
  useEffect(() => {
    const on = () => setFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  return (
    <button
      className="min-h-12 rounded-xl border-2 border-line bg-panel px-4 text-lg font-bold hover:border-violet"
      onClick={() => {
        const p = fs ? document.exitFullscreen?.() : document.documentElement.requestFullscreen?.();
        p?.catch?.(() => {});
      }}
      aria-label={fs ? "Exit full screen" : "Enter full screen"}
    >
      {fs ? "⤡ Exit full screen" : "⤢ Full screen"}
    </button>
  );
}

export function TvLobby({ view }: { view: TvView }) {
  const joinUrl = `${siteUrl()}/play/${view.code}`;
  const players = view.lobby?.players ?? [];
  return (
    <div className="grid h-[calc(100dvh-6rem)] grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-[2vw] px-[3vw] pb-[2vw]">
      <div className="neon-box flex flex-col items-center justify-center gap-[1.5vw] rounded-[2vw] border-4 border-cyan bg-panel/80 p-[2vw] text-cyan">
        <p className="font-display text-[2.4vw] font-black text-ink">Scan to join!</p>
        <QrCode value={joinUrl} className="w-[24vw] max-w-[58vh]" label={`QR code to join. Or visit ${joinUrl}`} />
        <p className="text-center text-[1.4vw] text-mute">
          or go to <strong className="text-ink">{siteUrl().replace(/^https?:\/\//, "")}/join</strong>
        </p>
        <p className="font-display text-[1.6vw] text-ink">
          Room code{" "}
          <span className="neon-text text-[4.5vw] font-black tracking-[0.2em] text-yellow" aria-label={view.code.split("").join(" ")}>
            {view.code}
          </span>
        </p>
      </div>
      <div className="flex min-h-0 flex-col gap-[1vw]">
        <h2 className="font-display text-[2.6vw] font-black">
          <span className="text-pink">{players.length}</span> {players.length === 1 ? "player" : "players"} ready
        </h2>
        <p className="font-display text-[1.8vw] font-bold text-cyan">
          Game mode: {MODE_NAMES[view.mode ?? "hangman"]}
          {view.mode === "mixed" && <span className="text-mute"> ({view.mixedModes.map((m) => MODE_NAMES[m].replace(/^\S+ /, "")).join(" ⇄ ")})</span>}
        </p>
        {(view.mode === "mlt" || (view.mode === "mixed" && view.mixedModes.includes("mlt"))) && players.length < 3 && (
          <p className="text-[1.5vw] text-orange">👑 Most Likely To needs at least 3 players.</p>
        )}
        {view.lobby?.friendWords && (
          <p className="text-[1.5vw] text-mute">🤝 Friend-written words are ON — submit yours on your phone! ({view.lobby.submissions} in)</p>
        )}
        <ul className="flex min-h-0 flex-1 flex-wrap content-start gap-[0.8vw] overflow-hidden" aria-live="polite">
          {players.map((p, i) => (
            <li
              key={p.id}
              className="animate-pop-in font-display rounded-full border-2 px-[1.4vw] py-[0.5vw] text-[1.9vw] font-bold"
              style={{ borderColor: ["#ff4fb1", "#33e6ff", "#ffe14d", "#8dff6b", "#b18cff"][i % 5] }}
            >
              {p.nickname}
            </li>
          ))}
          {players.length === 0 && <li className="text-[1.8vw] text-mute">Waiting for players…</li>}
        </ul>
        <p className="text-[1.5vw] text-mute">
          {view.totalRounds} rounds · 6 balloons each · the host starts the game from their phone.
        </p>
      </div>
    </div>
  );
}

function Splash({ text, sub, tone = "text-yellow" }: { text: string; sub?: string; tone?: string }) {
  return (
    <div className="animate-pop-in pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-center bg-stage/85 text-center" role="alert">
      <p className={`font-display neon-text text-[8vw] leading-none font-black ${tone}`}>{text}</p>
      {sub && <p className="font-display mt-[2vw] text-[2.6vw] font-bold">{sub}</p>}
    </div>
  );
}

/** Briefly show a splash whenever `key` changes to a non-null value. */
function useSplash(key: string | null, ms = 3200) {
  const [shown, setShown] = useState<string | null>(null);
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (!key || key === last.current) return;
    last.current = key;
     
    setShown(key);
    const t = setTimeout(() => setShown(null), ms);
    return () => clearTimeout(t);
  }, [key, ms]);
  return shown;
}

const MODE_NAMES = { hangman: "🔤 Hangman", emoji: "😀 Emoji Decode", mlt: "👑 Most Likely To", wwi: "🕵️ Who Wrote It?", mixed: "🔀 Mixed" } as const;

/** Emoji Decode on the TV: huge clue, host hints, answered count; at reveal the answer and stats. */
function EmojiClue({ view, revealing }: { view: TvView; revealing: boolean }) {
  const r = view.round!;
  const rv = view.reveal;
  return (
    <div className="flex w-full flex-col items-center gap-[1.6vw] text-center text-ink">
      <p
        className={`leading-none drop-shadow-[0_0_24px_rgba(177,140,255,0.55)] ${revealing ? "text-[min(7vw,16vh)]" : "text-[min(11vw,26vh)]"}`}
        role="img"
        aria-label={`Emoji clue: ${r.clue ?? ""}`}
      >
        {r.clue}
      </p>
      {r.hostHints.length > 0 && (
        <ul className="flex flex-wrap justify-center gap-[1vw]" aria-label="Hints">
          {r.hostHints.map((h) => (
            <li key={h} className="animate-pop-in rounded-full border-2 border-yellow bg-stage/80 px-[1.4vw] py-[0.4vw] text-[1.8vw] font-bold text-yellow">
              💡 {h}
            </li>
          ))}
        </ul>
      )}
      {!revealing && (
        <p className="font-display text-[2.4vw] font-black" aria-live="polite">
          <span className="text-cyan">{r.answered.done}</span> of {r.answered.total} answered
        </p>
      )}
      {revealing && rv && (
        <div className="animate-pop-in flex flex-col items-center gap-[0.8vw]">
          <p className="text-[1.6vw] font-bold tracking-widest text-mute uppercase">The answer was</p>
          <p className="font-display neon-text text-[4.6vw] leading-tight font-black text-yellow">{rv.answer}</p>
          {!rv.skipped && <p className="text-[2vw]">
            <strong className="text-lime">{rv.solvedCount}</strong> of {rv.totalPlayers} got it
            {rv.fastest && (
              <>
                {" "}
                · ⚡ Fastest: <strong className="text-pink">{rv.fastest.nickname}</strong> ({(rv.fastest.ms / 1000).toFixed(1)}s)
              </>
            )}
          </p>}
        </div>
      )}
    </div>
  );
}

function RoundStage({ view, room }: { view: TvView; room: Room }) {
  const r = view.round!;
  const revealing = view.phase === "reveal" || !!view.reveal;
  const sd = r.kind === "suddenDeath";
  const finalSplash = useSplash(view.phase === "round" && r.kind === "final" ? `final-${r.number}` : null);
  const sdSplash = useSplash(view.phase === "round" && sd ? `sd-${r.sdAttempt}` : null);
  const rv = view.reveal;
  const winner = rv?.sdWinnerId ? view.leaderboard.find((e) => e.id === rv.sdWinnerId)?.nickname : null;
  return (
    <div className="relative grid h-[calc(100dvh-6rem)] grid-cols-[minmax(0,58fr)_minmax(0,42fr)] gap-[2vw] px-[2.5vw] pb-[1.5vw]">
      <section className="flex min-h-0 flex-col gap-[1.2vw]" aria-label="Puzzle">
        <div className="flex items-center justify-between gap-[1vw]">
          <p className="font-display text-[2.6vw] font-black">
            <span aria-hidden>{r.categoryEmoji}</span> {r.category}
          </p>
          <p className="text-[1.6vw] text-mute">
            {sd ? (
              <span className="font-black text-red">SUDDEN DEATH {r.sdAttempt > 1 ? `#${r.sdAttempt}` : ""}</span>
            ) : r.kind === "final" ? (
              <span className="font-black text-yellow">FINAL ROUND · 2× POINTS</span>
            ) : (
              `Round ${r.number} of ${view.totalRounds}`
            )}
            {view.mode === "mixed" && (
              <span className="ml-[0.8vw]">· {r.mode === "emoji" ? "😀 Emoji Decode" : r.mode === "mlt" ? "👑 Most Likely To" : "🔤 Hangman"}</span>
            )}
          </p>
        </div>
        {!revealing && <Timer timer={r.timer} serverNow={room.serverNow} size="tv" />}
        <div className="neon-box flex flex-1 flex-col items-center justify-center gap-[2vw] rounded-[2vw] border-4 border-violet bg-panel/70 p-[2vw] text-violet">
          {view.pattern && <Pattern cells={view.pattern} variant="tv" reveal={revealing} />}
          {r.mode === "emoji" && <EmojiClue view={view} revealing={revealing} />}
          {r.mode === "mlt" && (revealing && view.reveal ? <MltReveal view={view} /> : <MltQuestion view={view} />)}
          {revealing && rv && (
            <div className="animate-pop-in text-center text-ink">
              {rv.skipped && <p className="text-[2vw] font-bold text-orange">Skipped — no points this round</p>}
              {rv.isFriend && rv.authorName && (
                <p className="text-[2vw]">
                  🤝 Written by <strong className="text-pink">{rv.authorName}</strong>
                  {rv.authorBonus > 0 && <span className="text-lime"> · +{rv.authorBonus} for stumping {rv.stumpedCount}!</span>}
                </p>
              )}
              {sd && <p className="font-display text-[2.6vw] font-black text-yellow">{winner ? `🏆 ${winner} wins Sudden Death!` : "Everyone's out — another word!"}</p>}
            </div>
          )}
          {!revealing && sd && view.suddenDeath && (
            <p className="text-[1.8vw] text-ink">One wrong guess and you&apos;re out · first to solve wins · {view.suddenDeath.names.join(" vs ")}</p>
          )}
        </div>
        {revealing && <p className="text-center text-[1.5vw] text-mute">Waiting for the host to continue…</p>}
      </section>
      <section className="flex min-h-0 flex-col gap-[0.8vw]" aria-label="Leaderboard and rival tracker">
        <h2 className="font-display flex justify-between text-[1.6vw] font-black">
          <span>Leaderboard</span>
          {!revealing && (
            <span className="text-[1.1vw] font-normal text-mute">
              {r.mode === "emoji" ? "attempts left" : r.mode === "mlt" ? "who has voted" : "balloons · % solved"}
            </span>
          )}
        </h2>
        <div className="min-h-0 flex-1">
          <TvLeaderboard entries={view.leaderboard} rivals={view.rivals} showRound={!sd} showRivals={!revealing} mode={r.mode} />
        </div>
      </section>
      {view.paused && <Splash text="PAUSED" sub="The host will be right back" tone="text-cyan" />}
      {finalSplash && <Splash text="FINAL ROUND" sub="Every point counts DOUBLE!" />}
      {sdSplash && <Splash text="SUDDEN DEATH" sub={`${view.suddenDeath?.names.join(" vs ")} — one wrong guess and you're out!`} tone="text-red" />}
    </div>
  );
}

function LoserPickStage({ view, room }: { view: TvView; room: Room }) {
  const lp = view.loserPick!;
  useTicker(250);
  const secs = Math.max(0, Math.ceil((lp.deadline - room.serverNow()) / 1000));
  return (
    <div className="flex h-[calc(100dvh-6rem)] flex-col items-center justify-center gap-[2vw] px-[4vw] text-center">
      <p className="text-[6vw]" aria-hidden>
        🎯
      </p>
      <h2 className="font-display text-[4vw] font-black">
        Loser Picks! <span className="text-pink">{lp.nickname}</span> chooses the next {lp.kind === "pack" ? "question pack" : "category"}
      </h2>
      <div className="flex flex-wrap justify-center gap-[1vw]">
        {lp.options.map((o) => (
          <span key={o.id} className="font-display rounded-[1vw] border-2 border-line bg-panel px-[1.4vw] py-[0.8vw] text-[1.8vw] font-bold">
            {o.emoji} {o.label}
          </span>
        ))}
      </div>
      <p className="font-display text-[3vw] font-black text-yellow tabular-nums" role="timer">
        {secs}s
      </p>
    </div>
  );
}

export function TvScreen({ room }: { room: Room }) {
  const view = room.view!;
  const sound = useTvSound(view, room.serverNow);
  let body: React.ReactNode;
  switch (view.phase) {
    case "lobby":
      body = <TvLobby view={view} />;
      break;
    case "round":
    case "reveal":
      body = <RoundStage view={view} room={room} />;
      break;
    case "loserPick":
      body = <LoserPickStage view={view} room={room} />;
      break;
    case "dare":
      body = <DareWheel view={view} />;
      break;
    case "ended":
      body = <Podium view={view} />;
      break;
  }
  return (
    <Stage>
      <ConnectionBanner status={room.status} />
      <header className="flex h-24 items-center justify-between px-[2.5vw]">
        <Logo size="md" />
        <div className="flex items-center gap-4">
          {view.phase !== "lobby" && (
            <span className="font-display text-2xl font-black tracking-widest text-yellow" aria-label={`Room code ${view.code}`}>
              {view.code}
            </span>
          )}
          <MuteButton sound={sound} />
          <FullscreenButton />
        </div>
      </header>
      {body}
      {view.hold === "needPlayers" && (
        <div className="fixed inset-x-0 bottom-0 z-30 bg-orange py-[1vw] text-center text-[2vw] font-black text-stage" role="alert">
          ⏸ Most Likely To needs at least 3 players — join at {siteUrl().replace(/^https?:\/\//, "")}/join with code {view.code}
        </div>
      )}
      <FloatingReactions reactions={view.reactions} serverNow={room.serverNow} />
    </Stage>
  );
}
