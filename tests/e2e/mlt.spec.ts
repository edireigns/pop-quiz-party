// Most Likely To: a full game, and a Mixed game rotating through all three modes.
import { expect, test, type Browser, type Page } from "@playwright/test";
import { dbState, lettersOf, newPhone, recordApi, sql, waitForDb, wrongLetters } from "./helpers";

test.afterAll(async () => {
  await sql.end();
});

type Sink = { url: string; body: string }[];

async function voteAndWait(code: string, page: Page, pid: string, target: string) {
  const s = await dbState(code);
  const pr = s.round?.progress?.[pid];
  if (!pr || pr.status !== "playing" || s.phase !== "round") return;
  const option = page.getByRole("radio", { name: new RegExp(`^${target}`) });
  await expect(option).toBeEnabled({ timeout: 10_000 }); // waits out a freeze
  await option.click();
  await page.getByRole("button", { name: new RegExp(`Lock vote: ${target}`) }).click();
  await waitForDb(code, (x) => x.phase !== "round" || x.round.progress[pid]?.status !== "playing");
}

async function guessAndWait(code: string, page: Page, pid: string, letter: string) {
  const s = await dbState(code);
  const pr = s.round?.progress?.[pid];
  if (!pr || pr.status !== "playing" || s.phase !== "round") return;
  const before = pr.guessed.length;
  await expect(page.getByRole("button", { name: letter, exact: true })).toBeEnabled();
  await page.getByRole("button", { name: letter, exact: true }).click();
  await waitForDb(code, (x) => x.phase !== "round" || x.round.progress[pid]?.guessed.length > before || x.round.progress[pid]?.status !== "playing");
}

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
  await page.waitForTimeout(450);
}

