// Exercises the real route handlers against Postgres (TEST_DATABASE_URL).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as createRoomRoute } from "@/app/api/rooms/route";
import { GET as stateRoute } from "@/app/api/rooms/[code]/state/route";
import { POST as joinRoute } from "@/app/api/rooms/[code]/join/route";
import { POST as hostRoute } from "@/app/api/rooms/[code]/host/route";
import { POST as playRoute } from "@/app/api/rooms/[code]/play/route";
import { GET as cronRoute } from "@/app/api/cron/cleanup/route";
import { db } from "@/lib/server/db";
import { letterSet } from "@/lib/game/text";

let ipCounter = 0;
const ip = () => `10.0.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;
const ctx = (code: string) => ({ params: Promise.resolve({ code }) }) as never;

async function call(handler: (req: Request, c: never) => Promise<Response>, url: string, init: RequestInit & { code?: string } = {}) {
  const req = new Request(`http://test${url}`, {
    ...init,
    headers: { "x-forwarded-for": ip(), "content-type": "application/json", ...(init.headers as Record<string, string>) },
  });
  const res = await handler(req, ctx(init.code ?? ""));
  return { status: res.status, body: await res.json(), raw: res };
}

async function newRoom() {
  const r = await call(createRoomRoute as never, "/api/rooms", { method: "POST" });
  expect(r.status).toBe(201);
  return r.body as { code: string; hostToken: string };
}
async function join(code: string, nickname: string, token?: string) {
  return call(joinRoute as never, `/api/rooms/${code}/join`, {
    method: "POST",
    code,
    body: JSON.stringify({ nickname }),
    headers: token ? { "x-player-token": token } : {},
  });
}
async function host(code: string, token: string, body: object) {
  return call(hostRoute as never, `/api/rooms/${code}/host`, { method: "POST", code, body: JSON.stringify(body), headers: { "x-host-token": token } });
}
async function play(code: string, token: string, body: object) {
  return call(playRoute as never, `/api/rooms/${code}/play`, { method: "POST", code, body: JSON.stringify(body), headers: { "x-player-token": token } });
}
async function state(code: string, role: string, headers: Record<string, string> = {}) {
  return call(stateRoute as never, `/api/rooms/${code}/state?role=${role}`, { code, headers });
}
async function secretAnswer(code: string): Promise<string> {
  const [row] = await db()`select state->'round'->>'answer' as a from rooms where code = ${code}`;
  return row.a;
}

beforeAll(async () => {
  await db()`delete from rooms`;
  await db()`delete from rate_limits`;
});
afterAll(async () => {
  await db().end();
  (globalThis as { __pqpSql?: unknown }).__pqpSql = undefined;
});

