"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { PlayerGame } from "@/components/player/PlayerGame";
import { Button, Logo, Panel, RoomGate, Stage, StatusScreen } from "@/components/ui";
import { getPlayerToken, setPlayerToken } from "@/lib/client/storage";
import { useRoom } from "@/lib/client/useRoom";
import type { TvView } from "@/lib/game/views";

export default function PlayPage() {
  const params = useParams<{ code: string }>();
  const code = params.code.toUpperCase();
  const [token, setToken] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only storage read after mount
    setToken(getPlayerToken(code));
  }, [code]);

  if (token === undefined) return <RoomGate status="loading" errorMessage={null} hasView={false} role="player" />;
  if (token)
    return (
      <PlayerGame
        code={code}
        token={token}
        onLostSeat={() => {
          setPlayerToken(code, null);
          setToken(null);
        }}
      />
    );
  return (
    <JoinScreen
      code={code}
      onJoined={(t) => {
        setPlayerToken(code, t);
        setToken(t);
      }}
    />
  );
}

function JoinScreen({ code, onJoined }: { code: string; onJoined: (token: string) => void }) {
  // Public room status (no secrets) so we can show invalid / ended states before joining.
  const { view, status, errorMessage } = useRoom<TvView>(code, "tv", {}, { pollMs: 5000 });
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const gate = <RoomGate status={status} errorMessage={errorMessage} hasView={!!view} role="player" />;
  if (!view || status === "notFound") return gate;
  if (view.phase === "ended")
    return <StatusScreen emoji="🏁" title="This game has already ended" message="Ask the host to start a new game or tap Play Again." />;

  async function join(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/rooms/${code}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? "Couldn't join.");
      onJoined(data.token);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Stage>
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-6 px-4 py-8">
        <Logo size="md" />
        <Panel className="w-full">
          <form onSubmit={join} className="flex flex-col gap-4">
            <p className="text-center text-mute">
              Joining room <strong className="font-display tracking-widest text-yellow">{code}</strong>
              {view.phase !== "lobby" && <span className="block text-sm">Game in progress — you&apos;ll jump in next round with 0 points.</span>}
            </p>
            <label htmlFor="nick" className="font-display text-xl font-bold">
              Your nickname
            </label>
            <input
              id="nick"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              maxLength={16}
              autoComplete="nickname"
              autoFocus
              aria-invalid={!!error}
              aria-describedby={error ? "nick-error" : "nick-help"}
              placeholder="e.g. Sam"
              className="font-display h-16 rounded-2xl border-2 border-line bg-stage px-4 text-center text-2xl font-bold"
            />
            {error ? (
              <p id="nick-error" role="alert" className="text-center font-bold text-red">
                {error}
              </p>
            ) : (
              <p id="nick-help" className="text-center text-sm text-mute">
                2–16 characters. Keep it friendly!
              </p>
            )}
            <Button big variant="pink" type="submit" disabled={busy || nickname.trim().length < 2}>
              {busy ? "Joining…" : "Join the party 🎉"}
            </Button>
          </form>
        </Panel>
      </main>
    </Stage>
  );
}
