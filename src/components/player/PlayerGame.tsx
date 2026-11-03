"use client";

import { ConnectionBanner, Logo, Panel, RoomGate, Stage } from "@/components/ui";
import { useRoom } from "@/lib/client/useRoom";
import type { PlayerView } from "@/lib/game/views";
import { useEffect } from "react";

export function PlayerGame({ code, token, onLostSeat }: { code: string; token: string; onLostSeat: () => void }) {
  const { view, status, errorMessage } = useRoom<PlayerView>(code, "player", { "x-player-token": token });
  useEffect(() => {
    if (status === "unauthorized") onLostSeat();
  }, [status, onLostSeat]);
  if (!view || status === "notFound" || status === "removed") return <RoomGate status={status} errorMessage={errorMessage} hasView={!!view} role="player" />;
  return (
    <Stage>
      <ConnectionBanner status={status} />
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-6 px-4 text-center">
        <Logo size="sm" />
        <Panel className="w-full">
          <p className="font-display text-3xl font-black">You&apos;re in, {view.me.nickname}! 🎉</p>
          <p className="mt-2 text-mute">Watch the TV — the host will start soon.</p>
        </Panel>
      </main>
    </Stage>
  );
}
