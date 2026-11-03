"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Balloon } from "@/components/Balloons";
import { Button, Logo, Panel, Stage, Toast } from "@/components/ui";
import { setHostToken } from "@/lib/client/storage";

export default function Home() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createGame() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/rooms", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? "Couldn't create a game.");
      setHostToken(data.code, data.hostToken);
      router.push(`/host/${data.code}/prep#k=${data.hostToken}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Stage>
      <main className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center gap-8 px-4 py-10 text-center">
        <div className="flex gap-2" aria-hidden>
          {["#ff4fb1", "#33e6ff", "#ffe14d", "#8dff6b", "#b18cff", "#ff9a3d"].map((c) => (
            <Balloon key={c} color={c} size={34} />
          ))}
        </div>
        <h1>
          <Logo size="lg" />
        </h1>
        <p className="max-w-md text-lg text-mute">
          The neon word-guessing showdown for your living room. Everyone solves the same mystery phrase on their own phone —
          the TV shows who&apos;s winning. Pop all six balloons and you&apos;re out!
        </p>
        <Panel className="flex w-full flex-col gap-3">
          <Button big variant="pink" onClick={createGame} disabled={busy}>
            {busy ? "Setting the stage…" : "🎤 Host a new game"}
          </Button>
          <Link
            href="/join"
            className="font-display inline-flex min-h-16 items-center justify-center rounded-2xl border-2 border-line bg-panel-2 px-5 text-xl font-bold hover:border-violet"
          >
            📱 Join with a code
          </Link>
        </Panel>
        <ul className="grid w-full grid-cols-1 gap-2 text-left text-mute sm:grid-cols-3">
          <li>📺 TV shows the QR code &amp; live leaderboard</li>
          <li>📱 Phones are the controllers</li>
          <li>🚫 No accounts, no app installs</li>
        </ul>
      </main>
      <Toast message={error} tone="error" />
    </Stage>
  );
}
