// Power-ups, Loser Picks, Double-Points Final, Sudden Death, Dare Wheel via the API.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as createRoomRoute } from "@/app/api/rooms/route";
import { GET as stateRoute } from "@/app/api/rooms/[code]/state/route";
import { POST as joinRoute } from "@/app/api/rooms/[code]/join/route";
import { POST as hostRoute } from "@/app/api/rooms/[code]/host/route";
import { POST as playRoute } from "@/app/api/rooms/[code]/play/route";
import { db } from "@/lib/server/db";
import { letterSet } from "@/lib/game/text";

let n = 0;
const ctx = (code: string) => ({ params: Promise.resolve({ code }) }) as never;
async function call(h: unknown, url: string, init: RequestInit & { code?: string } = {}) {
  const req = new Request(`http://test${url}`, {
    ...init,
    headers: { "x-forwarded-for": `10.7.${n % 200}.${++n % 250}`, "content-type": "application/json", ...(init.headers as Record<string, string>) },
  });
  const res = await (h as (r: Request, c: never) => Promise<Response>)(req, ctx(init.code ?? ""));
  return { status: res.status, body: await res.json() };
}
const newRoom = async () => (await call(createRoomRoute, "/api/rooms", { method: "POST" })).body as { code: string; hostToken: string };
const join = async (code: string, nickname: string) => (await call(joinRoute, `/j`, { method: "POST", code, body: JSON.stringify({ nickname }) })).body;
const host = (code: string, t: string, body: object) => call(hostRoute, `/h`, { method: "POST", code, body: JSON.stringify(body), headers: { "x-host-token": t } });
const play = (code: string, t: string, body: object) => call(playRoute, `/p`, { method: "POST", code, body: JSON.stringify(body), headers: { "x-player-token": t } });
const tv = async (code: string) => (await call(stateRoute, `/s?role=tv`, { code })).body;
const dbState = async (code: string) => (await db()`select state from rooms where code = ${code}`)[0].state;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function solve(code: string, token: string) {
  const answer = (await dbState(code)).round.answer as string;
  for (const l of letterSet(answer)) {
    const r = await play(code, token, { action: "guess", letter: l });
    if (r.status !== 200) break;
    if (r.body.view.my.state !== "playing") break;
  }
}
async function fail(code: string, token: string, count = 6) {
  const answer = (await dbState(code)).round.answer as string;
  const set = letterSet(answer);
  const wrong = "ZQXJKVWYFBGPMHUCDLRSNTOIAE".split("").filter((l) => !set.has(l)).slice(0, count);
  for (const l of wrong) await play(code, token, { action: "guess", letter: l });
}

beforeAll(async () => {
  await db()`delete from rate_limits`;
});
afterAll(async () => {
  await db().end();
  (globalThis as { __pqpSql?: unknown }).__pqpSql = undefined;
});

describe("power-ups via API", () => {
  it("freeze is enforced by the server and each player has 2 uses per game", async () => {
    const { code, hostToken } = await newRoom();
    const a = await join(code, "Ana");
    const b = await join(code, "Ben");
    await host(code, hostToken, { action: "start" });
    const fr = await play(code, a.token, { action: "powerup", type: "freeze", targetId: b.view.me.id });
    expect(fr.status).toBe(200);
    expect(fr.body.view.me.powerupsLeft).toBe(1);
    const blocked = await play(code, b.token, { action: "guess", letter: "E" });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe("frozen");
    const bView = (await call(stateRoute, `/s?role=player`, { code, headers: { "x-player-token": b.token } })).body;
    expect(bView.my.frozenUntil).toBeGreaterThan(bView.serverNow);
    // can't freeze the same player twice in a round
    expect((await play(code, a.token, { action: "powerup", type: "freeze", targetId: b.view.me.id })).body.error).toBe("already_frozen");
    const tvv = await tv(code);
    expect(tvv.rivals.find((r: { id: string }) => r.id === b.view.me.id).frozen).toBe(true);
    await play(code, a.token, { action: "powerup", type: "extraLife" });
    const third = await play(code, a.token, { action: "powerup", type: "reveal" });
    expect(third.body.error).toBe("no_powerups_left");
  });
});

describe("Loser Picks via API", () => {
  it("the lowest round scorer picks within 15s, others cannot", async () => {
    const { code, hostToken } = await newRoom();
    await host(code, hostToken, { action: "updateSettings", settings: { categories: ["food", "movies", "music"] } });
    const a = await join(code, "Ana");
    const b = await join(code, "Ben");
    await host(code, hostToken, { action: "start" });
    await solve(code, a.token);
    await fail(code, b.token);
    expect((await tv(code)).phase).toBe("reveal");
    await host(code, hostToken, { action: "next" });
    const v = await tv(code);
    expect(v.phase).toBe("loserPick");
    expect(v.loserPick.nickname).toBe("Ben");
    expect(v.loserPick.deadline - v.serverNow).toBeLessThanOrEqual(15_000);
    expect((await play(code, a.token, { action: "pickCategory", category: "music" })).status).toBe(403);
    await play(code, b.token, { action: "pickCategory", category: "music" });
    const r2 = await tv(code);
    expect(r2.phase).toBe("round");
    expect(r2.round.category).toBe("Music Artists");
  });
});

