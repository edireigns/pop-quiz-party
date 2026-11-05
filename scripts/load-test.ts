/*
 * Load test: simulates GAMES concurrent games, each with PLAYERS phones,
 * a TV and a host, playing a full game against a running server.
 * All traffic comes from one IP, like a party on shared Wi-Fi.
 *
 *   BASE_URL=http://localhost:3000 DATABASE_URL=postgres://... npm run load-test
 *
 * Env: GAMES (2), PLAYERS (15), ROUNDS (5|10|15|20, default 5),
 *      MODE (hangman | emoji | mlt | mixed, default mixed),
 *      MIXED (modes Mixed rotates through, default "hangman,emoji,mlt").
 * With DATABASE_URL set, "skilled" bots peek at the current Emoji Decode answer
 * (a test oracle) so correct, typo'd and wrong answers are all exercised.
 * At the end it checks that scores match on the server (DB), every phone,
 * the TV and the host view, and that games never see each other's players.
 */
import postgres from "postgres";
import { loadEnv } from "./env";

loadEnv();

const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const GAMES = Number(process.env.GAMES ?? 2);
const PLAYERS = Number(process.env.PLAYERS ?? 15);
const ROUNDS = Number(process.env.ROUNDS ?? 5);
const MODE = (process.env.MODE ?? "mixed") as "hangman" | "emoji" | "mlt" | "mixed";
const MIXED = (process.env.MIXED ?? "hangman,emoji,mlt").split(",").map((m) => m.trim()) as ("hangman" | "emoji" | "mlt")[];
const mltStats = { votes: 0, rounds: new Set<string>(), leaks: 0 };
const oracleDb = process.env.DATABASE_URL ? postgres(process.env.DATABASE_URL, { prepare: false, max: 2, onnotice: () => {} }) : null;
const oracleCache = new Map<string, string | null>();
/** Test oracle: the current round's answer straight from the DB (never from the API). */
async function oracle(code: string, key: string): Promise<string | null> {
  if (!oracleDb) return null;
  const k = `${code}:${key}`;
  if (!oracleCache.has(k)) {
    const [row] = await oracleDb`select state->'round'->>'answer' as a from rooms where code = ${code}`;
    oracleCache.set(k, row?.a ?? null);
  }
  return oracleCache.get(k)!;
}
const emojiStats = { answers: 0, correct: 0, rounds: new Set<string>() };
const FREQ = "ETAOINSHRDLCUMWFGYPBVKJXQZ".split("");
const EMOJIS = ["😂", "🔥", "😱", "👏", "💀", "🎉", "😭", "🤯"];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];

