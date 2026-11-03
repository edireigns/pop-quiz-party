"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { QrCode } from "@/components/QrCode";
import { Segmented, Toggle } from "@/components/Segmented";
import { useHost } from "@/components/host/useHost";
import { Button, ConnectionBanner, Logo, Panel, RoomGate, Stage, Toast } from "@/components/ui";
import { CATEGORY_EMOJI, CATEGORY_LABELS } from "@/data/categories";
import { siteUrl } from "@/lib/client/storage";
import type { CategoryId, Settings } from "@/lib/game/types";

const ALL_CATS: CategoryId[] = ["tv", "genz", "movies", "music", "memes", "food", "college", "mixed", "inside"];

function CopyField({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [show, setShow] = useState(!secret);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-bold text-mute">{label}</span>
      <div className="flex gap-2">
        <input
          readOnly
          aria-label={label}
          value={show ? value : "•".repeat(28)}
          className="min-h-12 min-w-0 flex-1 rounded-xl border-2 border-line bg-stage px-3 text-sm"
          onFocus={(e) => e.currentTarget.select()}
        />
        {secret && (
          <Button variant="ghost" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide link" : "Show link"}>
            {show ? "🙈" : "👁"}
          </Button>
        )}
        <Button
          variant="ghost"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {}
          }}
        >
          {copied ? "Copied!" : "Copy"}
        </Button>
      </div>
    </div>
  );
}

