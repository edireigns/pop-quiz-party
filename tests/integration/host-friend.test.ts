// Host controls + friend-written words through the real API.
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
    headers: { "x-forwarded-for": `10.9.${n % 200}.${++n % 250}`, "content-type": "application/json", ...(init.headers as Record<string, string>) },
  });
  const res = await (h as (r: Request, c: never) => Promise<Response>)(req, ctx(init.code ?? ""));
  return { status: res.status, body: await res.json() };
}
const newRoom = async () => (await call(createRoomRoute, "/api/rooms", { method: "POST" })).body as { code: string; hostToken: string };
const join = (code: string, nickname: string) => call(joinRoute, `/j`, { method: "POST", code, body: JSON.stringify({ nickname }) });
const host = (code: string, t: string, body: object) => call(hostRoute, `/h`, { method: "POST", code, body: JSON.stringify(body), headers: { "x-host-token": t } });
const play = (code: string, t: string, body: object) => call(playRoute, `/p`, { method: "POST", code, body: JSON.stringify(body), headers: { "x-player-token": t } });
const state = (code: string, role: string, headers: Record<string, string> = {}) => call(stateRoute, `/s?role=${role}`, { code, headers });
const dbState = async (code: string) => (await db()`select state from rooms where code = ${code}`)[0].state;

beforeAll(async () => {
  await db()`delete from rate_limits`;
});
afterAll(async () => {
  await db().end();
  (globalThis as { __pqpSql?: unknown }).__pqpSql = undefined;
});

describe("host controls", () => {
  it("pause stops the timer on the server; resume continues it", async () => {
    const { code, hostToken } = await newRoom();
    await join(code, "Ana");
    await host(code, hostToken, { action: "start" });
    const p = await host(code, hostToken, { action: "pause" });
    expect(p.body.paused).toBe(true);
    const remaining = p.body.round.timer.remainingMs;
    // even after the original deadline passes, a paused round doesn't end
    await db()`update rooms set state = jsonb_set(state, '{round,deadline}', to_jsonb((extract(epoch from now()) * 1000)::bigint - 5000)) where code = ${code}`;
    const tv = await state(code, "tv");
    expect(tv.body.phase).toBe("round");
    expect(tv.body.round.timer.remainingMs).toBe(remaining);
    const r = await host(code, hostToken, { action: "resume" });
    expect(r.body.paused).toBe(false);
    expect(r.body.round.timer.deadline - r.body.serverNow).toBeGreaterThan(remaining - 2000);
  });

  it("remove player, skip, end and Play Again keep the same room and players", async () => {
    const { code, hostToken } = await newRoom();
    const a = await join(code, "Ana");
    const b = await join(code, "Ben");
    await host(code, hostToken, { action: "start" });
    const answer = (await dbState(code)).round.answer as string;
    const first = [...answer.toUpperCase()].find((c) => /[A-Z]/.test(c))!;
    await play(code, a.body.token, { action: "guess", letter: first });
    const removed = await host(code, hostToken, { action: "removePlayer", playerId: b.body.view.me.id });
    expect(removed.body.players.map((p: { nickname: string }) => p.nickname)).toEqual(["Ana"]);
    expect((await state(code, "player", { "x-player-token": b.body.token })).body.error).toBe("removed");
    await host(code, hostToken, { action: "end" });
    const ended = await state(code, "tv");
    expect(ended.body.phase).toBe("ended");
    expect(ended.body.final.standings[0].score).toBeGreaterThan(0);
    const again = await host(code, hostToken, { action: "playAgain" });
    expect(again.body.phase).toBe("lobby");
    expect(again.body.code).toBe(code);
    expect(again.body.players).toHaveLength(1);
    expect(again.body.leaderboard[0].score).toBe(0);
    // the same player token still works after Play Again
    expect((await state(code, "player", { "x-player-token": a.body.token })).status).toBe(200);
  });

  it("host can reconnect with the host link token at any time", async () => {
    const { code, hostToken } = await newRoom();
    await join(code, "Ana");
    await host(code, hostToken, { action: "start" });
    const back = await state(code, "host", { "x-host-token": hostToken });
    expect(back.body.phase).toBe("round");
  });
});

describe("friend-written words", () => {
  it("validates, lets the host remove, hides from TV, and rewards the author", async () => {
    const { code, hostToken } = await newRoom();
    await host(code, hostToken, { action: "updateSettings", settings: { friendWords: true, rounds: 5 } });
    const players = [await join(code, "Ana"), await join(code, "Ben"), await join(code, "Cy")];
    const [a, b] = players;
    expect((await play(code, a.body.token, { action: "submitWord", answer: "x" })).status).toBe(400);
    expect((await play(code, a.body.token, { action: "submitWord", answer: "Emoji 🎉" })).status).toBe(400);
    const r13 = (s: string) => s.replace(/[a-z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 97 + 13) % 26) + 97));
    expect((await play(code, a.body.token, { action: "submitWord", answer: r13("fuvg") + " show" })).status).toBe(400); // clean mode
    expect((await play(code, a.body.token, { action: "submitWord", answer: "Lisbon Ferry Fiasco", hint: "Summer trip" })).status).toBe(200);
    expect((await play(code, b.body.token, { action: "submitWord", answer: "Karaoke Kevin" })).status).toBe(200);
    const hv = await state(code, "host", { "x-host-token": hostToken });
    expect(hv.body.submissions).toHaveLength(2);
    const tvLobby = JSON.stringify((await state(code, "tv")).body);
    expect(tvLobby).not.toContain("Lisbon");
    expect(tvLobby).not.toContain("Karaoke Kevin");
    const benSub = hv.body.submissions.find((x: { nickname: string }) => x.nickname === "Ben");
    await host(code, hostToken, { action: "removeSubmission", id: benSub.id });
    await host(code, hostToken, { action: "start" });
    // advance rounds until the friend word comes up
    for (let i = 0; i < 6 && (await dbState(code)).round.source !== "friend"; i++) {
      await host(code, hostToken, { action: "skip" });
      await host(code, hostToken, { action: "next" });
      const st = await dbState(code);
      if (st.phase === "loserPick") await host(code, hostToken, { action: "next" });
    }
    const st = await dbState(code);
    expect(st.round.answer).toBe("Lisbon Ferry Fiasco");
    const authorView = (await state(code, "player", { "x-player-token": a.body.token })).body;
    expect(authorView.my.state).toBe("sittingOut");
    const tv = (await state(code, "tv")).body;
    expect(JSON.stringify(tv)).not.toContain("Lisbon");
    expect(tv.reveal).toBeNull();
    expect(tv.round.category).toBe("Friend-Written Word");
    // Ben and Cy both fail
    for (const p of players.slice(1)) {
      for (const l of "QZXJVW") await play(code, p.body.token, { action: "guess", letter: l });
    }
    const after = (await state(code, "tv")).body;
    expect(after.phase).toBe("reveal");
    expect(after.reveal.authorName).toBe("Ana");
    expect(after.reveal.authorBonus).toBe(30 * st.round.multiplier);
    // Ben's removed word never appears
    expect(JSON.stringify(after)).not.toContain("Karaoke Kevin");
  });
});
