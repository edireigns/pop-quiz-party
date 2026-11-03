"use client";

import Link from "next/link";
import { Timer } from "@/components/game/Timer";
import { Button, ConnectionBanner, Logo, Panel, RoomGate, Stage, Toast } from "@/components/ui";
import { siteUrl } from "@/lib/client/storage";
import { useTicker } from "@/lib/client/useRoom";
import type { HostView } from "@/lib/game/views";
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

        <Panel className="flex flex-col gap-2" aria-live="polite">
          <p className="font-display text-xl font-bold">{view.paused ? "⏸ Paused" : PHASE_LABEL[view.phase]}</p>
          {r && view.phase !== "lobby" && view.phase !== "ended" && (
            <p className="text-mute">
              {r.kind === "suddenDeath" ? `Sudden Death #${r.sdAttempt}` : `Round ${r.number} of ${view.totalRounds}`}
              {r.kind === "final" && " · 2× FINAL"} · {r.categoryEmoji} {r.category}
            </p>
          )}
          {view.phase === "round" && r && <Timer timer={r.timer} serverNow={host.serverNow} />}
          {view.progress && (
            <p className="text-sm">
              <span className="text-lime">✓ {view.progress.solved} solved</span> · <span className="text-red">💥 {view.progress.out} out</span> ·{" "}
              <span>{view.progress.playing} still guessing</span>
            </p>
          )}
          {view.phase === "loserPick" && view.loserPick && <p>{view.loserPick.nickname} is choosing the next category…</p>}
          {view.phase === "dare" && view.dare && (
            <p>
              🎡 {view.dare.nickname}:{" "}
              {view.dare.status === "waiting" ? "waiting to spin" : view.dare.status === "passed" ? "passed" : `“${view.dare.options[view.dare.resultIndex ?? 0]}”`}
            </p>
          )}
          {view.reveal && <p className="text-sm text-mute">Answer: <strong className="text-yellow">{view.reveal.answer}</strong></p>}
        </Panel>

        <div className="grid grid-cols-2 gap-3">
          {view.phase === "lobby" && (
            <Button big variant="lime" className="col-span-2" onClick={busyGuard({ action: "start" })} disabled={view.players.length === 0}>
              ▶ Start game
            </Button>
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
            <Button big variant="ghost" onClick={busyGuard({ action: "skip" }, "Skip this word? Nobody gets points for it.")}>
              ⏭ Skip word
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
                        {rival.status === "solved" ? "✓" : rival.status === "out" ? "💥" : rival.status === "waiting" ? "next round" : `${rival.pct}%`}
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