export default function HostPrep() {
  const { code } = useParams<{ code: string }>();
  const host = useHost(code);
  const { view, status, errorMessage, run, toast, token } = host;
  const [joke, setJoke] = useState({ answer: "", hint: "" });
  const [dare, setDare] = useState("");

  if (token === null)
    return <RoomGate status="unauthorized" errorMessage={null} hasView={false} role="host" />;
  const gate = <RoomGate status={status} errorMessage={errorMessage} hasView={!!view} role="host" />;
  if (!view || status === "notFound" || status === "unauthorized") return gate;

  const s = view.settings;
  const locked = view.phase !== "lobby";
  const base = siteUrl();
  const joinUrl = `${base}/play/${view.code}`;
  const tvUrl = `${base}/tv/${view.code}`;
  const hostUrl = `${base}/host/${view.code}#k=${token}`;
  const set = (patch: Partial<Settings>) => run({ action: "updateSettings", settings: patch });

  const toggleCat = (c: CategoryId) => {
    const has = s.categories.includes(c);
    const next = has ? s.categories.filter((x) => x !== c) : [...s.categories, c];
    if (next.length === 0) return;
    void set({ categories: next });
  };

  return (
    <Stage beams={false}>
      <ConnectionBanner status={status} />
      <main className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Logo size="sm" />
            <h1 className="font-display mt-1 text-2xl font-black">Host Prep</h1>
          </div>
          <div className="text-right">
            <div className="text-sm text-mute">Room code</div>
            <div className="font-display text-4xl font-black tracking-widest text-yellow" aria-label={`Room code ${view.code.split("").join(" ")}`}>
              {view.code}
            </div>
          </div>
        </header>

        {locked && (
          <p role="status" className="rounded-2xl bg-orange px-4 py-3 font-bold text-stage">
            The game is running — settings are locked. Use Host Controls to run it.
          </p>
        )}

        <Panel className="flex flex-col gap-4">
          <h2 className="font-display text-xl font-bold">1. Links</h2>
          <p className="text-sm text-mute">
            🔐 <strong className="text-ink">Bookmark your private host link.</strong> It&apos;s the only way back into this game
            as host — anyone with it can control the game.
          </p>
          <CopyField label="Private host link" value={hostUrl} secret />
          <CopyField label="TV display link (open on the laptop connected to the TV)" value={tvUrl} />
          <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-center">
            <CopyField label="Player join link" value={joinUrl} />
            <QrCode value={joinUrl} className="mx-auto w-36" label={`QR code to join room ${view.code}`} />
          </div>
        </Panel>

        <Panel className="flex flex-col gap-5">
          <h2 className="font-display text-xl font-bold">2. Game settings</h2>
          <Segmented
            label="Rounds"
            value={s.rounds}
            disabled={locked}
            options={[5, 10, 15, 20].map((n) => ({ value: n as Settings["rounds"], label: String(n) }))}
            onChange={(v) => set({ rounds: v })}
          />
          <Segmented
            label="Round timer"
            value={s.timerSec}
            disabled={locked}
            options={[45, 60, 90].map((n) => ({ value: n as Settings["timerSec"], label: `${n}s` }))}
            onChange={(v) => set({ timerSec: v })}
          />
          <fieldset disabled={locked}>
            <legend className="mb-2 font-bold">Categories</legend>
            <div className="flex flex-wrap gap-2">
              {ALL_CATS.filter((c) => c !== "inside" || view.insideJokeCount > 0).map((c) => {
                const on = s.categories.includes(c);
                return (
                  <button
                    key={c}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleCat(c)}
                    className={`min-h-12 rounded-xl border-2 px-3 font-bold transition ${
                      on ? "border-pink bg-pink text-stage" : "border-line bg-stage text-ink hover:border-violet"
                    }`}
                  >
                    <span aria-hidden>{CATEGORY_EMOJI[c]}</span> {CATEGORY_LABELS[c]}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <Segmented
            label="Difficulty"
            value={s.difficulty}
            disabled={locked}
            options={[
              { value: "easy", label: "Easy" },
              { value: "medium", label: "Medium" },
              { value: "hard", label: "Hard" },
              { value: "mixed", label: "Mixed" },
            ]}
            onChange={(v) => set({ difficulty: v })}
          />
          <Segmented
            label="Content level"
            value={s.content}
            disabled={locked}
            options={[
              { value: "clean", label: "Clean" },
              { value: "pg13", label: "PG-13" },
            ]}
            onChange={(v) => set({ content: v })}
          />
          <Toggle
            label="Friend-written words"
            description="Each player can submit one word in the lobby. Used for about a third of the rounds."
            checked={s.friendWords}
            disabled={locked}
            onChange={(v) => set({ friendWords: v })}
          />
          <Toggle
            label="Dare Wheel"
            description="The player in last place spins a (safe, optional) dare wheel."
            checked={s.dareWheel}
            disabled={locked}
            onChange={(v) => set({ dareWheel: v })}
          />
          {s.dareWheel && (
            <Segmented
              label="Dare Wheel appears every…"
              value={s.dareEvery}
              disabled={locked}
              options={[2, 3, 5].map((n) => ({ value: n as Settings["dareEvery"], label: `${n} rounds` }))}
              onChange={(v) => set({ dareEvery: v })}
            />
          )}
        </Panel>

        <Panel className="flex flex-col gap-3">
          <h2 className="font-display text-xl font-bold">
            3. <span aria-hidden>🤫</span> Inside Jokes <span className="text-base font-normal text-mute">(optional private category)</span>
          </h2>
          {view.insideJokes === null ? (
            <p className="text-mute">{view.insideJokeCount} inside jokes are locked in for this game.</p>
          ) : (
            <>
              <form
                className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (await run({ action: "addInsideJoke", answer: joke.answer, hint: joke.hint }, "Inside joke added"))
                    setJoke({ answer: "", hint: "" });
                }}
              >
                <label className="sr-only" htmlFor="ij-answer">
                  Inside joke word or phrase
                </label>
                <input
                  id="ij-answer"
                  value={joke.answer}
                  maxLength={40}
                  onChange={(e) => setJoke({ ...joke, answer: e.target.value })}
                  placeholder="Word or phrase"
                  className="min-h-12 rounded-xl border-2 border-line bg-stage px-3"
                />
                <label className="sr-only" htmlFor="ij-hint">
                  Hint (optional)
                </label>
                <input
                  id="ij-hint"
                  value={joke.hint}
                  maxLength={60}
                  onChange={(e) => setJoke({ ...joke, hint: e.target.value })}
                  placeholder="Hint (optional)"
                  className="min-h-12 rounded-xl border-2 border-line bg-stage px-3"
                />
                <Button type="submit" disabled={joke.answer.trim().length < 2}>
                  Add
                </Button>
              </form>
              {view.insideJokes.length > 0 && (
                <ul className="flex flex-col gap-2">
                  {view.insideJokes.map((j) => (
                    <li key={j.id} className="flex items-center justify-between gap-2 rounded-xl bg-stage px-3 py-2">
                      <span className="min-w-0 break-words">
                        <strong>{j.answer}</strong>
                        {j.hint && <span className="text-mute"> — {j.hint}</span>}
                      </span>
                      <Button variant="ghost" aria-label={`Remove ${j.answer}`} onClick={() => run({ action: "removeInsideJoke", id: j.id })}>
                        ✕
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </Panel>

        <Panel className="flex flex-col gap-3">
          <h2 className="font-display text-xl font-bold">
            4. <span aria-hidden>🎡</span> Custom dares <span className="text-base font-normal text-mute">(optional)</span>
          </h2>
          <p className="text-sm text-mute">
            Keep them safe, optional and kind — no alcohol, nothing risky or degrading. Players can always pass.
          </p>
          <form
            className="flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await run({ action: "addDare", text: dare }, "Dare added")) setDare("");
            }}
          >
            <label className="sr-only" htmlFor="dare">
              Custom dare
            </label>
            <input
              id="dare"
              value={dare}
              maxLength={100}
              onChange={(e) => setDare(e.target.value)}
              placeholder="e.g. Do your best robot dance"
              className="min-h-12 min-w-0 flex-1 rounded-xl border-2 border-line bg-stage px-3"
            />
            <Button type="submit" disabled={dare.trim().length < 4}>
              Add
            </Button>
          </form>
          {view.customDares.length > 0 && (
            <ul className="flex flex-col gap-2">
              {view.customDares.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-2 rounded-xl bg-stage px-3 py-2">
                  <span className="min-w-0 break-words">{d.text}</span>
                  <Button variant="ghost" aria-label={`Remove dare ${d.text}`} onClick={() => run({ action: "removeDare", id: d.id })}>
                    ✕
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {s.friendWords && !locked && (
          <Panel className="flex flex-col gap-3">
            <h2 className="font-display text-xl font-bold">
              5. <span aria-hidden>🤝</span> Friend-written words ({view.submissions.length})
            </h2>
            <p className="text-sm text-mute">Only you can see these. Remove anything you don&apos;t want played.</p>
            {view.submissions.length === 0 ? (
              <p className="text-mute">No submissions yet — players add them from their phones in the lobby.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {view.submissions.map((x) => (
                  <li key={x.id} className="flex items-center justify-between gap-2 rounded-xl bg-stage px-3 py-2">
                    <span className="min-w-0 break-words">
                      <strong>{x.answer}</strong>
                      {x.hint && <span className="text-mute"> — {x.hint}</span>}
                      <span className="block text-sm text-mute">by {x.nickname}</span>
                    </span>
                    <Button variant="ghost" aria-label={`Remove ${x.answer}`} onClick={() => run({ action: "removeSubmission", id: x.id })}>
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}

        <Panel className="flex flex-col gap-3">
          <h2 className="font-display text-xl font-bold">Players ({view.players.length})</h2>
          {view.players.length === 0 ? (
            <p className="text-mute">Nobody yet. Put the TV link on the big screen and have friends scan the QR code.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {view.players.map((p) => (
                <li key={p.id} className="flex items-center gap-1 rounded-full bg-stage py-1 pr-1 pl-3">
                  {p.nickname}
                  <button
                    className="min-h-10 min-w-10 rounded-full text-mute hover:text-red"
                    aria-label={`Remove ${p.nickname}`}
                    onClick={() => {
                      if (confirm(`Remove ${p.nickname} from the game?`)) void run({ action: "removePlayer", playerId: p.id });
                    }}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Link
          href={`/host/${view.code}#k=${token}`}
          className="font-display sticky bottom-4 inline-flex min-h-16 items-center justify-center rounded-2xl bg-lime px-5 text-xl font-black text-stage shadow-xl"
        >
          🎮 Open Host Controls
        </Link>
      </main>
      <Toast message={toast?.msg ?? null} tone={toast?.tone} />
    </Stage>
  );
}
