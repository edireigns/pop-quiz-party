// Emoji Decode through the real API routes and Postgres.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as createRoomRoute } from "@/app/api/rooms/route";
import { GET as stateRoute } from "@/app/api/rooms/[code]/state/route";
import { POST as joinRoute } from "@/app/api/rooms/[code]/join/route";
import { POST as hostRoute } from "@/app/api/rooms/[code]/host/route";
import { POST as playRoute } from "@/app/api/rooms/[code]/play/route";
import { db } from "@/lib/server/db";

let n = 0;
const ctx = (code: string) => ({ params: Promise.resolve({ code }) }) as never;
async function call(h: unknown, url: string, init: RequestInit & { code?: string } = {}) {
  const req = new Request(`http://test${url}`, {
    ...init,
    headers: { "x-forwarded-for": `10.33.${n % 200}.${++n % 250}`, "content-type": "application/json", ...(init.headers as Record<string, string>) },
  });
  const res = await (h as (r: Request, c: never) => Promise<Response>)(req, ctx(init.code ?? ""));
  return { status: res.status, body: await res.json() };
}
const newRoom = async () => (await call(createRoomRoute, "/api/rooms", { method: "POST" })).body as { code: string; hostToken: string };
const join = async (code: string, nickname: string) => (await call(joinRoute, `/j`, { method: "POST", code, body: JSON.stringify({ nickname }) })).body;
const host = (code: string, t: string, body: object) => call(hostRoute, `/h`, { method: "POST", code, body: JSON.stringify(body), headers: { "x-host-token": t } });
const play = (code: string, t: string, body: object) => call(playRoute, `/p`, { method: "POST", code, body: JSON.stringify(body), headers: { "x-player-token": t } });
const state = (code: string, role: string, headers: Record<string, string> = {}) => call(stateRoute, `/s?role=${role}`, { code, headers });
const dbState = async (code: string) => (await db()`select state from rooms where code = ${code}`)[0].state;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  await db()`delete from rate_limits`;
});
afterAll(async () => {
  await db().end();
  (globalThis as { __pqpSql?: unknown }).__pqpSql = undefined;
});

async function emojiRoom(players = 2, settings: object = {}) {
  const room = await newRoom();
  const set = await host(room.code, room.hostToken, { action: "updateSettings", settings: { mode: "emoji", rounds: 5, ...settings } });
  expect(set.status).toBe(200);
  expect(set.body.settings.mode).toBe("emoji");
  const ps = [];
  for (let i = 0; i < players; i++) ps.push(await join(room.code, `P${i + 1}`));
  return { ...room, ps };
}

