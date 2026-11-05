"use client";

import Link from "next/link";
import { Timer } from "@/components/game/Timer";
import { Segmented } from "@/components/Segmented";
import { Button, ConnectionBanner, Logo, Panel, RoomGate, Stage, Toast } from "@/components/ui";
import { siteUrl } from "@/lib/client/storage";
import { useTicker } from "@/lib/client/useRoom";
import type { HostView } from "@/lib/game/views";
import type { GameMode } from "@/lib/game/types";

export const MODE_LABEL: Record<GameMode, string> = {
  hangman: "🔤 Hangman",
  emoji: "😀 Emoji Decode",
  mlt: "👑 Most Likely To",
  wwi: "🕵️ Who Wrote It?",
  mixed: "🔀 Mixed",
};
import { useHost } from "./useHost";

const PHASE_LABEL: Record<HostView["phase"], string> = {
  lobby: "Lobby — waiting for players",
  round: "Round in progress",
  reveal: "Answer revealed",
  loserPick: "Loser Picks",
  dare: "Dare Wheel",
  ended: "Game over",
};

/** Phone-friendly control surface. The host does not play. */
export function HostControls({ code }: { code: string }) {
  const host = useHost(code);
  const { view, status, errorMessage, run, toast, token } = host;
  useTicker(500);
  if (token === null) return <RoomGate status="unauthorized" errorMessage={null} hasView={false} role="host" />;
  if (!view || status === "notFound" || status === "unauthorized")
    return <RoomGate status={status} errorMessage={errorMessage} hasView={!!view} role="host" />;

  const r = view.round;
  const busyGuard = (body: Record<string, unknown>, confirmText?: string) => () => {
    if (confirmText && !confirm(confirmText)) return;
    void run(body);
  };
  const nextLabel =
    view.phase === "reveal"
      ? r?.kind === "suddenDeath"
        ? view.reveal?.sdWinnerId
          ? "Show final results"
          : "Next sudden-death word"
        : view.roundsPlayed >= view.totalRounds
          ? "Finish game"
          : "Next ▶"
      : view.phase === "loserPick"
        ? "Pick randomly now ▶"
        : "Continue ▶";

  return (
    <Stage beams={false}>
      <ConnectionBanner status={status} />
      <main className="mx-auto flex max-w-md flex-col gap-4 px-4 py-5">
        <header className="flex items-center justify-between">
          <div>
            <Logo size="sm" />
            <h1 className="font-display text-xl font-black">Host Controls</h1>
          </div>
          <div className="text-right">
            <div className="text-xs text-mute">Room</div>
            <div className="font-display text-3xl font-black tracking-widest text-yellow">{view.code}</div>
          </div>
        </header>

        {view.hold === "needPlayers" && (
          <p role="alert" className="rounded-2xl bg-orange px-4 py-3 font-bold text-stage">
            ⚠️ Most Likely To needs at least 3 players. The game is paused here — ask someone to join (they can scan the QR code now),
            then tap Next. Or end the game.
          </p>
        )}
        <Panel className="flex flex-col gap-2" aria-live="polite">
          <p className="font-display text-xl font-bold">{view.paused ? "⏸ Paused" : PHASE_LABEL[view.phase]}</p>
          {r && view.phase !== "lobby" && view.phase !== "ended" && (
            <p className="text-mute">
              {r.kind === "suddenDeath" ? `Sudden Death #${r.sdAttempt}` : `Round ${r.number} of ${view.totalRounds}`}
              {r.kind === "final" && " · 2× FINAL"} · {r.mode === "emoji" ? "😀 Emoji Decode" : r.mode === "mlt" ? "👑 Most Likely To" : "🔤 Hangman"} ·{" "}
              {r.categoryEmoji} {r.category}
            </p>
          )}
          {view.phase === "round" && r?.mode === "emoji" && r.clue && (
            <p className="text-4xl" role="img" aria-label={`Emoji clue ${r.clue}`}>
              {r.clue}
            </p>
          )}
          {view.phase === "round" && r && r.hostHints.length > 0 && (
            <ul className="text-sm">
              {r.hostHints.map((h) => (
                <li key={h}>💡 {h}</li>
              ))}
            </ul>
          )}
          {view.phase === "round" && r?.mode === "mlt" && r.question && <p className="font-display text-lg font-bold">{r.question}</p>}
          {view.phase === "round" && r && <Timer timer={r.timer} serverNow={host.serverNow} />}
          {view.progress && r?.mode === "mlt" && (
            <p className="text-sm">
              🗳️ {view.progress.total - view.progress.playing} of {view.progress.total} voted (votes stay secret — even from you)
            </p>
          )}
          {view.progress && r?.mode !== "mlt" && (
            <p className="text-sm">
              <span className="text-lime">✓ {view.progress.solved} solved</span> · <span className="text-red">💥 {view.progress.out} out</span> ·{" "}
              <span>{view.progress.playing} still guessing</span>
            </p>
          )}
          {view.phase === "loserPick" && view.loserPick && (
            <p>
              {view.loserPick.nickname} is choosing the next {view.loserPick.kind === "pack" ? "question pack" : "category"}…
            </p>
          )}
          {view.phase === "dare" && view.dare && (
            <p>
              🎡 {view.dare.nickname}:{" "}
              {view.dare.status === "waiting" ? "waiting to spin" : view.dare.status === "passed" ? "passed" : `“${view.dare.options[view.dare.resultIndex ?? 0]}”`}
            </p>
          )}
          {view.reveal && view.reveal.mode !== "mlt" && (
            <p className="text-sm text-mute">
              Answer: <strong className="text-yellow">{view.reveal.answer}</strong>
            </p>
          )}
          {view.reveal && view.reveal.mode === "mlt" && !view.reveal.skipped && (
            <p className="text-sm text-mute">
              👑 {view.reveal.crowned.length ? view.reveal.crowned.map((c) => c.nickname).join(" & ") : "Nobody voted — no crown"}
            </p>
          )}
        </Panel>

        <div className="grid grid-cols-2 gap-3">
          {(view.phase === "lobby" || view.phase === "ended") && (
            <div className="col-span-2 rounded-3xl border-2 border-line bg-panel/85 p-4">
              <Segmented
                label="Game mode"
                value={view.settings.mode ?? "hangman"}
                options={(["hangman", "emoji", "mlt", "mixed"] as const).map((m) => ({ value: m, label: MODE_LABEL[m] }))}
                onChange={(m) => void run({ action: "updateSettings", settings: { mode: m } })}
              />
            </div>
          )}
          {view.phase === "lobby" && (
            <Button
              big
              variant="lime"
              className="col-span-2"
              onClick={busyGuard({ action: "start" })}
              disabled={view.players.length === 0 || (view.settings.mode === "mlt" && view.players.length < 3)}
            >
              ▶ Start game
            </Button>
          )}
          {view.phase === "lobby" && view.settings.mode === "mlt" && view.players.length < 3 && (
            <p className="col-span-2 text-center text-sm text-mute">Most Likely To needs at least 3 players.</p>
          )}
          {view.phase === "round" &&
            (view.paused ? (
              <Button big variant="lime" onClick={busyGuard({ action: "resume" })}>
                ▶ Resume
              </Button>
            ) : (
              <Button big variant="yellow" onClick={busyGuard({ action: "pause" })}>
                ⏸ Pause
              </Button>
            ))}
          {view.phase === "round" && (
            <Button
              big
              variant="ghost"
              onClick={busyGuard(
                { action: "skip" },
                r?.mode === "mlt" ? "Skip this question? Votes are discarded and nobody gets points." : "Skip this word? Nobody gets points for it.",
              )}
            >
              ⏭ {r?.mode === "mlt" ? "Skip question" : "Skip word"}
            </Button>
          )}
          {view.phase === "round" && r?.mode === "emoji" && (
            <Button
              variant="yellow"
              className="col-span-2"
              disabled={r.hostHints.length >= 2}
              onClick={busyGuard(
                { action: "dropHint" },
                "Drop a hint for everyone? Each hint takes 25 points off the maximum for anyone who hasn't answered yet.",
              )}
            >
              💡{" "}
              {r.hostHints.length >= 2
                ? "Both hints dropped"
                : `Drop hint ${r.hostHints.length + 1}/2: ${r.hostHints.length === 0 ? "first letter" : "word & letter count"}`}
            </Button>
          )}
          {(view.phase === "reveal" || view.phase === "loserPick" || view.phase === "dare") && (
            <Button big variant="lime" className="col-span-2" onClick={busyGuard({ action: "next" })}>
              {nextLabel}
            </Button>
          )}
          {view.phase === "dare" && (
            <Button variant="pink" className="col-span-2" onClick={busyGuard({ action: "respinDare" })}>
              🔄 Re-spin dare
            </Button>
          )}
          {view.phase === "ended" && (
            <Button big variant="pink" className="col-span-2" onClick={busyGuard({ action: "playAgain" })}>
              🔁 Play Again (same room & players)
            </Button>
          )}
          {view.phase !== "ended" && view.phase !== "lobby" && (
            <Button variant="danger" className="col-span-2" onClick={busyGuard({ action: "end" }, "End the game now and show the final results?")}>
              ⏹ End game
            </Button>
          )}
        </div>

        <Panel>
          <h2 className="font-display mb-2 text-lg font-bold">Players ({view.players.length})</h2>
          <ul className="flex flex-col gap-1">
            {view.leaderboard.map((p) => {
              const rival = view.rivals.find((x) => x.id === p.id);
              return (
                <li key={p.id} className="flex items-center justify-between gap-2 rounded-xl bg-stage px-3 py-1">
                  <span className="min-w-0 truncate">
                    #{p.rank} {p.nickname}
                    {rival && view.phase === "round" && (
                      <span className="ml-2 text-sm text-mute">
                        {rival.status === "solved"
                          ? "✓"
                          : rival.status === "out"
                            ? "💥"
                            : rival.status === "waiting"
                              ? "next round"
                              : rival.status === "voted"
                                ? "🗳️ voted"
                                : r?.mode === "mlt"
                                  ? "voting…"
                                  : r?.mode === "emoji"
                                ? `🎯×${rival.lives}`
                                : `${rival.pct}%`}
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="font-bold text-cyan tabular-nums">{p.score}</span>
                    <button
                      className="min-h-11 min-w-11 rounded-full text-mute hover:text-red"
                      aria-label={`Remove ${p.nickname}`}
                      onClick={busyGuard({ action: "removePlayer", playerId: p.id }, `Remove ${p.nickname} from the game?`)}
                    >
                      ✕
                    </button>
                  </span>
                </li>
              );
            })}
            {view.leaderboard.length === 0 && <li className="text-mute">No players yet.</li>}
          </ul>
        </Panel>

        <nav className="flex flex-wrap justify-center gap-4 text-cyan">
          <Link href={`/host/${code}/prep#k=${token}`} className="underline underline-offset-4">
            Host Prep
          </Link>
          <a href={`${siteUrl()}/tv/${code}`} target="_blank" rel="noreferrer" className="underline underline-offset-4">
            Open TV display
          </a>
        </nav>
        <p className="text-center text-xs text-mute">Lost connection? Re-open your private host link — the game keeps running on the server.</p>
      </main>
      <Toast message={toast?.msg ?? null} tone={toast?.tone} />
    </Stage>
  );
}