const stats = { requests: 0, errors5xx: 0, unexpected4xx: 0, rateLimited: 0, lat: [] as number[], byStatus: new Map<number, number>(), limitedBy: new Map<string, number>() };
const EXPECTED_CONFLICTS = new Set(["vote_locked", "too_late", "already_double", "wrong_mode", "no_more_hints", "wrong_phase", "finished", "frozen", "already_guessed", "not_playing", "sitting_out", "paused", "already_frozen", "bad_target", "no_powerups_left", "already_spun", "not_picker", "not_spinner", "round_running", "nothing_to_reveal", "no_hints", "no_powerups", "max_lives"]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function req(path: string, opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<{ status: number; body: any }> {
  const t0 = performance.now();
  const res = await fetch(BASE + path, {
    method: opts.method ?? (opts.body ? "POST" : "GET"),
    headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.7", ...opts.headers },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  // Vote privacy: no response may ever carry an individual vote.
  if (text.includes("targetId") || text.includes('"votes":{')) mltStats.leaks++;
  let body: any = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    body = text ? JSON.parse(text) : {};
  } catch {}
  stats.lat.push(performance.now() - t0);
  stats.requests++;
  stats.byStatus.set(res.status, (stats.byStatus.get(res.status) ?? 0) + 1);
  if (res.status >= 500) stats.errors5xx++;
  else if (res.status === 429) {
    stats.rateLimited++;
    const k = `${path.replace(/[A-Z]{5}/, ":code").split("?")[0]} ${(opts.body as { action?: string })?.action ?? ""}`.trim();
    stats.limitedBy.set(k, (stats.limitedBy.get(k) ?? 0) + 1);
  }
  else if (res.status >= 400 && !EXPECTED_CONFLICTS.has(body.error)) {
    stats.unexpected4xx++;
    if (stats.unexpected4xx < 10) console.warn("unexpected", res.status, path, body);
  }
  return { status: res.status, body };
}

interface Bot {
  name: string;
  token: string;
  id: string;
  skill: number;
  usedPowerups: number;
}

async function runGame(g: number) {
  const { body: room } = await req("/api/rooms", { method: "POST" });
  const code: string = room.code;
  const H = { "x-host-token": room.hostToken };
  await req(`/api/rooms/${code}/host`, {
    body: { action: "updateSettings", settings: { mode: MODE, mixedModes: MIXED, voteSec: 20, rounds: ROUNDS, timerSec: 45, dareWheel: true, dareEvery: 2, friendWords: true, categories: ["movies", "food", "tv", "mixed"] } },
    headers: H,
  });
  const bots: Bot[] = [];
  for (let i = 0; i < PLAYERS; i++) {
    const name = `G${g}P${i + 1}`;
    const { status, body } = await req(`/api/rooms/${code}/join`, { body: { nickname: name } });
    if (status !== 201) throw new Error(`join failed ${status} ${JSON.stringify(body)}`);
    bots.push({ name, token: body.token, id: body.view.me.id, skill: rand(0.4, 1), usedPowerups: 0 });
  }
  for (const b of bots.slice(0, 3)) {
    const i = bots.indexOf(b);
    await req(`/api/rooms/${code}/play`, {
      body: { action: "submitWord", answer: `Load Test Phrase ${b.name.replace(/\d/g, "")} ${"ABC"[i]}`, hint: "", clue: ["🧪📦🚚", "🧪🎲🚀", "🧪🌮🎈"][i] },
      headers: { "x-player-token": b.token },
    });
  }
  let over = false;

  // TV: polls like the real display
  const tv = (async () => {
    while (!over) {
      await req(`/api/rooms/${code}/state?role=tv`);
      await sleep(1000);
    }
  })();

  // Phones
  const phones = bots.map(async (b) => {
    const H = { "x-player-token": b.token };
    let tried = new Set<string>();
    let roundKey = "";
    while (!over) {
      const { body: v } = await req(`/api/rooms/${code}/state?role=player`, { headers: H });
      if (!v.phase) {
        await sleep(1000);
        continue;
      }
      if (v.phase === "ended") break;
      if (v.phase === "round" && v.my?.state === "playing" && !v.paused && v.round.mode === "mlt") {
        // Most Likely To: maybe use a power-up, then vote (most of the room agrees on someone).
        const key = `${v.round.number}-${v.round.sdAttempt}`;
        mltStats.rounds.add(`${code}:${key}`);
        if (key !== roundKey) {
          roundKey = key;
          if (b.usedPowerups < 2 && Math.random() < 0.25 && v.round.kind !== "suddenDeath") {
            b.usedPowerups++;
            const type = pick(["freeze", "reveal", "extraLife"]);
            await req(`/api/rooms/${code}/play`, { body: { action: "powerup", type, targetId: v.my.freezeTargets[0]?.id }, headers: H });
          }
        }
        await sleep(rand(500, 4000));
        const cands = v.round.candidates as { id: string }[];
        if (cands.length) {
          const target = Math.random() < 0.6 ? cands[0] : pick(cands);
          const { status } = await req(`/api/rooms/${code}/play`, { body: { action: "vote", targetId: target.id }, headers: H });
          if (status === 200) mltStats.votes++;
        }
        await sleep(rand(400, 800));
        continue;
      }
      if (v.phase === "round" && v.my?.state === "playing" && !v.paused && v.round.mode === "emoji") {
        // Emoji Decode: think for a bit, then type an answer (correct, typo'd or wrong).
        const key = `${v.round.number}-${v.round.sdAttempt}`;
        emojiStats.rounds.add(`${code}:${key}`);
        if (key !== roundKey) {
          roundKey = key;
          if (b.usedPowerups < 2 && Math.random() < 0.25 && v.round.kind !== "suddenDeath") {
            b.usedPowerups++;
            const type = pick(["freeze", "reveal", "extraLife"]);
            await req(`/api/rooms/${code}/play`, { body: { action: "powerup", type, targetId: v.my.freezeTargets[0]?.id }, headers: H });
          }
        }
        await sleep(rand(800, 3500));
        const answer = await oracle(code, key);
        let text = `not it ${Math.random().toString(36).slice(2, 7)}`;
        if (answer && Math.random() < b.skill * 0.75) {
          text = answer.toLowerCase();
          if (text.replace(/[^a-z]/g, "").length > 4 && Math.random() < 0.3) text = text.slice(0, -1); // one typo
        }
        const { status, body } = await req(`/api/rooms/${code}/play`, { body: { action: "answer", answer: text }, headers: H });
        emojiStats.answers++;
        if (status === 200 && body.correct) emojiStats.correct++;
        await sleep(rand(450, 900));
        continue;
      }
      if (v.phase === "round" && v.my?.state === "playing" && !v.paused) {
        const key = `${v.round.number}-${v.round.sdAttempt}`;
        if (key !== roundKey) {
          roundKey = key;
          tried = new Set(v.my.guessed);
          if (Math.random() < 0.15) await req(`/api/rooms/${code}/play`, { body: { action: "hint" }, headers: H });
          if (b.usedPowerups < 2 && Math.random() < 0.3 && v.round.kind !== "suddenDeath") {
            b.usedPowerups++;
            const type = pick(["freeze", "reveal", "extraLife"]);
            const target = v.my.freezeTargets[0]?.id;
            await req(`/api/rooms/${code}/play`, { body: { action: "powerup", type, targetId: target }, headers: H });
          }
        }
        // play a burst of guesses at human speed
        for (let i = 0; i < 4; i++) {
          const pool = FREQ.filter((l) => !tried.has(l));
          if (!pool.length) break;
          const l = Math.random() < b.skill ? pool[0] : pick(pool);
          tried.add(l);
          const { status, body } = await req(`/api/rooms/${code}/play`, { body: { action: "guess", letter: l }, headers: H });
          if (status !== 200 || body.view?.my?.state !== "playing") break;
          await sleep(rand(150, 600));
        }
        await sleep(rand(250, 500)); // like a real phone: don't hammer while frozen/paused
        continue;
      }
      if (v.phase === "loserPick" && v.loserPick?.playerId === b.id) {
        await sleep(rand(500, 2000));
        await req(`/api/rooms/${code}/play`, { body: { action: "pickCategory", category: pick(v.loserPick.options as { id: string }[]).id }, headers: H });
      } else if (v.phase === "dare" && v.dare?.playerId === b.id && v.dare.status === "waiting") {
        await sleep(rand(300, 1200));
        await req(`/api/rooms/${code}/play`, { body: { action: "spinDare" }, headers: H });
        if (Math.random() < 0.5) await req(`/api/rooms/${code}/play`, { body: { action: "passDare" }, headers: H });
      } else if (Math.random() < 0.2) {
        await req(`/api/rooms/${code}/play`, { body: { action: "react", emoji: pick(EMOJIS) }, headers: H });
      }
      await sleep(rand(600, 1400));
    }
  });

  // Host
  await req(`/api/rooms/${code}/host`, { body: { action: "start" }, headers: H });
  const hostLoop = (async () => {
    const t0 = Date.now();
    while (Date.now() - t0 < 20 * 60_000) {
      const { body: v } = await req(`/api/rooms/${code}/state?role=host`, { headers: H });
      if (v.phase === "ended") break;
      if (v.phase === "round" && v.round?.mode === "emoji" && v.round.hostHints.length < 2 && Date.now() % 7 === 0) {
        await req(`/api/rooms/${code}/host`, { body: { action: "dropHint" }, headers: H });
      }
      if (v.phase === "reveal") {
        await sleep(800);
        await req(`/api/rooms/${code}/host`, { body: { action: "next" }, headers: H });
      } else if (v.phase === "dare" && v.dare?.status !== "waiting") {
        await sleep(800);
        await req(`/api/rooms/${code}/host`, { body: { action: "next" }, headers: H });
      }
      await sleep(500);
    }
    over = true;
  })();
  await hostLoop;
  await Promise.all([tv, ...phones]);

  // ---------------- consistency checks ----------------
  const problems: string[] = [];
  const { body: tvv } = await req(`/api/rooms/${code}/state?role=tv`);
  const { body: hv } = await req(`/api/rooms/${code}/state?role=host`, { headers: H });
  if (tvv.phase !== "ended") problems.push(`game ${code} did not end (phase ${tvv.phase})`);
  const tvScores = new Map<string, number>(tvv.leaderboard.map((e: { id: string; score: number }) => [e.id, e.score]));
  const hostScores = new Map<string, number>(hv.leaderboard.map((e: { id: string; score: number }) => [e.id, e.score]));
  const phoneScores = new Map<string, number>();
  for (const b of bots) {
    const { body } = await req(`/api/rooms/${code}/state?role=player`, { headers: { "x-player-token": b.token } });
    phoneScores.set(b.id, body.me.score);
  }
  let dbScores = new Map<string, number>();
  if (process.env.DATABASE_URL) {
    const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
    const [row] = await sql`select state from rooms where code = ${code}`;
    await sql.end();
    const st = row.state;
    dbScores = new Map(st.players.map((p: { id: string; score: number }) => [p.id, p.score]));
    // every point is accounted for in round history
    for (const p of st.players) {
      const sum = st.history.reduce((acc: number, h: { results: Record<string, { points: number }> }) => acc + (h.results[p.id]?.points ?? 0), 0);
      if (sum !== p.score) problems.push(`${p.nickname}: history sums to ${sum} but score is ${p.score}`);
      if (p.score < 0) problems.push(`${p.nickname} has a negative score`);
    }
  }
  for (const b of bots) {
    const s = [phoneScores.get(b.id), tvScores.get(b.id), hostScores.get(b.id), dbScores.size ? dbScores.get(b.id) : phoneScores.get(b.id)];
    if (new Set(s).size !== 1) problems.push(`${b.name} score mismatch phone/tv/host/db = ${s.join("/")}`);
  }
  const foreign = tvv.leaderboard.filter((e: { nickname: string }) => !e.nickname.startsWith(`G${g}P`));
  if (foreign.length) problems.push(`game ${code} sees players from another game: ${foreign.map((e: { nickname: string }) => e.nickname)}`);
  let modes = "";
  if (oracleDb) modes = ((await oracleDb`select state->'history' as h from rooms where code = ${code}`)[0]?.h ?? []).map((h: { mode: string }) => (h.mode === "emoji" ? "E" : h.mode === "mlt" ? "M" : "H")).join("");
  if (MODE === "mixed" && oracleDb) {
    const letter = { hangman: "H", emoji: "E", mlt: "M" } as const;
    const expected = Array.from({ length: modes.length }, (_, i) => letter[MIXED[i % MIXED.length]]).join("");
    if (modes !== expected) problems.push(`mixed rounds should be ${expected} but were ${modes}`);
  }
  return { code, problems, rounds: tvv.roundsPlayed, modes, winner: tvv.final?.standings?.[0], awards: tvv.final?.awards?.length ?? 0 };
}

async function main() {
  console.log(`Load test: ${GAMES} games × ${PLAYERS} players × ${ROUNDS} rounds, mode ${MODE}, against ${BASE}`);
  const t0 = Date.now();
  const results = await Promise.all(Array.from({ length: GAMES }, (_, i) => runGame(i + 1)));
  const lat = [...stats.lat].sort((a, b) => a - b);
  const q = (p: number) => lat[Math.min(lat.length - 1, Math.floor(lat.length * p))]?.toFixed(0);
  console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${stats.requests} requests`);
  console.log(`Latency ms: p50 ${q(0.5)} · p95 ${q(0.95)} · p99 ${q(0.99)} · max ${lat.at(-1)?.toFixed(0)}`);
  console.log(`Status counts: ${[...stats.byStatus].map(([k, v]) => `${k}:${v}`).join(" ")}`);
  if (stats.limitedBy.size) console.log(`429s by endpoint (expected anti-spam): ${[...stats.limitedBy].map(([k, v]) => `${k}=${v}`).join(", ")}`);
  console.log(`5xx: ${stats.errors5xx} · unexpected 4xx: ${stats.unexpected4xx} · 429: ${stats.rateLimited}`);
  if (emojiStats.answers) console.log(`Emoji Decode: ${emojiStats.rounds.size} rounds · ${emojiStats.answers} answers · ${emojiStats.correct} correct`);
  if (mltStats.votes) console.log(`Most Likely To: ${mltStats.rounds.size} rounds · ${mltStats.votes} votes · responses carrying individual votes: ${mltStats.leaks}`);
  if (mltStats.leaks) console.log("  ✗ vote privacy: some responses contained individual votes");
  let failed = stats.errors5xx > 0 || stats.unexpected4xx > 0 || mltStats.leaks > 0;
  await oracleDb?.end();
  for (const r of results) {
    console.log(`Game ${r.code}: ${r.rounds} rounds${r.modes ? ` (${r.modes})` : ""} · winner ${r.winner?.nickname} (${r.winner?.score}) · ${r.awards} awards · ${r.problems.length ? "PROBLEMS" : "scores match on server, phones, TV and host ✓"}`);
    for (const p of r.problems) console.log("  ✗ " + p);
    if (r.problems.length) failed = true;
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
