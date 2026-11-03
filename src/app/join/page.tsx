"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Logo, Panel, Stage } from "@/components/ui";

export default function JoinPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const clean = code.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 5);
  return (
    <Stage>
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-6 px-4">
        <Logo size="md" />
        <Panel className="w-full">
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (clean.length === 5) router.push(`/play/${clean}`);
            }}
          >
            <label htmlFor="code" className="font-display text-xl font-bold">
              Room code
            </label>
            <input
              id="code"
              value={clean}
              onChange={(e) => setCode(e.target.value)}
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="off"
              autoFocus
              placeholder="ABCDE"
              aria-describedby="code-help"
              className="font-display h-16 rounded-2xl border-2 border-line bg-stage text-center text-4xl font-black uppercase tracking-[0.3em] text-yellow placeholder:text-line"
            />
            <p id="code-help" className="text-sm text-mute">
              The 5-letter code is on the TV.
            </p>
            <Button big type="submit" disabled={clean.length !== 5}>
              Let&apos;s go
            </Button>
          </form>
        </Panel>
      </main>
    </Stage>
  );
}
