"use client";

import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export const GAME_NAME = "Pop Quiz Party";

type Variant = "primary" | "pink" | "ghost" | "danger" | "lime" | "yellow";

const variants: Record<Variant, string> = {
  primary: "bg-cyan text-stage hover:brightness-110",
  pink: "bg-pink text-stage hover:brightness-110",
  lime: "bg-lime text-stage hover:brightness-110",
  yellow: "bg-yellow text-stage hover:brightness-110",
  danger: "bg-red text-stage hover:brightness-110",
  ghost: "bg-panel-2 text-ink border-2 border-line hover:border-violet",
};

export function Button({
  variant = "primary",
  big,
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; big?: boolean }) {
  return (
    <button
      {...rest}
      className={`font-display inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl px-5 font-bold transition active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 ${
        big ? "min-h-16 text-xl" : "text-base"
      } ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-3xl border-2 border-line bg-panel/85 p-4 backdrop-blur ${className}`}>{children}</section>;
}

export function Logo({ size = "md" }: { size?: "sm" | "md" | "lg" | "xl" }) {
  const cls = { sm: "text-xl", md: "text-3xl", lg: "text-5xl", xl: "text-7xl" }[size];
  return (
    <div className={`font-display font-black leading-none ${cls}`} aria-label={GAME_NAME}>
      <span className="neon-text text-pink">Pop</span> <span className="neon-text text-cyan">Quiz</span>{" "}
      <span className="neon-text text-yellow">Party</span>
    </div>
  );
}

export function Stage({ children, className = "", beams = true }: { children: ReactNode; className?: string; beams?: boolean }) {
  return (
    <div className={`stage-bg relative min-h-dvh overflow-hidden ${className}`}>
      {beams && (
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="beam animate-sweep left-[8%]" />
          <div className="beam animate-sweep right-[8%] [animation-delay:-3s]" />
        </div>
      )}
      <div className="relative">{children}</div>
    </div>
  );
}

export function StatusScreen({
  emoji,
  title,
  message,
  action,
}: {
  emoji: string;
  title: string;
  message?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Stage>
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-5 px-4 text-center">
        <div className="text-7xl" aria-hidden>
          {emoji}
        </div>
        <h1 className="font-display text-3xl font-black">{title}</h1>
        {message && <p className="text-lg text-mute">{message}</p>}
        {action}
        <Link href="/" className="text-cyan underline underline-offset-4">
          Back to {GAME_NAME}
        </Link>
      </main>
    </Stage>
  );
}

export function ConnectionBanner({ status }: { status: string }) {
  if (status !== "reconnecting") return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 top-0 z-50 bg-orange py-2 text-center font-bold text-stage"
    >
      Reconnecting… hang tight 📶
    </div>
  );
}

export function Toast({ message, tone = "info" }: { message: string | null; tone?: "info" | "error" }) {
  if (!message) return null;
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`animate-pop-in fixed inset-x-4 bottom-4 z-50 mx-auto max-w-md rounded-2xl px-4 py-3 text-center font-bold shadow-xl ${
        tone === "error" ? "bg-red text-stage" : "bg-yellow text-stage"
      }`}
    >
      {message}
    </div>
  );
}

/** Standard handling for the non-live room states. Returns null if live. */
export function RoomGate({
  status,
  errorMessage,
  hasView,
  role,
}: {
  status: string;
  errorMessage: string | null;
  hasView: boolean;
  role: "tv" | "host" | "player";
}) {
  if (status === "notFound")
    return (
      <StatusScreen
        emoji="🔍"
        title="Room not found"
        message={errorMessage ?? "Double-check the room code on the TV. Rooms are deleted 24 hours after a game ends."}
        action={
          <Link href="/join" className="font-bold text-yellow underline underline-offset-4">
            Enter a different code
          </Link>
        }
      />
    );
  if (status === "removed")
    return <StatusScreen emoji="🚪" title="You were removed" message="The host removed you from this game." />;
  if (status === "unauthorized" && role === "host")
    return (
      <StatusScreen
        emoji="🔐"
        title="Host link needed"
        message="Open the private host link you saved when you created this game (it ends with #k=…)."
      />
    );
  if (!hasView)
    return (
      <Stage>
        <main className="flex min-h-dvh flex-col items-center justify-center gap-4" aria-busy="true">
          <Logo size="lg" />
          <p className="text-mute" role="status">
            {status === "reconnecting" ? "Reconnecting…" : "Loading…"}
          </p>
        </main>
      </Stage>
    );
  return null;
}
