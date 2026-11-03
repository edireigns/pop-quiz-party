"use client";

import Link from "next/link";
import { Button, ConnectionBanner, Logo, Panel, RoomGate, Stage, Toast } from "@/components/ui";
import { useHost } from "./useHost";

export function HostControls({ code }: { code: string }) {
  const { view, status, errorMessage, run, toast, token } = useHost(code);
  if (token === null) return <RoomGate status="unauthorized" errorMessage={null} hasView={false} role="host" />;
  if (!view || status === "notFound" || status === "unauthorized")
    return <RoomGate status={status} errorMessage={errorMessage} hasView={!!view} role="host" />;
  return (
    <Stage beams={false}>
      <ConnectionBanner status={status} />
      <main className="mx-auto flex max-w-md flex-col gap-4 px-4 py-6">
        <Logo size="sm" />
        <Panel>
          <p className="font-display text-2xl font-black">Room {view.code}</p>
          <p className="text-mute">{view.players.length} players · phase: {view.phase}</p>
        </Panel>
        {view.phase === "lobby" && (
          <Button big variant="lime" onClick={() => run({ action: "start" })} disabled={view.players.length === 0}>
            ▶ Start game
          </Button>
        )}
        <Link href={`/host/${code}/prep#k=${token}`} className="text-center text-cyan underline">
          Host Prep
        </Link>
      </main>
      <Toast message={toast?.msg ?? null} tone={toast?.tone} />
    </Stage>
  );
}
