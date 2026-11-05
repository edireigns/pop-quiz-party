// Who Wrote It? through the real API routes and Postgres.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as createRoomRoute } from "@/app/api/rooms/route";
import { GET as stateRoute } from "@/app/api/rooms/[code]/state/route";
import { POST as joinRoute } from "@/app/api/rooms/[code]/join/route";
import { POST as hostRoute } from "@/app/api/rooms/[code]/host/route";
import { POST as playRoute } from "@/app/api/rooms/[code]/play/route";
import { GET as cronRoute } from "@/app/api/cron/cleanup/route";
import { db } from "@/lib/server/db";

let n = 0;
const ctx = (code: string) => ({ params: Promise.resolve({ code }) }) as never;
const bodies: string[] = [];
async function call(h: unknown, url: string, init: RequestInit & { code?: string } = {}) {
  const req = new Request(`http://test${url}`, {
    ...init,
    headers: { "x-forwarded-for": `10.55.${n % 200}.${++n % 250}`, "content-type": "application/json", ...(init.headers as Record<string, string>) },
  });
  const res = await (h as (r: Request, c: never) => Promise<Response>)(req, ctx(init.code ?? ""));
  const text = await res.text();
  bodies.push(text);
  return { status: res.status, body: text ? JSON.parse(text) : {} };
}
type Joined = { token: string; view: { me: { id: string } } };
const newRoom = async () => (await call(createRoomRoute, "/api/rooms", { method: "POST" })).body as { code: string; hostToken: string };
const join = async (code: string, nickname: string) =>
  (await call(joinRoute, `/j`, { method: "POST", code, body: JSON.stringify({ nickname }) })).body as Joined;
const host = (code: string, t: string, body: object) => call(hostRoute, `/h`, { method: "POST", code, body: JSON.stringify(body), headers: { "x-host-token": t } });
const play = (code: string, t: string, body: object) => call(playRoute, `/p`, { method: "POST", code, body: JSON.stringify(body), headers: { "x-player-token": t } });
const state = (code: string, role: string, headers: Record<string, string> = {}) => call(stateRoute, `/s?role=${role}`, { code, headers });
const me = (code: string, p: Joined) => state(code, "player", { "x-player-token": p.token });
const dbState = async (code: string) => (await db()`select state from rooms where code = ${code}`)[0]?.state;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const r13 = (s: string) => s.replace(/[a-z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 97 + 13) % 26) + 97));

beforeAll(async () => {
  await db()`delete from rate_limits`;
});
afterAll(async () => {
  await db().end();
  (globalThis as { __pqpSql?: unknown }).__pqpSql = undefined;
});

async function wwiRoom(players: number, settings: object = {}) {
  const room = await newRoom();
  const set = await host(room.code, room.hostToken, { action: "updateSettings", settings: { mode: "wwi", rounds: 5, ...settings } });
  expect(set.status).toBe(200);
  const ps: Joined[] = [];
  for (let i = 0; i < players; i++) ps.push(await join(room.code, `W${i + 1}`));
  return { ...room, ps };
}

/** Everyone writes; the host skips the short review pause. Returns the answer on screen's author (from the DB). */
async function toGuessing(code: string, hostToken: string, ps: Joined[]) {
  for (const [i, p] of ps.entries()) expect((await play(code, p.token, { action: "writeAnswer", text: `Secret answer ${i + 1}` })).status).toBe(200);
  const go = await host(code, hostToken, { action: "next" });
  expect(go.body.round.wwi.stage).toBe("guessing");
  const st = await dbState(code);
  return st.round.wwi.current.authorId as string;
}