describe("Double-Points Final and Sudden Death via API", () => {
  it("announces and doubles the final round, then breaks a tie with sudden death", async () => {
    const { code, hostToken } = await newRoom();
    await host(code, hostToken, { action: "updateSettings", settings: { rounds: 5, categories: ["food"] } });
    const a = await join(code, "Ana");
    const b = await join(code, "Ben");
    await host(code, hostToken, { action: "start" });
    for (let i = 1; i < 5; i++) {
      await host(code, hostToken, { action: "skip" });
      await host(code, hostToken, { action: "next" });
    }
    const fin = await tv(code);
    expect(fin.round.kind).toBe("final");
    expect(fin.round.multiplier).toBe(2);
    const answer = (await dbState(code)).round.answer as string;
    const first = [...letterSet(answer)][0];
    const g = await play(code, a.token, { action: "guess", letter: first });
    expect(g.body.view.me.score).toBe(20);
    // Ben ties Ana exactly by guessing the same letter, then both run out the clock
    await play(code, b.token, { action: "guess", letter: first });
    await host(code, hostToken, { action: "skip" }); // skip wipes the final round points -> 0-0 tie
    await host(code, hostToken, { action: "next" });
    const sd = await tv(code);
    expect(sd.round.kind).toBe("suddenDeath");
    expect(sd.suddenDeath.names.sort()).toEqual(["Ana", "Ben"]);
    // one wrong guess eliminates Ben
    await fail(code, b.token, 1);
    const bv = (await call(stateRoute, `/s?role=player`, { code, headers: { "x-player-token": b.token } })).body;
    expect(bv.my.state).toBe("out");
    await solve(code, a.token);
    const done = await tv(code);
    expect(done.reveal.sdWinnerId).toBe(a.view.me.id);
    await host(code, hostToken, { action: "next" });
    const end = await tv(code);
    expect(end.phase).toBe("ended");
    expect(end.final.standings[0].nickname).toBe("Ana");
    expect(end.final.standings[0].rank).toBe(1);
    expect(end.final.standings[1].rank).toBe(2);
  });
});

describe("Dare Wheel via API", () => {
  it("last place spins; can pass; host can re-spin; auto-spins after 15s", async () => {
    const { code, hostToken } = await newRoom();
    await host(code, hostToken, { action: "updateSettings", settings: { dareWheel: true, dareEvery: 2, categories: ["food"], content: "clean" } });
    await host(code, hostToken, { action: "addDare", text: "Do your best robot dance" });
    const a = await join(code, "Ana");
    const b = await join(code, "Ben");
    await host(code, hostToken, { action: "start" });
    await solve(code, a.token);
    await fail(code, b.token);
    await host(code, hostToken, { action: "next" });
    await host(code, hostToken, { action: "skip" });
    await host(code, hostToken, { action: "next" });
    let v = await tv(code);
    expect(v.phase).toBe("dare");
    expect(v.dare.nickname).toBe("Ben");
    expect(v.dare.options.length).toBeGreaterThan(1);
    expect((await play(code, a.token, { action: "spinDare" })).status).toBe(403);
    await play(code, b.token, { action: "spinDare" });
    v = await tv(code);
    expect(v.dare.status).toBe("spun");
    const first = v.dare.resultIndex;
    await host(code, hostToken, { action: "respinDare" });
    v = await tv(code);
    expect(v.dare.resultIndex).not.toBe(first);
    await play(code, b.token, { action: "passDare" });
    expect((await tv(code)).dare.status).toBe("passed");
    await host(code, hostToken, { action: "next" });
    expect((await tv(code)).phase).toBe("round");
  });

  it("auto-spins when the player doesn't respond", async () => {
    const { code, hostToken } = await newRoom();
    await host(code, hostToken, { action: "updateSettings", settings: { dareWheel: true, dareEvery: 2, categories: ["food"] } });
    await join(code, "Ana");
    await host(code, hostToken, { action: "start" });
    for (let i = 0; i < 2; i++) {
      await host(code, hostToken, { action: "skip" });
      await host(code, hostToken, { action: "next" });
    }
    expect((await tv(code)).phase).toBe("dare");
    await db()`update rooms set state = jsonb_set(state, '{dare,autoSpinAt}', to_jsonb((extract(epoch from now()) * 1000)::bigint - 10)) where code = ${code}`;
    await sleep(5);
    expect((await tv(code)).dare.status).toBe("spun");
  });
});
