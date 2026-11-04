import { expect, test, type Page } from "@playwright/test";
import { dbState, lettersOf, newPhone, recordApi, sql, waitForDb, wrongLetters } from "./helpers";

test.afterAll(async () => {
  await sql.end();
});

/** Make a guess and wait until the server has recorded it. */
async function guessAndWait(code: string, page: Page, playerId: string, letter: string, how: "click" | "key") {
  const s = await dbState(code);
  const pr = s.round?.progress?.[playerId];
  if (!pr || pr.status !== "playing" || s.phase !== "round") return false;
  const before = pr.guessed.length;
  await expect(page.getByRole("group", { name: "Letter keyboard" })).toBeVisible();
  await expect(page.getByRole("button", { name: letter, exact: true })).toBeEnabled();
  if (how === "key") await page.bringToFront();
  if (how === "click") await page.getByRole("button", { name: letter, exact: true }).click();
  else await page.keyboard.press(letter.toLowerCase());
  await waitForDb(code, (x) => x.phase !== "round" || x.round.progress[playerId]?.guessed.length > before || x.round.progress[playerId]?.status !== "playing");
  return true;
}

async function solve(code: string, page: Page, playerId: string, how: "click" | "key") {
  const answer = (await dbState(code)).round.answer;
  for (const l of lettersOf(answer)) {
    const s = await dbState(code);
    if (s.phase !== "round" || s.round.progress[playerId]?.status !== "playing") break;
    if (s.round.progress[playerId].guessed.includes(l) || s.round.progress[playerId].revealed.includes(l)) continue;
    await guessAndWait(code, page, playerId, l, how);
  }
}

async function fail(code: string, page: Page, playerId: string, how: "click" | "key") {
  const answer = (await dbState(code)).round.answer;
  for (const l of wrongLetters(answer)) {
    const s = await dbState(code);
    if (s.phase !== "round" || s.round.progress[playerId]?.status !== "playing") break;
    await guessAndWait(code, page, playerId, l, how);
  }
}

