// Full games in Emoji Decode and Mixed mode with a host, a TV and three phones.
import { expect, test, type Page } from "@playwright/test";
import { dbState, lettersOf, newPhone, recordApi, sql, waitForDb, wrongLetters } from "./helpers";

test.afterAll(async () => {
  await sql.end();
});

type Sink = { url: string; body: string }[];

async function guessAndWait(code: string, page: Page, pid: string, letter: string) {
  const s = await dbState(code);
  const pr = s.round?.progress?.[pid];
  if (!pr || pr.status !== "playing" || s.phase !== "round") return;
  const before = pr.guessed.length;
  await expect(page.getByRole("button", { name: letter, exact: true })).toBeEnabled();
  await page.getByRole("button", { name: letter, exact: true }).click();
  await waitForDb(code, (x) => x.phase !== "round" || x.round.progress[pid]?.guessed.length > before || x.round.progress[pid]?.status !== "playing");
}

/** Type an Emoji Decode answer in the phone's answer box and wait for the server to record it. */
async function answerAndWait(code: string, page: Page, pid: string, text: string) {
  const s = await dbState(code);
  const pr = s.round?.progress?.[pid];
  if (!pr || pr.status !== "playing" || s.phase !== "round") return;
  const before = pr.guessed.length;
  const box = page.getByRole("textbox", { name: "Your answer" });
  await expect(box).toBeEnabled();
  await box.fill(text);
  await page.getByRole("button", { name: /Submit answer/ }).click();
  await waitForDb(code, (x) => x.phase !== "round" || x.round.progress[pid]?.guessed.length > before || x.round.progress[pid]?.status !== "playing");
  await page.waitForTimeout(450); // stay under the answer rate limit, like a human would
}

