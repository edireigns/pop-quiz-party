"use client";

import { useEffect, useState } from "react";
import { QrCode } from "@/components/QrCode";
import { ConnectionBanner, Logo, Stage } from "@/components/ui";
import { siteUrl } from "@/lib/client/storage";
import type { useRoom } from "@/lib/client/useRoom";
import type { TvView } from "@/lib/game/views";

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
      onClick={() => (fs ? document.exitFullscreen?.() : document.documentElement.requestFullscreen?.())?.catch?.(() => {})}
      aria-label={fs ? "Exit full screen" : "Enter full screen"}
    >
      {fs ? "⤡ Exit" : "⤢ Full screen"}
    </button>
  );
}

export function TvLobby({ view }: { view: TvView }) {
  const joinUrl = `${siteUrl()}/play/${view.code}`;
  const players = view.lobby?.players ?? [];
  return (
    <div className="grid h-[calc(100dvh-6rem)] grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-[2vw] px-[3vw] pb-[2vw]">
      <div className="flex flex-col items-center justify-center gap-[1.5vw] rounded-[2vw] border-4 border-cyan bg-panel/80 p-[2vw] text-cyan neon-box">
        <p className="font-display text-[2.4vw] font-black text-ink">Scan to join!</p>
        <QrCode value={joinUrl} className="w-[24vw] max-w-[60vh]" label={`QR code to join. Or visit ${joinUrl}`} />
        <p className="text-center text-[1.4vw] text-mute">
          or go to <strong className="text-ink">{joinUrl.replace(/^https?:\/\//, "").replace(/\/play\/.*/, "")}/join</strong>
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
        {view.lobby?.friendWords && (
          <p className="text-[1.5vw] text-mute">
            🤝 Friend-written words are ON — submit yours on your phone! ({view.lobby.submissions} in)
          </p>
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
        <p className="text-[1.5vw] text-mute">The host starts the game from their phone.</p>
      </div>
    </div>
  );
}

export function TvScreen({ room }: { room: Room }) {
  const view = room.view!;
  return (
    <Stage>
      <ConnectionBanner status={room.status} />
      <header className="flex h-24 items-center justify-between px-[3vw]">
        <Logo size="md" />
        <div className="flex items-center gap-3">
          <FullscreenButton />
        </div>
      </header>
      {view.phase === "lobby" ? (
        <TvLobby view={view} />
      ) : (
        <p className="p-10 text-center text-4xl">Game in progress…</p>
      )}
    </Stage>
  );
}