test("full game: host, TV and 3 players with built-in words only", async ({ browser }) => {
  const sink: { url: string; body: string }[] = [];

  // ---------------- Host Prep ----------------
  const host = await (await browser.newContext({ viewport: { width: 400, height: 860 } })).newPage();
  host.on("dialog", (d) => d.accept());
  recordApi(host, sink);
  await host.goto("/");
  await host.getByRole("button", { name: /Host a new game/ }).click();
  await host.waitForURL(/\/host\/[A-Z]{5}\/prep#k=/);
  const code = host.url().match(/host\/([A-Z]{5})/)![1];
  await host.getByRole("radio", { name: "5", exact: true }).click();
  await expect(host.getByRole("radio", { name: "5", exact: true })).toHaveAttribute("aria-checked", "true");
  await host.getByRole("radio", { name: "45s" }).click();
  await expect(host.getByRole("radio", { name: "45s" })).toHaveAttribute("aria-checked", "true");
  for (const cat of ["TV Shows", "Gen Z Phrases", "Music Artists", "Memes & Internet Culture", "College Life", "Mixed"]) {
    const b = host.getByRole("button", { name: cat, exact: true });
    await b.click();
    await expect(b).toHaveAttribute("aria-pressed", "false");
  }
  await host.getByRole("switch", { name: /Dare Wheel/ }).click();
  await host.getByRole("radio", { name: "2 rounds" }).click();
  await expect(host.getByRole("radio", { name: "2 rounds" })).toHaveAttribute("aria-checked", "true");
  const prepState = await dbState(code);
  expect(prepState.settings).toMatchObject({ rounds: 5, timerSec: 45, friendWords: false, dareWheel: true, dareEvery: 2 });
  expect(prepState.settings.categories.sort()).toEqual(["food", "movies"]);

  // ---------------- TV ----------------
  const tv = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  recordApi(tv, sink);
  await tv.goto(`/tv/${code}`);
  await tv.getByRole("button", { name: /Start TV/ }).click();
  await expect(tv.getByRole("img", { name: /QR code to join/ })).toBeVisible();
  await expect(tv.getByText(code).first()).toBeVisible();

  // ---------------- Players join ----------------
  const names = ["Ana", "Ben", "Cleo"];
  const phones: Record<string, Page> = {};
  for (const n of names) {
    const p = await newPhone(browser);
    recordApi(p, sink);
    await p.goto(`/play/${code}`);
    await p.getByLabel("Your nickname").fill(n);
    await p.getByRole("button", { name: /Join the party/ }).click();
    await expect(p.getByText(/You're in/)).toBeVisible();
    phones[n] = p;
  }
  await expect(tv.getByText("3 players ready")).toBeVisible();
  for (const n of names) await expect(tv.getByText(n, { exact: true })).toBeVisible();

  // ---------------- Host Controls ----------------
  await host.getByRole("link", { name: /Open Host Controls/ }).click();
  await host.getByRole("button", { name: /Start game/ }).click();

  const idOf = async (nick: string) => (await dbState(code)).players.find((p: { nickname: string }) => p.nickname === nick).id as string;
  const pageOf = async (id: string) => {
    const s = await dbState(code);
    return phones[s.players.find((p: { id: string }) => p.id === id).nickname];
  };

  let mainRounds = 0;
  const seen = { loserPick: false, dare: false, final: false, refresh: false, solved: false, out: false };
  for (let step = 0; step < 60; step++) {
    const s = await waitForDb(code, (x) => ["round", "reveal", "loserPick", "dare", "ended"].includes(x.phase));
    if (s.phase === "ended") break;

    if (s.phase === "round") {
      const r = s.round;
      const parts: string[] = r.participants;
      await expect(tv.getByRole("img", { name: /Puzzle:/ })).toBeVisible();
      if (r.kind === "suddenDeath") {
        await solve(code, await pageOf(parts[0]), parts[0], "click");
        await waitForDb(code, (x) => x.phase !== "round");
        continue;
      }
      mainRounds++;
      if (r.kind === "final") {
        seen.final = true;
        await expect(tv.getByText("FINAL ROUND").first()).toBeVisible();
      }
      const [p0, p1, p2] = await Promise.all(parts.map(pageOf));

      if (mainRounds === 2 && !seen.refresh) {
        // Refresh player, TV and host mid-round: everything is restored from the server.
        seen.refresh = true;
        const first = lettersOf(r.answer)[0];
        await guessAndWait(code, p0, parts[0], first, "click");
        const livesBefore = (await dbState(code)).round.progress[parts[0]].lives;
        await p0.reload();
        await expect(p0.getByRole("button", { name: `${first}, correct` })).toBeVisible();
        await expect(p0.getByRole("img", { name: new RegExp(`${livesBefore} lives left`) })).toBeVisible();
        await tv.reload();
        await tv.getByRole("button", { name: /Start TV/ }).click();
        await expect(tv.getByRole("img", { name: /Puzzle:/ })).toBeVisible();
        await host.reload();
        await expect(host.getByText("Round in progress")).toBeVisible();
      }

      // p0 solves with on-screen taps
      await solve(code, p0, parts[0], "click");
      await expect(p0.getByText("SOLVED! 🎉")).toBeVisible();
      await expect(p0.getByText(r.answer, { exact: true })).toHaveCount(0); // waiting screen never shows the answer
      seen.solved = true;
      // p1 fails with a physical keyboard
      if (p1) {
        await fail(code, p1, parts[1], "key");
        if ((await dbState(code)).phase === "round") {
          await expect(p1.getByText("YOU'RE OUT 😂")).toBeVisible();
          seen.out = true;
        }
      }
      // p2 buys the hint, then solves
      if (p2 && (await dbState(code)).phase === "round") {
        await p2.getByRole("button", { name: /Reveal hint/ }).click();
        await expect(p2.getByText(r.hint)).toBeVisible();
        await solve(code, p2, parts[2], "key");
      }
      await waitForDb(code, (x) => x.phase !== "round");
      continue;
    }

    if (s.phase === "reveal") {
      await expect(tv.getByText("Waiting for the host to continue…")).toBeVisible();
      const anyPhone = phones[names[0]];
      if (s.round.kind !== "suddenDeath") await expect(anyPhone.getByText(s.round.answer, { exact: true })).toBeVisible();
      await host.getByRole("button", { name: /Next|Finish game|Show final results|Next sudden-death word/ }).click();
      await waitForDb(code, (x) => x.phase !== "reveal" || x.seq !== s.seq);
      continue;
    }

    if (s.phase === "loserPick") {
      seen.loserPick = true;
      const picker = await pageOf(s.loserPick.playerId);
      await expect(tv.getByText(/Loser Picks!/)).toBeVisible();
      await picker.getByRole("button", { name: "Food", exact: true }).click();
      const nxt = await waitForDb(code, (x) => x.phase === "round");
      expect(nxt.round.category).toBe("food");
      continue;
    }

    if (s.phase === "dare") {
      seen.dare = true;
      const target = await pageOf(s.dare.playerId);
      await target.getByRole("button", { name: /Spin it/ }).click();
      await waitForDb(code, (x) => x.dare?.status === "spun");
      await host.getByRole("button", { name: /Re-spin dare/ }).click();
      await waitForDb(code, (x) => x.dare?.spinId === 2);
      await target.getByRole("button", { name: /Pass on this dare/ }).click();
      await waitForDb(code, (x) => x.dare?.status === "passed");
      await host.getByRole("button", { name: /Continue/ }).click();
      await waitForDb(code, (x) => x.phase !== "dare");
      continue;
    }
  }

  // ---------------- End of night ----------------
  const end = await waitForDb(code, (x) => x.phase === "ended");
  expect(mainRounds).toBe(5);
  expect(seen).toMatchObject({ loserPick: true, dare: true, final: true, refresh: true, solved: true, out: true });
  expect(end.history.every((h: { source: string }) => h.source === "builtin")).toBe(true);
  await expect(tv.getByRole("heading", { name: /End-of-Night Awards/ })).toBeVisible();

  // Scores match on the server, every phone, and the TV.
  const dbScores = Object.fromEntries(end.players.map((p: { nickname: string; score: number }) => [p.nickname, p.score]));
  for (const n of names) await expect(phones[n].getByLabel(`Score ${dbScores[n]}`)).toBeVisible();
  const top = [...names].sort((a, b) => dbScores[b] - dbScores[a]);
  for (const n of top.slice(0, 3)) await expect(tv.getByText(`${dbScores[n]} pts`).first()).toBeVisible();

  // ---------------- Answer protection over the network ----------------
  const answers: string[] = end.history.map((h: { answer: string }) => h.answer);
  for (const { url, body } of sink) {
    let json: { phase?: string; view?: { phase?: string } };
    try {
      json = JSON.parse(body);
    } catch {
      continue;
    }
    const phase = json.view?.phase ?? json.phase;
    if (phase !== "round") continue;
    expect(body, url).not.toContain('"answer"');
    for (const a of answers) expect(body, `${url} leaked "${a}"`).not.toContain(`"${a}"`);
  }

  // The built-in word bank never ships to browsers.
  const scripts = await tv.$$eval("script[src]", (els) => els.map((e) => (e as HTMLScriptElement).src));
  let js = "";
  for (const src of scripts) js += await (await tv.request.get(src)).text();
  expect(js, "sanity: the TV's own code was downloaded").toContain("End-of-Night Awards");
  // A leaked word list would contain answers as string literals, e.g. "Pho". Match the
  // quoted form so short answers don't false-positive on code like "Phone".
  for (const sample of ["Spaghetti Carbonara", "Distracted Boyfriend", "Breaking Bad", ...answers]) {
    for (const q of [`"${sample}"`, `'${sample}'`, `\`${sample}\``]) expect(js, `bundle contains ${q}`).not.toContain(q);
  }

  // ---------------- Play Again ----------------
  await host.getByRole("button", { name: /Play Again/ }).click();
  await expect(tv.getByText("3 players ready")).toBeVisible();
  for (const n of names) await expect(phones[n].getByText(/You're in/)).toBeVisible();
  const again = await dbState(code);
  expect(again.players.every((p: { score: number }) => p.score === 0)).toBe(true);
  expect(again.code).toBe(code);
  void idOf;
});

test("invalid room code and ended game show clear states", async ({ browser, request }) => {
  const p = await newPhone(browser);
  await p.goto("/play/QQQQQ");
  await expect(p.getByRole("heading", { name: "Room not found" })).toBeVisible();
  const created = await (await request.post("/api/rooms")).json();
  await request.post(`/api/rooms/${created.code}/host`, { data: { action: "end" }, headers: { "x-host-token": created.hostToken } });
  await p.goto(`/play/${created.code}`);
  await expect(p.getByRole("heading", { name: /already ended/ })).toBeVisible();
  const h = await newPhone(browser);
  await h.goto(`/host/${created.code}`);
  await expect(h.getByRole("heading", { name: "Host link needed" })).toBeVisible();
});
