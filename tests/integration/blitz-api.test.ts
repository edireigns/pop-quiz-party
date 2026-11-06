// Category Blitz through the real API routes and Postgres.
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
    headers: { "x-forwarded-for": `10.66.${n % 200}.${++n % 250}`, "content-type": "application/json", ...(init.headers as Record<string, string>) },
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
/** Expire the current stage's timer in the database (instead of waiting 30 s). */
const expire = async (code: string) => {
  await db()`update rooms set state = jsonb_set(state, '{round,deadline}', to_jsonb(${Date.now() - 1}::bigint)) where code = ${code}`;
};

beforeAll(async () => {
  await db()`delete from rate_limits`;
});
afterAll(async () => {
  await db().end();
  (globalThis as { __pqpSql?: unknown }).__pqpSql = undefined;
});

async function blitzRoom(players: number, settings: object = {}) {
  const room = await newRoom();
  const set = await host(room.code, room.hostToken, { action: "updateSettings", settings: { mode: "blitz", rounds: 5, ...settings } });
  expect(set.status).toBe(200);
  const ps: Joined[] = [];
  for (let i = 0; i < players; i++) ps.push(await join(room.code, `Z${i + 1}`));
  return { ...room, ps };
}

describe("Category Blitz API", () => {
  it("serves the prompt and timer; answers come back as Added only", async () => {
    bodies.length = 0;
    const { code, hostToken, ps } = await blitzRoom(3, { blitzSec: 45, blitzCategories: ["animals"] });
    const started = await host(code, hostToken, { action: "start" });
    expect(started.status).toBe(200);
    expect(started.body.round.mode).toBe("blitz");
    expect(started.body.round.blitz).toMatchObject({ stage: "play", category: "Animals" });
    expect(started.body.round.question).toBe(`Animals starting with ${started.body.round.blitz.letter}`);
    expect(started.body.round.timer.durationMs).toBe(45_000);
    const st = await dbState(code);
    const accepted: string[] = st.round.blitz.answers.flat();
    const res = await play(code, ps[0].token, { action: "blitzAnswer", text: accepted[0] });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(["added", "view"]);
    expect(res.body.view.my.blitz.answers).toEqual([accepted[0]]);
    await sleep(200);
    await play(code, ps[1].token, { action: "blitzAnswer", text: "Zzz not a real one" });
    expect((await play(code, ps[0].token, { action: "blitzAnswer", text: accepted[0].toUpperCase() })).body.error).toBe("duplicate");
    // TV: counts only, never text.
    const tv = (await state(code, "tv")).body;
    expect(tv.rivals.map((r: { count: number }) => r.count).sort()).toEqual([0, 1, 1]);
    await state(code, "host", { "x-host-token": hostToken });
    await me(code, ps[2]);
    // Before the reveal no response carries an accepted answer, except player 0 echoing what they typed.
    for (const b of bodies) {
      expect(b).not.toMatch(/"subs"|"answers":\[\[|"suggestions"/);
      for (const a of accepted.slice(1)) expect(b).not.toContain(`"${a}"`);
    }
  });

  it("rate-limits answer spam before the database", async () => {
    const { code, hostToken, ps } = await blitzRoom(1);
    await host(code, hostToken, { action: "start" });
    const statuses = [];
    for (let i = 0; i < 11; i++) statuses.push((await play(code, ps[0].token, { action: "blitzAnswer", text: "" })).status);
    expect(statuses.slice(0, 10).every((s) => s === 400)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it("host review: the most common unrecognized answers, approve/reject, then the reveal", async () => {
    const { code, hostToken, ps } = await blitzRoom(3, { blitzCategories: ["food"] });
    await host(code, hostToken, { action: "start" });
    const st = await dbState(code);
    const L: string = st.round.blitz.letter;
    const accepted: string[] = st.round.blitz.answers.map((g: string[]) => g[0]);
    await play(code, ps[0].token, { action: "blitzAnswer", text: accepted[0] });
    await play(code, ps[1].token, { action: "blitzAnswer", text: `${L}uperfood Zest` });
    await play(code, ps[2].token, { action: "blitzAnswer", text: `${L}uperfood zest!` });
    await expire(code);
    const hv = (await state(code, "host", { "x-host-token": hostToken })).body;
    expect(hv.round.blitz.stage).toBe("review");
    expect(hv.blitzReview).toEqual([{ id: expect.any(String), text: `${L}uperfood Zest`, count: 2, verdict: null }]);
    expect(JSON.stringify((await state(code, "tv")).body)).not.toContain("uperfood");
    expect((await host(code, hostToken, { action: "reviewAnswer", id: hv.blitzReview[0].id, verdict: "ok" })).status).toBe(200);
    const done = await host(code, hostToken, { action: "finishReview" });
    expect(done.body.phase).toBe("reveal");
    const scores = (await state(code, "tv")).body.reveal.blitz.players.map((p: { nickname: string; points: number }) => [p.nickname, p.points]);
    expect(scores).toEqual([
      ["Z1", 40],
      ["Z2", 10],
      ["Z3", 10],
    ]);
    const phone = (await me(code, ps[0])).body;
    expect(phone.my.blitz.result).toEqual({ valid: 1, unique: 1, points: 40 });
    const after = await dbState(code);
    expect(after.round.blitz.answers).toEqual([]);
    expect(after.round.blitz.subs).toEqual({});
  });

  it("custom prompts: validated, answers optional and never listed back", async () => {
    const { code, hostToken } = await blitzRoom(1);
    expect((await host(code, hostToken, { action: "addCustomBlitz", category: "Things in a fridge", letter: "MM" })).status).toBe(400);
    expect((await host(code, hostToken, { action: "addCustomBlitz", category: "Things in a fridge", letter: "M", answers: "Milk, Ketchup" })).body.message).toMatch(
      /doesn't start with M/,
    );
    const ok = await host(code, hostToken, { action: "addCustomBlitz", category: "Things in a fridge", letter: "m", answers: "Milk, Mayonnaise / Mayo, Mustard" });
    expect(ok.status).toBe(200);
    expect(ok.body.customBlitz).toEqual([{ id: expect.any(String), category: "Things in a fridge", letter: "M", answerCount: 3 }]);
    expect(JSON.stringify(ok.body)).not.toContain("Mayonnaise");
    expect(ok.body.settings.blitzCategories).toContain("hostPrompts");
    expect((await host(code, hostToken, { action: "addCustomBlitz", category: "Snacks", letter: "C" })).status).toBe(200);
    expect((await dbState(code)).customBlitz[1].answers).toEqual([]);
  });

  it("Get a Suggestion reaches only that player; refreshing restores everything", async () => {
    const { code, hostToken, ps } = await blitzRoom(2);
    await host(code, hostToken, { action: "start" });
    await play(code, ps[0].token, { action: "powerup", type: "reveal" });
    await sleep(200);
    await play(code, ps[0].token, { action: "powerup", type: "extraLife" });
    const st = await dbState(code);
    const tip: string = st.round.blitz.suggestions[ps[0].view.me.id];
    const v = (await me(code, ps[0])).body;
    expect(v.my.blitz.suggestion).toBe(tip);
    expect(v.my.blitz.timer.deadline).toBe(st.round.deadline + 5000);
    expect(v.round.question).toBe(st.round.question);
    expect(v.me.powerupsLeft).toBe(0);
    for (const other of [(await me(code, ps[1])).body, (await state(code, "tv")).body, (await state(code, "host", { "x-host-token": hostToken })).body])
      expect(JSON.stringify(other)).not.toContain(`"${tip}"`);
  });

  it("answers are deleted with the room under the existing cleanup rule", async () => {
    const { code, hostToken, ps } = await blitzRoom(1);
    await host(code, hostToken, { action: "start" });
    await play(code, ps[0].token, { action: "blitzAnswer", text: "Something" });
    await host(code, hostToken, { action: "end" });
    await db()`update rooms set ended_at = now() - interval '25 hours' where code = ${code}`;
    const cron = await call(cronRoute, "/api/cron/cleanup", { headers: { authorization: "Bearer test-cron-secret" } });
    expect(cron.status).toBe(200);
    expect(await dbState(code)).toBeUndefined();
  });
});