async function setup(browser: import("@playwright/test").Browser, mode: "emoji" | "mixed", sink: Sink) {
  const host = await (await browser.newContext({ viewport: { width: 400, height: 860 } })).newPage();
  host.on("dialog", (d) => d.accept());
  recordApi(host, sink);
  await host.goto("/");
  await host.getByRole("button", { name: /Host a new game/ }).click();
  await host.waitForURL(/\/host\/[A-Z]{5}\/prep#k=/);
  const code = host.url().match(/host\/([A-Z]{5})/)![1];
  const modeLabel = mode === "emoji" ? "😀 Emoji Decode" : "🔀 Mixed";
  await host.getByRole("radio", { name: modeLabel }).click();
  await expect(host.getByRole("radio", { name: modeLabel })).toHaveAttribute("aria-checked", "true");
  await host.getByRole("radio", { name: "5", exact: true }).click();
  await expect(host.getByRole("radio", { name: "5", exact: true })).toHaveAttribute("aria-checked", "true");
  for (const cat of ["TV Shows", "Gen Z Phrases", "Music Artists", "Memes & Internet Culture", "College Life", "Mixed"]) {
    const b = host.getByRole("button", { name: cat, exact: true });
    await b.click();
    await expect(b).toHaveAttribute("aria-pressed", "false");
  }
  await host.getByRole("switch", { name: /Dare Wheel/ }).click();
  await host.getByRole("radio", { name: "2 rounds" }).click();
  await expect(host.getByRole("radio", { name: "2 rounds" })).toHaveAttribute("aria-checked", "true");
  expect((await dbState(code)).settings).toMatchObject({ mode, rounds: 5, dareWheel: true, dareEvery: 2 });

  const tv = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  recordApi(tv, sink);
  await tv.goto(`/tv/${code}`);
  await tv.getByRole("button", { name: /Start TV/ }).click();
  await expect(tv.getByText(/Game mode:/)).toContainText(mode === "emoji" ? "Emoji Decode" : "Mixed");

  const names = ["Ana", "Ben", "Cleo"];
  const phones: Record<string, Page> = {};
  for (const n of names) {
    const p = await newPhone(browser);
    recordApi(p, sink);
    await p.goto(`/play/${code}`);
    await p.getByLabel("Your nickname").fill(n);
    await p.getByRole("button", { name: /Join the party/ }).click();
    await expect(p.getByText(/You're in/)).toBeVisible();
    await expect(p.getByText(mode === "emoji" ? /Tonight: Emoji Decode/ : /Tonight: Hangman \+ Emoji Decode/)).toBeVisible();
    phones[n] = p;
  }
  await expect(tv.getByText("3 players ready")).toBeVisible();
  await host.getByRole("link", { name: /Open Host Controls/ }).click();
  await host.getByRole("button", { name: /Start game/ }).click();
  return { host, tv, phones, names, code };
}

async function playWholeGame(ctx: Awaited<ReturnType<typeof setup>>, mode: "emoji" | "mixed") {
  const { host, tv, phones, code } = ctx;
  const pageOf = async (id: string) => {
    const s = await dbState(code);
    return phones[s.players.find((p: { id: string }) => p.id === id).nickname];
  };
  let mainRounds = 0;
  const seen = { emojiRounds: 0, hangmanRounds: 0, hint: false, refresh: false, solved: false, out: false, dare: false, loserPick: false, final: false };

  for (let step = 0; step < 60; step++) {
    const s = await waitForDb(code, (x) => ["round", "reveal", "loserPick", "dare", "ended"].includes(x.phase));
    if (s.phase === "ended") break;

    if (s.phase === "round") {
      const r = s.round;
      const parts: string[] = r.participants;
      const pages = await Promise.all(parts.map(pageOf));
      if (r.kind === "suddenDeath") {
        if (r.mode === "emoji") await answerAndWait(code, pages[0], parts[0], r.answer);
        else for (const l of lettersOf(r.answer)) await guessAndWait(code, pages[0], parts[0], l);
        await waitForDb(code, (x) => x.phase !== "round");
        continue;
      }
      mainRounds++;
      if (mode === "mixed") expect(r.mode).toBe(mainRounds % 2 === 1 ? "hangman" : "emoji");
      if (r.kind === "final") {
        seen.final = true;
        await expect(tv.getByText("FINAL ROUND").first()).toBeVisible();
      }

      if (r.mode === "emoji") {
        seen.emojiRounds++;
        await expect(tv.getByRole("img", { name: `Emoji clue: ${r.clue}` })).toBeVisible();
        await expect(tv.getByText(/of 3 answered/)).toBeVisible();
        // p0: correct answer, typed casually (case, spacing, missing article)
        const casual = `  ${r.answer.toLowerCase().replace(/^the /, "")} `;
        await answerAndWait(code, pages[0], parts[0], casual);
        await expect(pages[0].getByText("SOLVED! 🎉")).toBeVisible();
        await expect(pages[0].getByText(r.answer, { exact: true })).toHaveCount(0);
        seen.solved = true;
        await expect(tv.getByText(/1 of 3 answered/)).toBeVisible();

        // p1: wrong once; on the first emoji round, refresh everyone mid-round
        await answerAndWait(code, pages[1], parts[1], "zzz wrong one");
        await expect(pages[1].getByText(/Not quite — 2 attempts left/)).toBeVisible();
        if (!seen.refresh) {
          seen.refresh = true;
          await host.getByRole("button", { name: /Drop hint 1\/2/ }).click();
          await waitForDb(code, (x) => x.round.hostHints.length === 1);
          await pages[1].reload();
          await expect(pages[1].getByRole("img", { name: "2 attempts left" })).toBeVisible();
          await expect(pages[1].getByText("Tried: zzz wrong one")).toBeVisible();
          await expect(pages[1].getByText(/Starts with/)).toBeVisible();
          await tv.reload();
          await tv.getByRole("button", { name: /Start TV/ }).click();
          await expect(tv.getByRole("img", { name: `Emoji clue: ${r.clue}` })).toBeVisible();
          await expect(tv.getByText(/Starts with/)).toBeVisible();
          await host.reload();
          await expect(host.getByText("Round in progress")).toBeVisible();
          await expect(host.getByRole("button", { name: /Drop hint 2\/2/ })).toBeVisible();
          seen.hint = true;
        }
        await answerAndWait(code, pages[1], parts[1], "zzz wrong two");
        await answerAndWait(code, pages[1], parts[1], "zzz wrong three");
        if ((await dbState(code)).phase === "round") {
          await expect(pages[1].getByText("YOU'RE OUT 😂")).toBeVisible();
          seen.out = true;
        }
        // p2: shows the clue on the phone, then answers correctly
        if (pages[2] && (await dbState(code)).phase === "round") {
          await pages[2].getByRole("button", { name: "Show clue" }).click();
          await expect(pages[2].getByRole("img", { name: `Emoji clue: ${r.clue}` })).toBeVisible();
          await answerAndWait(code, pages[2], parts[2], r.answer);
        }
      } else {
        seen.hangmanRounds++;
        await expect(tv.getByRole("img", { name: /Puzzle:/ })).toBeVisible();
        for (const l of lettersOf(r.answer)) await guessAndWait(code, pages[0], parts[0], l);
        if (pages[1]) for (const l of wrongLetters(r.answer).slice(0, 6)) await guessAndWait(code, pages[1], parts[1], l);
        if (pages[2]) for (const l of lettersOf(r.answer)) await guessAndWait(code, pages[2], parts[2], l);
      }
      await waitForDb(code, (x) => x.phase !== "round");
      continue;
    }

    if (s.phase === "reveal") {
      if (s.round.mode === "emoji" && s.round.kind !== "suddenDeath") {
        await expect(tv.getByText("The answer was")).toBeVisible();
        await expect(tv.getByText(s.round.answer, { exact: true })).toBeVisible();
        await expect(tv.getByText(/got it/)).toBeVisible();
        await expect(tv.getByText(/Fastest:/)).toBeVisible();
      }
      await host.getByRole("button", { name: /Next|Finish game|Show final results|Next sudden-death word/ }).click();
      await waitForDb(code, (x) => x.seq !== s.seq);
      continue;
    }
    if (s.phase === "loserPick") {
      seen.loserPick = true;
      await (await pageOf(s.loserPick.playerId)).getByRole("button", { name: "Food", exact: true }).click();
      await waitForDb(code, (x) => x.phase === "round");
      continue;
    }
    if (s.phase === "dare") {
      seen.dare = true;
      const target = await pageOf(s.dare.playerId);
      await target.getByRole("button", { name: /Spin it/ }).click();
      await waitForDb(code, (x) => x.dare?.status === "spun");
      await target.getByRole("button", { name: /Pass on this dare/ }).click();
      await waitForDb(code, (x) => x.dare?.status === "passed");
      await host.getByRole("button", { name: /Continue/ }).click();
      await waitForDb(code, (x) => x.phase !== "dare");
      continue;
    }
  }
  return { mainRounds, seen };
}

async function checkEndAndLeaks(ctx: Awaited<ReturnType<typeof setup>>, sink: Sink) {
  const { tv, phones, names, code } = ctx;
  const end = await waitForDb(code, (x) => x.phase === "ended");
  await expect(tv.getByRole("heading", { name: /End-of-Night Awards/ })).toBeVisible();
  await expect(tv.getByText("Emoji Whisperer")).toBeVisible();
  const dbScores = Object.fromEntries(end.players.map((p: { nickname: string; score: number }) => [p.nickname, p.score]));
  for (const n of names) await expect(phones[n].getByLabel(`Score ${dbScores[n]}`)).toBeVisible();
  const top = [...names].sort((a, b) => dbScores[b] - dbScores[a]);
  for (const n of top.slice(0, 3)) await expect(tv.getByText(`${dbScores[n]} pts`).first()).toBeVisible();
  // No /api response for a round in progress ever carries an answer or accepted alternate.
  const secrets = new Set<string>();
  for (const h of end.history) secrets.add(h.answer);
  let scanned = 0;
  for (const { url, body } of sink) {
    let json: { phase?: string; view?: { phase?: string } };
    try {
      json = JSON.parse(body);
    } catch {
      continue;
    }
    if ((json.view?.phase ?? json.phase) !== "round") continue;
    scanned++;
    expect(body, url).not.toContain('"answer"');
    expect(body, url).not.toContain('"alternates"');
    for (const a of secrets) expect(body, `${url} leaked "${a}"`).not.toContain(`"${a}"`);
  }
  expect(scanned).toBeGreaterThan(20);
  return end;
}

test("full game in Emoji Decode mode: host, TV and 3 players", async ({ browser }) => {
  const sink: Sink = [];
  const ctx = await setup(browser, "emoji", sink);
  const { mainRounds, seen } = await playWholeGame(ctx, "emoji");
  expect(mainRounds).toBe(5);
  expect(seen).toMatchObject({ emojiRounds: 5, hangmanRounds: 0, hint: true, refresh: true, solved: true, out: true, dare: true, final: true });
  const end = await checkEndAndLeaks(ctx, sink);
  expect(end.history.map((h: { mode: string }) => h.mode)).toEqual(["emoji", "emoji", "emoji", "emoji", "emoji"]);
  // Hint Addict needs Hangman rounds, so it never shows in an Emoji-only game.
  await expect(ctx.tv.getByText("Hint Addict")).toHaveCount(0);

  // Switch the mode on the game-over screen, then Play Again.
  await ctx.host.getByRole("radio", { name: "🔤 Hangman" }).click();
  await waitForDb(ctx.code, (x) => x.settings.mode === "hangman");
  await ctx.host.getByRole("button", { name: /Play Again/ }).click();
  await expect(ctx.tv.getByText(/Game mode: 🔤 Hangman/)).toBeVisible();
  await ctx.host.getByRole("button", { name: /Start game/ }).click();
  const st = await waitForDb(ctx.code, (x) => x.phase === "round");
  expect(st.round.mode).toBe("hangman");
});

test("full game in Mixed mode alternates Hangman and Emoji Decode on one leaderboard", async ({ browser }) => {
  const sink: Sink = [];
  const ctx = await setup(browser, "mixed", sink);
  const { mainRounds, seen } = await playWholeGame(ctx, "mixed");
  expect(mainRounds).toBe(5);
  expect(seen).toMatchObject({ emojiRounds: 2, hangmanRounds: 3, hint: true, refresh: true, solved: true, out: true, final: true });
  const end = await checkEndAndLeaks(ctx, sink);
  expect(end.history.map((h: { mode: string }) => h.mode)).toEqual(["hangman", "emoji", "hangman", "emoji", "hangman"]);
  const answers = end.history.map((h: { answer: string }) => h.answer.toLowerCase());
  expect(new Set(answers).size).toBe(answers.length);
  // One shared leaderboard: each score is the sum of that player's points across both modes.
  for (const p of end.players) {
    const sum = end.history.reduce((acc: number, h: { results: Record<string, { points: number }> }) => acc + (h.results[p.id]?.points ?? 0), 0);
    expect(sum).toBe(p.score);
  }
});