describe("Emoji Decode API", () => {
  it("rejects an unknown game mode", async () => {
    const { code, hostToken } = await newRoom();
    const r = await host(code, hostToken, { action: "updateSettings", settings: { mode: "quiz" } });
    expect(r.status).toBe(400);
  });

  it("never sends the answer or alternates before the round ends", async () => {
    const { code, hostToken, ps } = await emojiRoom(2);
    await host(code, hostToken, { action: "start" });
    const st = await dbState(code);
    expect(st.round.mode).toBe("emoji");
    const secrets = [st.round.answer, ...st.round.alternates].filter((x: string) => x.length >= 3);
    const wrong = await play(code, ps[0].token, { action: "answer", answer: "zzzz not it" });
    expect(wrong.body).toMatchObject({ correct: false, attemptsLeft: 2 });
    const right = await play(code, ps[1].token, { action: "answer", answer: st.round.answer.toLowerCase() });
    expect(right.body.correct).toBe(true);
    const bodies = [
      JSON.stringify(wrong.body),
      JSON.stringify(right.body),
      JSON.stringify((await state(code, "tv")).body),
      JSON.stringify((await state(code, "host", { "x-host-token": hostToken })).body),
      JSON.stringify((await state(code, "player", { "x-player-token": ps[0].token })).body),
      JSON.stringify((await state(code, "player", { "x-player-token": ps[1].token })).body),
    ];
    for (const b of bodies) {
      expect(b).not.toContain('"answer"');
      expect(b).not.toContain('"alternates"');
      for (const sec of secrets) expect(b).not.toContain(`"${sec}"`);
      expect(b).toContain(st.round.clue); // the clue is public
    }
    // TV shows attempts left, never the guess
    const tv = (await state(code, "tv")).body;
    expect(JSON.stringify(tv)).not.toContain("zzzz not it");
    expect(tv.rivals.find((r: { nickname: string }) => r.nickname === "P1").lives).toBe(2);
    expect(tv.round.answered).toEqual({ done: 1, total: 2 });
  });

  it("host Drop Hint is host-only, max 2, and penalises later answers", async () => {
    const { code, hostToken, ps } = await emojiRoom(2);
    await host(code, hostToken, { action: "start" });
    expect((await host(code, "nope", { action: "dropHint" })).status).toBe(403);
    expect((await play(code, ps[0].token, { action: "dropHint" })).status).toBe(400);
    const h1 = await host(code, hostToken, { action: "dropHint" });
    expect(h1.body.round.hostHints).toHaveLength(1);
    await host(code, hostToken, { action: "dropHint" });
    expect((await host(code, hostToken, { action: "dropHint" })).status).toBe(409);
    const answer = (await dbState(code)).round.answer;
    const r = await play(code, ps[0].token, { action: "answer", answer });
    expect(r.body.view.me.score).toBeLessThanOrEqual(150); // 200 max − 2 × 25
    expect(r.body.view.me.score).toBeGreaterThanOrEqual(100);
  });

  it("rate-limits answer submissions", async () => {
    const { code, hostToken, ps } = await emojiRoom(1);
    await host(code, hostToken, { action: "start" });
    const a = await play(code, ps[0].token, { action: "answer", answer: "first try" });
    const b = await play(code, ps[0].token, { action: "answer", answer: "second try" });
    expect(a.status).toBe(200);
    expect(b.status).toBe(429);
  });

  it("refreshing restores mode, clue, attempts, hints and score", async () => {
    const { code, hostToken, ps } = await emojiRoom(2);
    await host(code, hostToken, { action: "start" });
    await play(code, ps[0].token, { action: "answer", answer: "definitely wrong guess" });
    await host(code, hostToken, { action: "dropHint" });
    const st = await dbState(code);
    await sleep(450);
    await play(code, ps[1].token, { action: "answer", answer: st.round.answer });
    const me = (await state(code, "player", { "x-player-token": ps[0].token })).body;
    expect(me.round.mode).toBe("emoji");
    expect(me.round.clue).toBe(st.round.clue);
    expect(me.round.hostHints).toHaveLength(1);
    expect(me.my.lives).toBe(2);
    expect(me.my.wrong).toEqual(["definitely wrong guess"]);
    const other = (await state(code, "player", { "x-player-token": ps[1].token })).body;
    expect(other.my.state).toBe("solved");
    expect(other.me.score).toBeGreaterThan(0);
    const tv = (await state(code, "tv")).body;
    expect(tv.round.clue).toBe(st.round.clue);
    expect(tv.leaderboard.find((e: { nickname: string }) => e.nickname === "P2").score).toBe(other.me.score);
  });

  it("validates Inside Jokes clues and friend-written clues", async () => {
    const { code, hostToken, ps } = await emojiRoom(2, { friendWords: true });
    expect((await host(code, hostToken, { action: "addInsideClue", clue: "taco 🌮", answer: "Taco Night" })).status).toBe(400);
    expect((await host(code, hostToken, { action: "addInsideClue", clue: "🌮🌙", answer: "x" })).status).toBe(400);
    const ok = await host(code, hostToken, { action: "addInsideClue", clue: "🌮🌙", answer: "Taco Night", alternates: "Taco evening, Tacos" });
    expect(ok.status).toBe(200);
    expect(ok.body.insideClues[0]).toMatchObject({ clue: "🌮🌙", answer: "Taco Night", alternates: ["Taco evening", "Tacos"] });
    expect(ok.body.settings.categories).toContain("inside");
    // friends must add a clue in Emoji Decode, and it must be emojis only
    expect((await play(code, ps[0].token, { action: "submitWord", answer: "Lisbon Ferry" })).body.message).toMatch(/emoji clue/);
    expect((await play(code, ps[0].token, { action: "submitWord", answer: "Lisbon Ferry", clue: "boat ⛴️" })).status).toBe(400);
    const sub = await play(code, ps[0].token, { action: "submitWord", answer: "Lisbon Ferry", clue: "⛴️ 🇵🇹 🤢" });
    expect(sub.status).toBe(200);
    expect(sub.body.view.submission.clue).toBe("⛴️ 🇵🇹 🤢");
    const tvLobby = JSON.stringify((await state(code, "tv")).body);
    expect(tvLobby).not.toContain("Lisbon");
    expect(tvLobby).not.toContain("⛴️ 🇵🇹 🤢");
    expect(tvLobby).not.toContain("Taco Night");
    expect((await state(code, "host", { "x-host-token": hostToken })).body.submissions[0].clue).toBe("⛴️ 🇵🇹 🤢");
  });

  it("the host can switch the mode after a game ends, then Play Again", async () => {
    const { code, hostToken } = await emojiRoom(1);
    await host(code, hostToken, { action: "start" });
    expect((await host(code, hostToken, { action: "updateSettings", settings: { mode: "mixed" } })).status).toBe(409);
    await host(code, hostToken, { action: "end" });
    const changed = await host(code, hostToken, { action: "updateSettings", settings: { mode: "mixed" } });
    expect(changed.body.settings.mode).toBe("mixed");
    await host(code, hostToken, { action: "playAgain" });
    const started = await host(code, hostToken, { action: "start" });
    expect(started.body.round.mode).toBe("hangman");
    expect(started.body.mode).toBe("mixed");
  });

  it("rooms saved before Emoji Decode existed still load and play Hangman", async () => {
    const { code, hostToken } = await newRoom();
    const p = await join(code, "Old");
    await host(code, hostToken, { action: "start" });
    // Make the stored row look like it was written by the previous version.
    await db()`
      update rooms set state = (state #- '{settings,mode}' #- '{round,mode}' #- '{round,clue}' #- '{round,alternates}' #- '{round,hostHints}')
        - 'insideClues' - 'usedClues' - 'startedSettings'
      where code = ${code}`;
    const raw = await dbState(code);
    expect(raw.settings.mode).toBeUndefined();
    const tv = await state(code, "tv");
    expect(tv.status).toBe(200);
    expect(tv.body.mode).toBe("hangman");
    expect(tv.body.round.mode).toBe("hangman");
    const answer: string = raw.round.answer;
    const letter = [...answer.toUpperCase()].find((c) => /[A-Z]/.test(c))!;
    const g = await play(code, p.token, { action: "guess", letter });
    expect(g.status).toBe(200);
    expect(g.body.correct).toBe(true);
    const saved = await dbState(code);
    expect(saved.settings.mode).toBe("hangman");
    expect(saved.round.mode).toBe("hangman");
  });
});
