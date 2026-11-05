// Most Likely To through the real API routes and Postgres.
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
    headers: { "x-forwarded-for": `10.44.${n % 200}.${++n % 250}`, "content-type": "application/json", ...(init.headers as Record<string, string>) },
  });
  const res = await (h as (r: Request, c: never) => Promise<Response>)(req, ctx(init.code ?? ""));
  const text = await res.text();
  bodies.push(text);
  return { status: res.status, body: text ? JSON.parse(text) : {} };
}
const newRoom = async () => (await call(createRoomRoute, "/api/rooms", { method: "POST" })).body as { code: string; hostToken: string };
const join = async (code: string, nickname: string) => (await call(joinRoute, `/j`, { method: "POST", code, body: JSON.stringify({ nickname }) })).body;
const host = (code: string, t: string, body: object) => call(hostRoute, `/h`, { method: "POST", code, body: JSON.stringify(body), headers: { "x-host-token": t } });
const play = (code: string, t: string, body: object) => call(playRoute, `/p`, { method: "POST", code, body: JSON.stringify(body), headers: { "x-player-token": t } });
const state = (code: string, role: string, headers: Record<string, string> = {}) => call(stateRoute, `/s?role=${role}`, { code, headers });
const dbState = async (code: string) => (await db()`select state from rooms where code = ${code}`)[0]?.state;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  await db()`delete from rate_limits`;
});
afterAll(async () => {
  await db().end();
  (globalThis as { __pqpSql?: unknown }).__pqpSql = undefined;
});

async function mltRoom(players: number, settings: object = {}) {
  const room = await newRoom();
  const set = await host(room.code, room.hostToken, { action: "updateSettings", settings: { mode: "mlt", rounds: 5, ...settings } });
  expect(set.status).toBe(200);
  const ps = [];
  for (let i = 0; i < players; i++) ps.push(await join(room.code, `V${i + 1}`));
  return { ...room, ps };
}