async function hostGame(browser: Browser, sink: Sink, names: string[], configure: (host: Page) => Promise<void>) {
  const host = await (await browser.newContext({ viewport: { width: 400, height: 860 } })).newPage();
  host.on("dialog", (d) => d.accept());
  recordApi(host, sink);
  await host.goto("/");
  await host.getByRole("button", { name: /Host a new game/ }).click();
  await host.waitForURL(/\/host\/[A-Z]{5}\/prep#k=/);
  const code = host.url().match(/host\/([A-Z]{5})/)![1];
  await configure(host);
  const tv = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  recordApi(tv, sink);
  await tv.goto(`/tv/${code}`);
  await tv.getByRole("button", { name: /Start TV/ }).click();
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
  await expect(tv.getByText(`${names.length} players ready`)).toBeVisible();
  return { host, tv, phones, code };
}

function scanForVotes(sink: Sink) {
  let scanned = 0;
  for (const { url, body } of sink) {
    scanned++;
    expect(body, url).not.toContain("targetId");
    expect(body, url).not.toContain('"votes":{');
    expect(body, url).not.toMatch(/"(myVote|votedFor)":/);
  }
  expect(scanned).toBeGreaterThan(50);
}

async function checkScores(code: string, tv: Page, phones: Record<string, Page>) {
  const end = await waitForDb(code, (x) => x.phase === "ended");
  const dbScores = Object.fromEntries(end.players.filter((p: { removed: boolean }) => !p.removed).map((p: { nickname: string; score: number }) => [p.nickname, p.score]));
  for (const [n, page] of Object.entries(phones)) await expect(page.getByLabel(`Score ${dbScores[n]}`)).toBeVisible();
  const top = Object.keys(dbScores).sort((a, b) => dbScores[b] - dbScores[a]);
  for (const n of top.slice(0, 3)) await expect(tv.getByText(`${dbScores[n]} pts`).first()).toBeVisible();
  for (const p of end.players) {
    const sum = end.history.reduce((acc: number, h: { results: Record<string, { points: number }> }) => acc + (h.results[p.id]?.points ?? 0), 0);
    expect(sum).toBe(p.score);
  }
  return end;
}

test("full Most Likely To game: host, TV and 4 players", async ({ browser }) => {
  const sink: Sink = [];
  const names = ["Ana", "Ben", "Cleo", "Dev"];
  const { host, tv, phones, code } = await hostGame(browser, sink, names, async (h) => {
    await h.getByRole("radio", { name: "👑 Most Likely To" }).click();
    await expect(h.getByRole("radio", { name: "👑 Most Likely To" })).toHaveAttribute("aria-checked", "true");
    await h.getByRole("radio", { name: "5", exact: true }).click();
    await h.getByRole("radio", { name: "30s" }).click();
    await expect(h.getByRole("radio", { name: "30s" })).toHaveAttribute("aria-checked", "true");
    for (const p of ["College Life", "Friend Group", "Future Predictions"]) {
      await h.getByRole("button", { name: p, exact: true }).click();
      await expect(h.getByRole("button", { name: p, exact: true })).toHaveAttribute("aria-pressed", "false");
    }
    await h.getByLabel("Custom question").fill("adopt a goat named Kevin");
    await h.getByRole("button", { name: "Add", exact: true }).first().click();
    await expect(h.getByText("Who is most likely to adopt a goat named Kevin?")).toBeVisible();
    await h.getByRole("switch", { name: /Friend-written/ }).click();
    await h.getByRole("switch", { name: /Dare Wheel/ }).click();
    await h.getByRole("radio", { name: "2 rounds" }).click();
    await expect(h.getByRole("radio", { name: "2 rounds" })).toHaveAttribute("aria-checked", "true");
  });
  const st0 = await dbState(code);
  expect(st0.settings).toMatchObject({ mode: "mlt", rounds: 5, voteSec: 30, friendWords: true, dareWheel: true });
  expect([...st0.settings.packs].sort()).toEqual(["chaos", "custom", "habits"]);
  await expect(tv.getByText(/Game mode:/)).toContainText("Most Likely To");
  await expect(phones.Ana.getByText("👑 Tonight: Most Likely To")).toBeVisible();

  // A friend-written question (anonymous).
  await phones.Ben.getByLabel("Who is most likely to…").fill("befriend every dog at the park");
  await phones.Ben.getByRole("button", { name: /Submit my question/ }).click();
  await expect(phones.Ben.getByText(/Submitted: Who is most likely to befriend every dog at the park\?/)).toBeVisible();
  await expect(tv.getByText("befriend every dog")).toHaveCount(0);

  await host.getByRole("link", { name: /Open Host Controls/ }).click();
  await host.getByRole("button", { name: /Start game/ }).click();

  const idOf = (s: { players: { id: string; nickname: string }[] }, n: string) => s.players.find((p) => p.nickname === n)!.id;
  let mainRounds = 0;
  const seen = { missed: false, refresh: false, freeze: false, peek: false, double: false, correctScreen: false, wrongScreen: false, loserPick: false, dare: false, final: false, friend: false };

  for (let step = 0; step < 60; step++) {
    const s = await waitForDb(code, (x) => ["round", "reveal", "loserPick", "dare", "ended"].includes(x.phase));
    if (s.phase === "ended") break;
    if (s.phase === "round") {
      const r = s.round;
      expect(r.mode).toBe("mlt");
      if (r.kind === "suddenDeath") {
        for (const voter of r.participants) {
          const n = s.players.find((p: { id: string }) => p.id === voter).nickname;
          const target = s.players.find((p: { id: string }) => p.id === r.candidates[0]).nickname;
          await voteAndWait(code, phones[n], voter, target);
        }
        await waitForDb(code, (x) => x.phase !== "round");
        continue;
      }
      mainRounds++;
      if (r.source === "friend") seen.friend = true;
      await expect(tv.getByRole("heading", { name: r.question })).toBeVisible();
      await expect(tv.getByText(/votes in/)).toBeVisible();
      if (r.kind === "final") seen.final = true;

      if (mainRounds === 1) {
        // Ana → Ben, Ben → Ben, Cleo uses Double Vote → Dev, Dev misses the vote.
        await voteAndWait(code, phones.Ana, idOf(s, "Ana"), "Ben");
        await expect(phones.Ana.getByText("Vote locked")).toBeVisible();
        await voteAndWait(code, phones.Ben, idOf(s, "Ben"), "Ben");
        await phones.Cleo.getByRole("button", { name: /Double Vote/ }).click();
        await expect(phones.Cleo.getByText(/Double Vote is on/)).toBeVisible();
        seen.double = true;
        await voteAndWait(code, phones.Cleo, idOf(s, "Cleo"), "Dev");
        await waitForDb(code, (x) => x.phase !== "round", 40_000); // Dev runs out the clock
        seen.missed = true;
      } else if (mainRounds === 2) {
        // Freeze and Peek, then refresh every screen mid-round.
        await phones.Dev.getByRole("button", { name: /Freeze rival/ }).click();
        await phones.Dev.getByRole("dialog").getByRole("button", { name: "Ben" }).click();
        await expect(phones.Ben.getByText(/FROZEN/)).toBeVisible();
        seen.freeze = true;
        await voteAndWait(code, phones.Ana, idOf(s, "Ana"), "Cleo");
        await phones.Cleo.getByRole("button", { name: /Peek at leader/ }).click();
        await expect(phones.Cleo.getByText(/Peek: Cleo was leading with 1 vote/)).toBeVisible();
        seen.peek = true;
        await phones.Ana.reload();
        await expect(phones.Ana.getByText("Vote locked")).toBeVisible();
        await tv.reload();
        await tv.getByRole("button", { name: /Start TV/ }).click();
        await expect(tv.getByRole("heading", { name: r.question })).toBeVisible();
        await expect(tv.getByText(/1 of 4 votes in/)).toBeVisible();
        await host.reload();
        await expect(host.getByText("Round in progress")).toBeVisible();
        await expect(host.getByText(/1 of 4 voted/)).toBeVisible();
        seen.refresh = true;
        await voteAndWait(code, phones.Cleo, idOf(s, "Cleo"), "Cleo");
        await voteAndWait(code, phones.Dev, idOf(s, "Dev"), "Ana");
        await voteAndWait(code, phones.Ben, idOf(s, "Ben"), "Cleo"); // after the freeze wears off
      } else {
        await voteAndWait(code, phones.Ana, idOf(s, "Ana"), "Dev");
        await voteAndWait(code, phones.Ben, idOf(s, "Ben"), "Dev");
        await voteAndWait(code, phones.Cleo, idOf(s, "Cleo"), "Ana");
        await voteAndWait(code, phones.Dev, idOf(s, "Dev"), "Dev");
      }
      await waitForDb(code, (x) => x.phase !== "round");
      continue;
    }
    if (s.phase === "reveal") {
      if (s.round.kind !== "suddenDeath") {
        await expect(tv.getByText(/takes the crown|share the crown|Nobody voted/)).toBeVisible({ timeout: 15_000 });
        for (const n of names) {
          const result = s.round.progress[idOf(s, n)]?.voteResult;
          if (result === "correct") {
            await expect(phones[n].getByText("You read the room!")).toBeVisible();
            seen.correctScreen = true;
          } else if (result) {
            await expect(phones[n].getByText("YOU'RE OUT 😂")).toBeVisible();
            seen.wrongScreen = true;
          }
        }
      }
      await host.getByRole("button", { name: /Next|Finish game|Show final results|Next sudden-death word/ }).click();
      await waitForDb(code, (x) => x.seq !== s.seq);
      continue;
    }
    if (s.phase === "loserPick") {
      seen.loserPick = true;
      expect(s.loserPick.kind).toBe("pack");
      const picker = s.players.find((p: { id: string }) => p.id === s.loserPick.playerId).nickname;
      await expect(tv.getByText(/chooses the next question pack/)).toBeVisible();
      await phones[picker].getByRole("button", { name: "Chaos", exact: true }).click();
      await waitForDb(code, (x) => x.phase === "round");
      continue;
    }
    if (s.phase === "dare") {
      seen.dare = true;
      const target = s.players.find((p: { id: string }) => p.id === s.dare.playerId).nickname;
      await phones[target].getByRole("button", { name: /Spin it/ }).click();
      await waitForDb(code, (x) => x.dare?.status === "spun");
      await phones[target].getByRole("button", { name: /Pass on this dare/ }).click();
      await waitForDb(code, (x) => x.dare?.status === "passed");
      await host.getByRole("button", { name: /Continue/ }).click();
      await waitForDb(code, (x) => x.phase !== "dare");
      continue;
    }
  }

  expect(mainRounds).toBe(5);
  expect(seen).toMatchObject({ missed: true, refresh: true, freeze: true, peek: true, double: true, correctScreen: true, wrongScreen: true, dare: true, final: true });
  const end = await checkScores(code, tv, phones);
  expect(end.history.every((h: { mode: string }) => h.mode === "mlt")).toBe(true);
  // The friend question was used (anonymously) if it was planned.
  if (end.questionSubs.some((q: { status: string }) => q.status === "used")) expect(seen.friend).toBe(true);
  await expect(tv.getByText("Crowd Favorite")).toBeVisible();
  await expect(tv.getByText("Mind Reader")).toBeVisible();
  for (const hidden of ["Speed Demon", "Hint Addict", "Emoji Whisperer", "Most Lives Lost"]) await expect(tv.getByText(hidden)).toHaveCount(0);
  scanForVotes(sink);
});

test("Mixed game rotating Hangman, Emoji Decode and Most Likely To on one leaderboard", async ({ browser }) => {
  const sink: Sink = [];
  const names = ["Ana", "Ben", "Cleo"];
  const { host, tv, phones, code } = await hostGame(browser, sink, names, async (h) => {
    await h.getByRole("radio", { name: "🔀 Mixed" }).click();
    await h.getByRole("button", { name: "👑 Most Likely To", exact: true }).click();
    await expect(h.getByRole("button", { name: "👑 Most Likely To", exact: true })).toHaveAttribute("aria-pressed", "true");
    await h.getByRole("radio", { name: "5", exact: true }).click();
    await expect(h.getByRole("radio", { name: "5", exact: true })).toHaveAttribute("aria-checked", "true");
  });
  expect((await dbState(code)).settings.mixedModes).toEqual(["hangman", "emoji", "mlt"]);
  await expect(phones.Ana.getByText("🔀 Tonight: Hangman + Emoji Decode + Most Likely To")).toBeVisible();
  await host.getByRole("link", { name: /Open Host Controls/ }).click();
  await host.getByRole("button", { name: /Start game/ }).click();

  const pageOf = (s: { players: { id: string; nickname: string }[] }, id: string) => phones[s.players.find((p) => p.id === id)!.nickname];
  for (let step = 0; step < 60; step++) {
    const s = await waitForDb(code, (x) => ["round", "reveal", "loserPick", "dare", "ended"].includes(x.phase));
    if (s.phase === "ended") break;
    if (s.phase === "round") {
      const r = s.round;
      const parts: string[] = r.participants;
      if (r.mode === "mlt") {
        await expect(tv.getByRole("heading", { name: r.question })).toBeVisible();
        const targets = r.kind === "suddenDeath" ? r.candidates : [parts[1], parts[1], parts[0]];
        for (let i = 0; i < parts.length; i++) {
          const target = s.players.find((p: { id: string }) => p.id === (targets[i] ?? targets[0])).nickname;
          await voteAndWait(code, pageOf(s, parts[i]), parts[i], target);
        }
      } else if (r.mode === "emoji") {
        await expect(tv.getByRole("img", { name: `Emoji clue: ${r.clue}` })).toBeVisible();
        await answerAndWait(code, pageOf(s, parts[0]), parts[0], r.answer);
        if (parts[1]) for (const g of ["zz one", "zz two", "zz three"]) await answerAndWait(code, pageOf(s, parts[1]), parts[1], g);
        if (parts[2]) await answerAndWait(code, pageOf(s, parts[2]), parts[2], r.answer);
      } else {
        for (const l of lettersOf(r.answer)) await guessAndWait(code, pageOf(s, parts[0]), parts[0], l);
        if (parts[1]) for (const l of wrongLetters(r.answer).slice(0, 6)) await guessAndWait(code, pageOf(s, parts[1]), parts[1], l);
        if (parts[2]) for (const l of lettersOf(r.answer)) await guessAndWait(code, pageOf(s, parts[2]), parts[2], l);
      }
      await waitForDb(code, (x) => x.phase !== "round");
      continue;
    }
    if (s.phase === "reveal") {
      if (s.round.mode === "mlt" && s.round.kind !== "suddenDeath") await expect(tv.getByText(/takes the crown|share the crown/)).toBeVisible({ timeout: 15_000 });
      await host.getByRole("button", { name: /Next|Finish game|Show final results|Next sudden-death word/ }).click();
      await waitForDb(code, (x) => x.seq !== s.seq);
      continue;
    }
    if (s.phase === "loserPick") {
      await host.getByRole("button", { name: /Pick randomly now/ }).click();
      await waitForDb(code, (x) => x.phase === "round");
      continue;
    }
  }
  const end = await checkScores(code, tv, phones);
  expect(end.history.map((h: { mode: string }) => h.mode)).toEqual(["hangman", "emoji", "mlt", "hangman", "emoji"]);
  scanForVotes(sink);
});