describe("Who Wrote It? API", () => {
  it("needs 4 players, then serves the question, writing timer and answer count", async () => {
    const { code, hostToken, ps } = await wwiRoom(3, { writeSec: 30, wwiPacks: ["habits"] });
    const early = await host(code, hostToken, { action: "start" });
    expect(early.status).toBe(409);
    expect(early.body.message).toMatch(/at least 4 players/);
    ps.push(await join(code, "W4"));
    const started = await host(code, hostToken, { action: "start" });
    expect(started.status).toBe(200);
    expect(started.body.round.mode).toBe("wwi");
    expect(started.body.round.question).toMatch(/\?$/);
    expect(started.body.round.timer.durationMs).toBe(30_000);
    expect(started.body.round.wwi).toMatchObject({ stage: "writing", submitted: 0, writers: 4 });
    await play(code, ps[0].token, { action: "writeAnswer", text: "Naps" });
    expect((await state(code, "tv")).body.round.wwi).toMatchObject({ submitted: 1, writers: 4 });
  });

  it("validates answers, locks them once written and never echoes them to anyone else", async () => {
    const { code, hostToken, ps } = await wwiRoom(4);
    await host(code, hostToken, { action: "start" });
    expect((await play(code, ps[0].token, { action: "writeAnswer", text: "x".repeat(81) })).status).toBe(400);
    expect((await play(code, ps[0].token, { action: "writeAnswer", text: `that is ${r13("fuvg")}` })).status).toBe(400);
    const ok = await play(code, ps[0].token, { action: "writeAnswer", text: "Pineapple pizza 🍍" });
    expect(ok.status).toBe(200);
    expect(ok.body.locked).toBe(true);
    expect(ok.body.view.my.wwi).toMatchObject({ submitted: true, myAnswer: "Pineapple pizza 🍍" });
    await sleep(300);
    const again = await play(code, ps[0].token, { action: "writeAnswer", text: "Changed" });
    expect(again.status).toBe(429); // route limit: 3 attempts per 3s, rejected ones count too
    await sleep(3_100);
    expect((await play(code, ps[0].token, { action: "writeAnswer", text: "Changed" })).body.error).toBe("answer_locked");
    for (const v of [(await state(code, "tv")).body, (await me(code, ps[1])).body, (await state(code, "host", { "x-host-token": hostToken })).body])
      expect(JSON.stringify(v)).not.toContain("Pineapple");
  });

  it("plays an answer: the author sits out, guesses stay secret, then the TV reveals the author and totals", async () => {
    bodies.length = 0;
    const { code, hostToken, ps } = await wwiRoom(5, { answersShown: 1 });
    await host(code, hostToken, { action: "start" });
    const authorId = await toGuessing(code, hostToken, ps);
    const author = ps.find((p) => p.view.me.id === authorId)!;
    const guessers = ps.filter((p) => p !== author);
    const authorView = (await me(code, author)).body;
    expect(authorView.my.wwi).toMatchObject({ isAuthor: true, choices: [] });
    expect((await play(code, author.token, { action: "wwiGuess", targetId: guessers[0].view.me.id })).body.error).toBe("sitting_out");
    const picks: string[] = [];
    for (const [i, g] of guessers.entries()) {
      const v = (await me(code, g)).body;
      expect(v.my.wwi.choices).toHaveLength(4);
      expect(v.round.wwi.answer).toBe(`Secret answer ${ps.indexOf(author) + 1}`);
      const choiceIds = v.my.wwi.choices.map((c: { id: string }) => c.id);
      const pick = i < 2 ? authorId : choiceIds.find((id: string) => id !== authorId);
      picks.push(pick);
      if (i === guessers.length - 1) {
        // Before the last guess: nothing anywhere says who wrote it or who picked whom.
        await state(code, "tv");
        await state(code, "host", { "x-host-token": hostToken });
        for (const b of bodies) expect(b).not.toMatch(/"authorId"|"orders"|"guesses"|"eliminated":\[|"result":"(correct|wrong)"/);
      }
      await sleep(260);
      const res = await play(code, g.token, { action: "wwiGuess", targetId: pick });
      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual(["locked", "view"]); // never whether it was right
    }
    const tv = (await state(code, "tv")).body;
    expect(tv.round.wwi.stage).toBe("answerReveal");
    expect(tv.round.wwi.revealed).toMatchObject({ authorId, authorName: `W${ps.indexOf(author) + 1}`, correct: 2, wrong: 2, guessers: 4 });
    expect(tv.leaderboard.find((e: { id: string }) => e.id === authorId).score).toBe(30);
    const results = await Promise.all(guessers.map(async (g) => (await me(code, g)).body.my.wwi.result));
    expect(results).toEqual(["correct", "correct", "wrong", "wrong"]);
    expect((await me(code, author)).body.my.wwi).toMatchObject({ result: "author", fooled: 2 });
    const st = await dbState(code);
    expect(st.round.wwi.current).toBeNull(); // who guessed whom is gone
    // Next → round leaderboard; unshown answers are dropped.
    const done = await host(code, hostToken, { action: "next" });
    expect(done.body.phase).toBe("reveal");
    expect(done.body.reveal.wwi.answers).toHaveLength(1);
    const after = await dbState(code);
    expect(after.round.wwi.answers).toEqual({});
    const allText = JSON.stringify(after);
    for (let i = 1; i <= 5; i++) if (i !== ps.indexOf(author) + 1) expect(allText).not.toContain(`Secret answer ${i}`);
  });

  it("the host sees selected answers (no authors), can remove one before it appears, and skip the one on screen", async () => {
    const { code, hostToken, ps } = await wwiRoom(5, { answersShown: 3 });
    await host(code, hostToken, { action: "start" });
    for (const [i, p] of ps.entries()) await play(code, p.token, { action: "writeAnswer", text: `Answer ${i + 1}` });
    const hv = (await state(code, "host", { "x-host-token": hostToken })).body;
    expect(hv.round.wwi.stage).toBe("review");
    expect(hv.wwiUpcoming).toHaveLength(3);
    expect(JSON.stringify(hv.wwiUpcoming)).not.toMatch(/W\d|authorId|playerId/);
    const gone = hv.wwiUpcoming[0];
    const rm = await host(code, hostToken, { action: "removeAnswer", answerId: gone.id });
    expect(rm.status).toBe(200);
    expect(rm.body.wwiUpcoming).toHaveLength(3);
    expect(rm.body.wwiUpcoming.map((a: { id: string }) => a.id)).not.toContain(gone.id);
    const go = await host(code, hostToken, { action: "next" });
    const onScreen = go.body.wwiCurrent;
    expect(onScreen.text).not.toBe(gone.text);
    const skipped = await host(code, hostToken, { action: "skipAnswer" });
    expect(skipped.status).toBe(200);
    expect(skipped.body.wwiCurrent.id).not.toBe(onScreen.id);
    expect(skipped.body.round.wwi).toMatchObject({ stage: "guessing", index: 1, total: 3 });
    expect(JSON.stringify((await state(code, "tv")).body)).not.toContain(gone.text);
    expect((await host(code, hostToken, { action: "removeAnswer", answerId: "nope" })).status).toBe(404);
  });

  it("rate-limits guess spam before the database", async () => {
    const { code, hostToken, ps } = await wwiRoom(4);
    await host(code, hostToken, { action: "start" });
    const authorId = await toGuessing(code, hostToken, ps);
    const g = ps.find((p) => p.view.me.id !== authorId)!;
    await sleep(300);
    const statuses = [];
    for (let i = 0; i < 5; i++) statuses.push((await play(code, g.token, { action: "wwiGuess", targetId: "nope" })).status);
    expect(statuses.slice(0, 4)).toEqual([400, 400, 400, 400]);
    expect(statuses[4]).toBe(429);
  });

  it("refreshing restores stage, question, answer, timer, status, choices, power-ups and score", async () => {
    const { code, hostToken, ps } = await wwiRoom(4);
    await host(code, hostToken, { action: "start" });
    const authorId = await toGuessing(code, hostToken, ps);
    const g = ps.find((p) => p.view.me.id !== authorId)!;
    await play(code, g.token, { action: "powerup", type: "extraLife" }); // Double Guess
    const st = await dbState(code);
    const v = (await me(code, g)).body;
    expect(v.round.question).toBe(st.round.question);
    expect(v.round.timer.deadline).toBe(st.round.deadline);
    expect(v.round.wwi).toMatchObject({ stage: "guessing", answer: st.round.wwi.current.text, index: 1 });
    expect(v.my.wwi).toMatchObject({ submitted: true, doubleGuess: true, pickLimit: 2, picks: [] });
    expect(v.my.wwi.choices).toHaveLength(3);
    expect(v.me).toMatchObject({ powerupsLeft: 1, score: 0 });
  });

  it("custom and friend-written questions are validated; authors stay anonymous; the lobby shows the game length", async () => {
    const { code, hostToken, ps } = await wwiRoom(4, { friendWords: true });
    expect((await host(code, hostToken, { action: "addCustomPrompt", text: "Why?" })).status).toBe(400);
    expect((await host(code, hostToken, { action: "addCustomPrompt", text: "x".repeat(121) })).status).toBe(400);
    const ok = await host(code, hostToken, { action: "addCustomPrompt", text: "what would our group mascot be" });
    expect(ok.status).toBe(200);
    expect(ok.body.customPrompts[0].text).toBe("What would our group mascot be?");
    expect(ok.body.settings.wwiPacks).toContain("custom");
    expect(ok.body.estimateMin).toBeGreaterThan(5);
    expect((await play(code, ps[0].token, { action: "submitPrompt", text: `What is the ${r13("fuvg")}iest snack?` })).status).toBe(400);
    const sub = await play(code, ps[0].token, { action: "submitPrompt", text: "What would you bring to a desert island?" });
    expect(sub.status).toBe(200);
    expect(sub.body.view.promptSub.text).toBe("What would you bring to a desert island?");
    const hv = (await state(code, "host", { "x-host-token": hostToken })).body;
    expect(hv.promptSubs).toEqual([{ id: expect.any(String), text: "What would you bring to a desert island?" }]);
    expect(JSON.stringify(hv.promptSubs)).not.toContain("W1");
    const tv = (await state(code, "tv")).body;
    expect(tv.lobby.prompts).toBe(1);
    expect(tv.lobby.estimateMin).toBe(hv.estimateMin);
    expect(JSON.stringify(tv)).not.toContain("desert island");
    await host(code, hostToken, { action: "removePromptSub", id: hv.promptSubs[0].id });
    expect((await state(code, "host", { "x-host-token": hostToken })).body.promptSubs).toEqual([]);
  });

  it("a Who Wrote It?-only game holds with fewer than 4 players and tells the host", async () => {
    const { code, hostToken, ps } = await wwiRoom(4);
    await host(code, hostToken, { action: "start" });
    await host(code, hostToken, { action: "skip" });
    await host(code, hostToken, { action: "removePlayer", playerId: ps[3].view.me.id });
    const held = await host(code, hostToken, { action: "next" });
    expect(held.body).toMatchObject({ hold: "needPlayers", holdMin: 4, phase: "reveal" });
    expect((await state(code, "tv")).body.holdMin).toBe(4);
    await join(code, "W5");
    const go = await host(code, hostToken, { action: "next" });
    expect(go.body.phase).toBe("round");
    expect(go.body.hold).toBeNull();
  });

  it("answers and guesses are deleted with the room under the existing cleanup rule", async () => {
    const { code, hostToken, ps } = await wwiRoom(4);
    await host(code, hostToken, { action: "start" });
    await toGuessing(code, hostToken, ps);
    await host(code, hostToken, { action: "end" });
    await db()`update rooms set ended_at = now() - interval '25 hours' where code = ${code}`;
    const cron = await call(cronRoute, "/api/cron/cleanup", { headers: { authorization: "Bearer test-cron-secret" } });
    expect(cron.status).toBe(200);
    expect(await dbState(code)).toBeUndefined();
  });
});