describe("Most Likely To API", () => {
  it("needs 3 players to start, then serves the question and options", async () => {
    const { code, hostToken, ps } = await mltRoom(2, { voteSec: 15, packs: ["habits"] });
    const early = await host(code, hostToken, { action: "start" });
    expect(early.status).toBe(409);
    expect(early.body.message).toMatch(/at least 3 players/);
    ps.push(await join(code, "V3"));
    const started = await host(code, hostToken, { action: "start" });
    expect(started.status).toBe(200);
    expect(started.body.round.mode).toBe("mlt");
    expect(started.body.round.question).toMatch(/^Who is most likely to/);
    expect(started.body.round.timer.durationMs).toBe(15_000);
    expect(started.body.round.candidates.map((c: { nickname: string }) => c.nickname)).toEqual(["V1", "V2", "V3"]);
  });

  it("validates votes: one per round, real options only, removed players can't vote, rate-limited", async () => {
    const { code, hostToken, ps } = await mltRoom(4);
    await host(code, hostToken, { action: "start" });
    const [a, b, c, d] = ps;
    expect((await play(code, a.token, { action: "vote", targetId: "not-a-player" })).status).toBe(400);
    await sleep(320);
    const ok = await play(code, a.token, { action: "vote", targetId: b.view.me.id });
    expect(ok.status).toBe(200);
    expect(ok.body.locked).toBe(true);
    expect(ok.body.view.my.state).toBe("voted");
    await sleep(320);
    const again = await play(code, a.token, { action: "vote", targetId: c.view.me.id });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe("vote_locked");
    // rate limit: rejected attempts count too
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await play(code, c.token, { action: "vote", targetId: "nope" })).status);
    expect(statuses.slice(0, 3)).toEqual([400, 400, 400]);
    expect(statuses[3]).toBe(429);
    // removed players can't vote
    await host(code, hostToken, { action: "removePlayer", playerId: d.view.me.id });
    expect((await play(code, d.token, { action: "vote", targetId: a.view.me.id })).body.error).toBe("removed");
  });

  it("never sends who voted for whom, and wipes the votes once scored", async () => {
    bodies.length = 0;
    const { code, hostToken, ps } = await mltRoom(3);
    await host(code, hostToken, { action: "start" });
    const ids = ps.map((p) => p.view.me.id);
    await play(code, ps[0].token, { action: "vote", targetId: ids[1] });
    await play(code, ps[1].token, { action: "vote", targetId: ids[1] });
    await state(code, "tv");
    await state(code, "host", { "x-host-token": hostToken });
    for (const p of ps) await state(code, "player", { "x-player-token": p.token });
    await play(code, ps[2].token, { action: "vote", targetId: ids[0] }); // last vote ends the round
    const tv = (await state(code, "tv")).body;
    expect(tv.phase).toBe("reveal");
    expect(tv.reveal.totals.map((t: { nickname: string; votes: number }) => [t.nickname, t.votes])).toEqual([
      ["V3", 0],
      ["V1", 1],
      ["V2", 2],
    ]);
    expect(tv.reveal.crowned.map((c: { nickname: string }) => c.nickname)).toEqual(["V2"]);
    for (const p of ps) await state(code, "player", { "x-player-token": p.token });
    await state(code, "host", { "x-host-token": hostToken });
    for (const b of bodies) {
      expect(b).not.toContain("targetId");
      expect(b).not.toContain('"votes":{');
      expect(b).not.toMatch(/"(myVote|votedFor)":/);
    }
    const st = await dbState(code);
    expect(st.round.votes).toEqual({});
    // results: V1 and V2 read the room, V3 didn't
    const results = await Promise.all(ps.map(async (p) => (await state(code, "player", { "x-player-token": p.token })).body.my.voteResult));
    expect(results).toEqual(["correct", "correct", "wrong"]);
  });

  it("refreshing restores question, timer, vote status, power-ups and score", async () => {
    const { code, hostToken, ps } = await mltRoom(3);
    await host(code, hostToken, { action: "start" });
    const ids = ps.map((p) => p.view.me.id);
    await play(code, ps[0].token, { action: "powerup", type: "extraLife" }); // Double Vote
    await sleep(320);
    await play(code, ps[0].token, { action: "vote", targetId: ids[2] });
    await play(code, ps[1].token, { action: "powerup", type: "reveal" }); // Peek
    const st = await dbState(code);
    const me = (await state(code, "player", { "x-player-token": ps[0].token })).body;
    expect(me.round.question).toBe(st.round.question);
    expect(me.round.timer.deadline).toBe(st.round.deadline);
    expect(me.my.state).toBe("voted");
    expect(me.my.doubleVote).toBe(true);
    expect(me.me.powerupsLeft).toBe(1);
    const peeker = (await state(code, "player", { "x-player-token": ps[1].token })).body;
    expect(peeker.my.peek).toEqual({ names: ["V3"], votes: 2 });
    expect(peeker.my.state).toBe("playing");
    const tv = (await state(code, "tv")).body;
    expect(tv.round.question).toBe(st.round.question);
    expect(tv.round.answered).toEqual({ done: 1, total: 3 });
    const hv = (await state(code, "host", { "x-host-token": hostToken })).body;
    expect(hv.progress).toMatchObject({ total: 3 });
  });

  it("custom and friend-written questions are validated; authors stay anonymous", async () => {
    const { code, hostToken, ps } = await mltRoom(3, { friendWords: true });
    expect((await host(code, hostToken, { action: "addCustomQuestion", text: "nap" })).status).toBe(400);
    expect((await host(code, hostToken, { action: "addCustomQuestion", text: "x".repeat(121) })).status).toBe(400);
    const ok = await host(code, hostToken, { action: "addCustomQuestion", text: "adopt a goat named Kevin" });
    expect(ok.status).toBe(200);
    expect(ok.body.customQuestions[0].text).toBe("Who is most likely to adopt a goat named Kevin?");
    expect(ok.body.settings.packs).toContain("custom");
    const r13 = (s: string) => s.replace(/[a-z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 97 + 13) % 26) + 97));
    expect((await play(code, ps[0].token, { action: "submitQuestion", text: `yell ${r13("fuvg")} at a pigeon` })).status).toBe(400);
    const sub = await play(code, ps[0].token, { action: "submitQuestion", text: "Who would befriend a raccoon first?" });
    expect(sub.status).toBe(200);
    expect(sub.body.view.questionSub.text).toBe("Who would befriend a raccoon first?");
    const hv = (await state(code, "host", { "x-host-token": hostToken })).body;
    expect(hv.questionSubs).toEqual([{ id: expect.any(String), text: "Who would befriend a raccoon first?" }]);
    expect(JSON.stringify(hv.questionSubs)).not.toContain("V1"); // no author name, even for the host
    const tv = (await state(code, "tv")).body;
    expect(tv.lobby.questions).toBe(1);
    expect(JSON.stringify(tv)).not.toContain("raccoon");
    await host(code, hostToken, { action: "removeQuestionSub", id: hv.questionSubs[0].id });
    expect((await state(code, "host", { "x-host-token": hostToken })).body.questionSubs).toEqual([]);
  });

  it("a Most Likely To-only game holds with fewer than 3 players and tells the host", async () => {
    const { code, hostToken, ps } = await mltRoom(3);
    await host(code, hostToken, { action: "start" });
    await host(code, hostToken, { action: "skip" });
    await host(code, hostToken, { action: "removePlayer", playerId: ps[2].view.me.id });
    const held = await host(code, hostToken, { action: "next" });
    expect(held.body.hold).toBe("needPlayers");
    expect(held.body.phase).toBe("reveal");
    expect((await state(code, "tv")).body.hold).toBe("needPlayers");
    await join(code, "V4");
    const go = await host(code, hostToken, { action: "next" });
    expect(go.body.phase).toBe("round");
    expect(go.body.hold).toBeNull();
  });

  it("votes are deleted with the room under the existing cleanup rule", async () => {
    const { code, hostToken, ps } = await mltRoom(3);
    await host(code, hostToken, { action: "start" });
    await play(code, ps[0].token, { action: "vote", targetId: ps[1].view.me.id });
    await host(code, hostToken, { action: "end" });
    await db()`update rooms set ended_at = now() - interval '25 hours' where code = ${code}`;
    const cron = await call(cronRoute, "/api/cron/cleanup", { headers: { authorization: "Bearer test-cron-secret" } });
    expect(cron.status).toBe(200);
    expect(await dbState(code)).toBeUndefined();
  });
});
