"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { TvScreen } from "@/components/tv/TvScreen";
import { unlockAudio } from "@/components/tv/sound";
import { Button, Logo, RoomGate, Stage } from "@/components/ui";
import { useRoom } from "@/lib/client/useRoom";
import type { TvView } from "@/lib/game/views";

export default function TvPage() {
  const params = useParams<{ code: string }>();
  const code = params.code.toUpperCase();
  const room = useRoom<TvView>(code, "tv", {}, { pollMs: 2000, minGapMs: 300 });
  const [started, setStarted] = useState(false);

  if (!room.view || room.status === "notFound")
    return <RoomGate status={room.status} errorMessage={room.errorMessage} hasView={!!room.view} role="tv" />;

  if (!started)
    return (
      <Stage>
        <main className="flex min-h-dvh flex-col items-center justify-center gap-10 px-6 text-center">
          <Logo size="xl" />
          <p className="max-w-3xl text-3xl text-mute">
            TV display for room <span className="font-display font-black tracking-widest text-yellow">{code}</span>. Tap start to turn
            on sound and go full screen.
          </p>
          <Button
            big
            variant="pink"
            className="min-h-24 px-14 text-4xl"
            autoFocus
            onClick={() => {
              unlockAudio();
              setStarted(true);
              document.documentElement.requestFullscreen?.().catch(() => {});
            }}
          >
            ▶ Start TV
          </Button>
          <p className="text-xl text-mute">Tip: connect this laptop to the TV by HDMI. Phones stay silent — sound plays only here.</p>
        </main>
      </Stage>
    );

  return <TvScreen room={room} />;
}