describe("rooms API", () => {
  it("creates rooms with a secret host token that guards host actions", async () => {
    const { code, hostToken } = await newRoom();
    expect(code).toMatch(/^[A-Z]{5}$/);
    expect((await state(code, "host", { "x-host-token": "nope" })).status).toBe(403);
    expect((await state(code, "host")).status).toBe(403);
    expect((await host(code, "wrong-token", { action: "start" })).status).toBe(403);
    const ok = await state(code, "host", { "x-host-token": hostToken });
    expect(ok.status).toBe(200);
    expect(ok.body.role).toBe("host");
    // host token hash never leaks
    expect(JSON.stringify(ok.body)).not.toMatch(/tokenHash|host_token/);
  });

  it("returns a clear 404 for invalid room codes", async () => {
    expect((await state("ZZZZZ", "tv")).status).toBe(404);
    expect((await state("bad!", "tv")).body.error).toBe("room_not_found");
  });

  it("joins, blocks duplicate/offensive nicknames, and reconnects with the same token", async () => {
    const { code } = await newRoom();
    const a = await join(code, "Alex");
    expect(a.status).toBe(201);
    expect((await join(code, "alex")).status).toBe(409);
    expect((await join(code, "x")).status).toBe(400);
    const again = await join(code, "Ignored Name", a.body.token);
    expect(again.status).toBe(200);
    expect(again.body.view.me.id).toBe(a.body.view.me.id);
    const me = await state(code, "player", { "x-player-token": a.body.token });
    expect(me.body.me.nickname).toBe("Alex");
    expect((await state(code, "player", { "x-player-token": "forged" })).status).toBe(401);
  });

  it("keeps two games fully separate", async () => {
    const r1 = await newRoom();
    const r2 = await newRoom();
    const p1 = await join(r1.code, "Sam");
    await join(r2.code, "Sam"); // same nickname is fine in another room
    const tv2 = await state(r2.code, "tv");
    expect(tv2.body.lobby.players).toHaveLength(1);
    // a player token from room 1 is useless in room 2
    expect((await play(r2.code, p1.body.token, { action: "react", emoji: "🔥" })).status).toBe(401);
    // host token from room 1 can't control room 2
    expect((await host(r2.code, r1.hostToken, { action: "start" })).status).toBe(403);
    await host(r1.code, r1.hostToken, { action: "start" });
    expect((await state(r2.code, "tv")).body.phase).toBe("lobby");
    expect((await state(r1.code, "tv")).body.phase).toBe("round");
  });

  it("never sends the answer before the round ends, and restores progress on refresh", async () => {
    const { code, hostToken } = await newRoom();
    const a = await join(code, "Ana");
    const b = await join(code, "Ben");
    await host(code, hostToken, { action: "start" });
    const answer = await secretAnswer(code);
    const letters = [...letterSet(answer)];
    const g = await play(code, a.body.token, { action: "guess", letter: letters[0].toLowerCase() });
    expect(g.status).toBe(200);
    expect(g.body.correct).toBe(true);
    const responses = [
      JSON.stringify(g.body),
      JSON.stringify((await state(code, "tv")).body),
      JSON.stringify((await state(code, "host", { "x-host-token": hostToken })).body),
      JSON.stringify((await state(code, "player", { "x-player-token": a.body.token })).body),
      JSON.stringify((await state(code, "player", { "x-player-token": b.body.token })).body),
    ];
    for (const r of responses) {
      expect(r).not.toContain(answer);
      expect(r).not.toContain('"answer"');
    }
    // "refresh": a fresh state fetch shows the same earned progress
    const refreshed = (await state(code, "player", { "x-player-token": a.body.token })).body;
    expect(refreshed.my.guessed).toEqual([letters[0]]);
    expect(refreshed.me.score).toBe(10);
    // finish the round, then the answer is revealed
    await host(code, hostToken, { action: "skip" });
    const tv = await state(code, "tv");
    expect(tv.body.reveal.answer).toBe(answer);
  });

  it("server timer ends the round even if nobody acts (lazy tick on read)", async () => {
    const { code, hostToken } = await newRoom();
    await join(code, "Solo");
    await host(code, hostToken, { action: "start" });
    await db()`update rooms set state = jsonb_set(state, '{round,deadline}', to_jsonb((extract(epoch from now()) * 1000)::bigint - 1000)) where code = ${code}`;
    const tv = await state(code, "tv");
    expect(tv.body.phase).toBe("reveal");
  });

  it("rejects joins after the game has ended and hides rooms 24h after ending", async () => {
    const { code, hostToken } = await newRoom();
    await join(code, "Pat");
    await host(code, hostToken, { action: "end" });
    expect((await join(code, "Late")).status).toBe(410);
    expect((await state(code, "tv")).body.phase).toBe("ended");
    await db()`update rooms set ended_at = now() - interval '25 hours' where code = ${code}`;
    expect((await state(code, "tv")).status).toBe(404);
    const unauth = await call(cronRoute as never, "/api/cron/cleanup");
    expect(unauth.status).toBe(401);
    const cron = await call(cronRoute as never, "/api/cron/cleanup", { headers: { authorization: "Bearer test-cron-secret" } });
    expect(cron.status).toBe(200);
    expect(cron.body.deleted).toBeGreaterThanOrEqual(1);
    const [row] = await db()`select count(*)::int as n from rooms where code = ${code}`;
    expect(row.n).toBe(0);
  });

  it("rate-limits rapid joins from one IP", async () => {
    const { code } = await newRoom();
    const fixedIp = { "x-forwarded-for": "203.0.113.9" };
    let limited = false;
    for (let i = 0; i < 45; i++) {
      const r = await call(joinRoute as never, `/api/rooms/${code}/join`, {
        method: "POST",
        code,
        body: JSON.stringify({ nickname: `Bot${i}` }),
        headers: fixedIp,
      });
      if (r.status === 429) limited = true;
    }
    expect(limited).toBe(true);
  });
});
