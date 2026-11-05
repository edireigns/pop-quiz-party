// Who Wrote It?: a full game, and a Mixed game with Hangman, on real browsers.
import { expect, test, type Browser, type Page } from "@playwright/test";
import { dbState, lettersOf, newPhone, recordApi, sql, waitForDb, wrongLetters } from "./helpers";

test.afterAll(async () => {
  await sql.end();
});

type Sink = { url: string; body: string }[];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type State = any;

const nameOf = (s: State, id: string) => s.players.find((p: { id: string }) => p.id === id).nickname as string;

async function writeAndWait(code: string, page: Page, pid: string, text: string) {
  const box = page.getByLabel(/Your answer — anonymous/);
  await expect(box).toBeVisible();
  await box.fill(text);
  await expect(page.getByText(`${[...text].length}/80`)).toBeVisible();
  await page.getByRole("button", { name: /Lock in my answer/ }).click();
  await waitForDb(code, (x) => x.round?.wwi?.stage !== "writing" || !!x.round.wwi.answers[pid]);
}

async function pickAndWait(code: string, page: Page, pid: string, targetName: string) {
  const s = await dbState(code);
  const cur = s.round?.wwi?.current;
  if (!cur || s.round.wwi.stage !== "guessing") return;
  const before = cur.guesses[pid]?.length ?? 0;
  const btn = page.getByRole("group", { name: "Who wrote it?" }).getByRole("button", { name: targetName, exact: true });
  await expect(btn).toBeEnabled({ timeout: 10_000 }); // waits out a freeze
  await btn.click();
  await waitForDb(
    code,
    (x) => x.round?.wwi?.stage !== "guessing" || x.round.wwi.current?.answerId !== cur.answerId || (x.round.wwi.current.guesses[pid]?.length ?? 0) > before,
  );
  await page.waitForTimeout(300);
}

/** A name on this guesser's buttons that isn't the author. */
function wrongName(s: State, pid: string) {
  const cur = s.round.wwi.current;
  const out = new Set(cur.eliminated[pid] ?? []);
  return nameOf(s, cur.orders[pid].find((id: string) => id !== cur.authorId && !out.has(id)));
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

async function voteAndWait(code: string, page: Page, pid: string, target: string) {
  const s = await dbState(code);
  const pr = s.round?.progress?.[pid];
  if (!pr || pr.status !== "playing" || s.phase !== "round") return;
  await page.getByRole("radio", { name: new RegExp(`^${target}`) }).click();
  await page.getByRole("button", { name: new RegExp(`Lock vote: ${target}`) }).click();
  await waitForDb(code, (x) => x.phase !== "round" || x.round.progress[pid]?.status !== "playing");
}

async function hostGame(browser: Browser, sinks: { all: Sink; tv: Sink }, names: string[], configure: (host: Page) => Promise<void>) {
  const host = await (await browser.newContext({ viewport: { width: 400, height: 860 } })).newPage();
  host.on("dialog", (d) => d.accept());
  recordApi(host, sinks.all);
  await host.goto("/");
  await host.getByRole("button", { name: /Host a new game/ }).click();
  await host.waitForURL(/\/host\/[A-Z]{5}\/prep#k=/);
  const code = host.url().match(/host\/([A-Z]{5})/)![1];
  await configure(host);
  const tv = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  recordApi(tv, sinks.all);
  recordApi(tv, sinks.tv);
  await tv.goto(`/tv/${code}`);
  await tv.getByRole("button", { name: /Start TV/ }).click();
  const phones: Record<string, Page> = {};
  for (const n of names) {
    const p = await newPhone(browser);
    recordApi(p, sinks.all);
    await p.goto(`/play/${code}`);
    await p.getByLabel("Your nickname").fill(n);
    await p.getByRole("button", { name: /Join the party/ }).click();
    await expect(p.getByText(/You're in/)).toBeVisible();
    phones[n] = p;
  }
  await expect(tv.getByText(`${names.length} players ready`)).toBeVisible();
  return { host, tv, phones, code };
}

/** No response ever carries a secret: an author before its reveal, anyone's picks, or the answer map. */
function scanForLeaks(sink: Sink) {
  let scanned = 0;
  let guessingViews = 0;
  for (const { url, body } of sink) {
    scanned++;
    expect(body, url).not.toMatch(/"orders"|"guesses"|"eliminated":\[|"answers":\{|"queue"|"wwiShownCount"|"lastResults"/);
    let j: State;
    try {
      j = JSON.parse(body);
    } catch {
      continue;
    }
    const v = j?.view ?? j;
    const w = v?.round?.wwi;
    if (w && !v.reveal && w.stage !== "answerReveal") {
      expect(body, url).not.toContain('"authorId"');
      if (w.stage === "guessing") guessingViews++;
    }
  }
  expect(scanned).toBeGreaterThan(50);
  expect(guessingViews).toBeGreaterThan(5);
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

test("full Who Wrote It? game: host, TV and 4 players", async ({ browser }) => {
  const sinks = { all: [] as Sink, tv: [] as Sink };
  const names = ["Ana", "Ben", "Cleo", "Dev"];
  const { host, tv, phones, code } = await hostGame(browser, sinks, names, async (h) => {
    await h.getByRole("radio", { name: "🕵️ Who Wrote It?" }).click();
    await expect(h.getByRole("radio", { name: "🕵️ Who Wrote It?" })).toHaveAttribute("aria-checked", "true");
    await h.getByRole("radiogroup", { name: "Rounds" }).getByRole("radio", { name: "5", exact: true }).click();
    await h.getByRole("radiogroup", { name: "Writing timer (Who Wrote It?)" }).getByRole("radio", { name: "30s" }).click();
    await h.getByRole("radiogroup", { name: "Guessing timer (per answer)" }).getByRole("radio", { name: "10s" }).click();
    await expect(h.getByRole("radiogroup", { name: "Guessing timer (per answer)" }).getByRole("radio", { name: "10s" })).toHaveAttribute("aria-checked", "true");
    await expect(h.getByRole("radiogroup", { name: "Answers shown per round" }).getByRole("radio", { name: "3", exact: true })).toHaveAttribute("aria-checked", "true");
    await h.getByRole("button", { name: "Chaos", exact: true }).click();
    await expect(h.getByRole("button", { name: "Chaos", exact: true })).toHaveAttribute("aria-pressed", "false");
    await expect(h.getByText(/Estimated game length: about \d+ min/)).toBeVisible();
    await h.getByLabel("Custom Who Wrote It? question").fill("what would our group's reality show be called");
    await h.getByRole("button", { name: "Add", exact: true }).first().click();
    await expect(h.getByText("What would our group's reality show be called?", { exact: true })).toBeVisible();
    await h.getByRole("switch", { name: /Friend-written/ }).click();
    await expect(h.getByRole("switch", { name: /Friend-written/ })).toHaveAttribute("aria-checked", "true");
  });
  const st0 = await dbState(code);
  expect(st0.settings).toMatchObject({ mode: "wwi", rounds: 5, writeSec: 30, guessSec: 10, answersShown: 3, friendWords: true });
  expect([...st0.settings.wwiPacks].sort()).toEqual(["college", "custom", "friends", "habits", "hypotheticals"]);
  await expect(tv.getByText(/Game mode:/)).toContainText("Who Wrote It?");
  await expect(tv.getByText(/about \d+ min/)).toBeVisible();
  await expect(phones.Ana.getByText("🕵️ Tonight: Who Wrote It?")).toBeVisible();

  // A friend-written question: anonymous, and the TV never shows it in the lobby.
  await phones.Ben.getByLabel("Your question").fill("What would you bring to a desert island?");
  await phones.Ben.getByRole("button", { name: /Submit my question/ }).click();
  await expect(phones.Ben.getByText(/Submitted: What would you bring to a desert island\?/)).toBeVisible();
  await expect(tv.getByText("desert island")).toHaveCount(0);

  await host.getByRole("link", { name: /Open Host Controls/ }).click();
  await expect(host.getByText(/About \d+ min with these settings/)).toBeVisible();
  await host.getByRole("button", { name: /Start game/ }).click();

  let mainRounds = 0;
  let answersSeen = 0;
  const typed = new Set<string>();
  const shown = new Set<string>();
  const seen = { removed: false, skipped: false, refresh: false, freeze: false, eliminate: false, double: false, missed: false, correctScreen: false, wrongScreen: false, authorScreen: false, loserPick: false, final: false, friend: false };
  let lastRound = 0;

  for (let step = 0; step < 200; step++) {
    const s = await waitForDb(code, (x) => ["round", "reveal", "loserPick", "dare", "ended"].includes(x.phase));
    if (s.phase === "ended") break;
    if (s.phase === "round") {
      const r = s.round;
      if (r.kind === "suddenDeath") {
        // No word rounds: the other players vote on the tied players.
        expect(r.mode).toBe("mlt");
        for (const voter of r.participants) await voteAndWait(code, phones[nameOf(s, voter)], voter, nameOf(s, r.candidates[0]));
        await waitForDb(code, (x) => x.phase !== "round");
        continue;
      }
      expect(r.mode).toBe("wwi");
      const w = r.wwi;
      if (r.number !== lastRound) {
        lastRound = r.number;
        mainRounds++;
        if (r.source === "friend") seen.friend = true;
        if (r.kind === "final") seen.final = true;
      }
      if (w.stage === "writing") {
        await expect(tv.getByRole("heading", { name: r.question })).toBeVisible();
        for (const [i, pid] of r.participants.entries()) {
          if (w.answers[pid]) continue;
          const text = `Secret ${r.number}${"ABCD"[i]}`;
          typed.add(text);
          await writeAndWait(code, phones[nameOf(s, pid)], pid, text);
          if (i === 0) {
            await expect(phones[nameOf(s, pid)].getByText("Answer locked")).toBeVisible();
            await expect(tv.getByText(/1 of 4 answers in/)).toBeVisible();
          }
        }
        await waitForDb(code, (x) => x.round.wwi.stage !== "writing");
        continue;
      }
      if (w.stage === "review") {
        if (!seen.removed) {
          // The host removes an answer before it ever reaches the TV.
          await expect(host.getByText(/Coming up/)).toBeVisible();
          const first = host.getByRole("button", { name: /^Remove answer / }).first();
          const label = (await first.getAttribute("aria-label"))!.replace(/^Remove answer /, "");
          await first.click();
          await waitForDb(code, (x) => x.round.wwi.removed.length > 0);
          await expect(host.getByRole("button", { name: `Remove answer ${label}` })).toHaveCount(0);
          seen.removed = true;
        }
        await host.getByRole("button", { name: /Start guessing/ }).click();
        await waitForDb(code, (x) => x.phase !== "round" || x.round.wwi.stage !== "review");
        continue;
      }
      if (w.stage === "guessing") {
        const cur = w.current;
        answersSeen++;
        shown.add(cur.text);
        const author = nameOf(s, cur.authorId);
        const guessers = r.participants.filter((id: string) => id !== cur.authorId);
        await expect(tv.getByText(`“${cur.text}”`)).toBeVisible();
        await expect(phones[author].getByText(/Your answer is on screen\. Keep a straight face/)).toBeVisible();
        await expect(phones[nameOf(s, guessers[0])].getByRole("group", { name: "Who wrote it?" }).getByRole("button")).toHaveCount(3);

        if (answersSeen === 1) {
          // Freeze, Eliminate Two, then refresh every screen mid-answer.
          const [g0, g1, g2] = guessers.map((id: string) => nameOf(s, id));
          await phones[g0].getByRole("button", { name: /Freeze rival/ }).click();
          await phones[g0].getByRole("dialog").getByRole("button", { name: g1 }).click();
          await expect(phones[g1].getByText(/FROZEN/)).toBeVisible();
          seen.freeze = true;
          await phones[g2].getByRole("button", { name: /Eliminate Two/ }).click();
          await expect(phones[g2].getByText(/Wrong names removed/)).toBeVisible();
          await expect(phones[g2].getByRole("group", { name: "Who wrote it?" }).getByRole("button")).toHaveCount(2);
          seen.eliminate = true;
          await phones[g2].reload();
          await expect(phones[g2].getByRole("group", { name: "Who wrote it?" }).getByRole("button")).toHaveCount(2);
          await phones[author].reload();
          await expect(phones[author].getByText(/Keep a straight face/)).toBeVisible();
          await tv.reload();
          await tv.getByRole("button", { name: /Start TV/ }).click();
          await expect(tv.getByText(`“${cur.text}”`)).toBeVisible();
          await host.reload();
          await expect(host.getByText(/Answer 1 of 3 on screen/)).toBeVisible();
          seen.refresh = true;
          await pickAndWait(code, phones[g0], guessers[0], author);
          await pickAndWait(code, phones[g2], guessers[2], author);
          await pickAndWait(code, phones[g1], guessers[1], wrongName(await dbState(code), guessers[1]));
        } else if (answersSeen === 2) {
          // The host skips the answer on screen: no points, its author stays secret, a replacement (if any) comes up.
          await host.getByRole("button", { name: /Skip this answer/ }).click();
          await waitForDb(code, (x) => x.phase !== "round" || x.round.wwi.current?.answerId !== cur.answerId);
          await expect(tv.getByText(`“${cur.text}”`)).toHaveCount(0);
          seen.skipped = true;
          answersSeen++;
          continue;
        } else if (!seen.double) {
          // Double Guess: one wrong name, then the author.
          const g = nameOf(s, guessers[0]);
          await phones[g].getByRole("button", { name: /Double Guess/ }).click();
          await expect(phones[g].getByText(/pick two names/)).toBeVisible();
          await pickAndWait(code, phones[g], guessers[0], wrongName(s, guessers[0]));
          await expect(phones[g].getByText(/pick one more name/)).toBeVisible();
          await pickAndWait(code, phones[g], guessers[0], author);
          seen.double = true;
          for (const id of guessers.slice(1)) await pickAndWait(code, phones[nameOf(s, id)], id, wrongName(s, id));
        } else if (!seen.missed) {
          // One player lets the clock run out.
          await pickAndWait(code, phones[nameOf(s, guessers[0])], guessers[0], author);
          await pickAndWait(code, phones[nameOf(s, guessers[1])], guessers[1], wrongName(s, guessers[1]));
          seen.missed = true;
        } else {
          await pickAndWait(code, phones[nameOf(s, guessers[0])], guessers[0], author);
          for (const id of guessers.slice(1)) await pickAndWait(code, phones[nameOf(s, id)], id, wrongName(s, id));
        }
        await waitForDb(code, (x) => x.phase !== "round" || x.round.wwi.stage !== "guessing", 30_000);
        continue;
      }
      if (w.stage === "answerReveal") {
        const x = w.revealed[w.revealed.length - 1];
        await expect(tv.getByText(`✍️ ${nameOf(s, x.authorId)}!`)).toBeVisible();
        for (const [pid, result] of Object.entries(w.lastResults as Record<string, string>)) {
          const page = phones[nameOf(s, pid)];
          if (result === "correct") {
            await expect(page.getByText(/You got it! \+\d+/)).toBeVisible();
            seen.correctScreen = true;
          } else if (result === "author") {
            await expect(page.getByText(/Your answer fooled \d+ players?!|Nobody was fooled/)).toBeVisible();
            seen.authorScreen = true;
          } else {
            await expect(page.getByText("YOU'RE OUT 😂")).toBeVisible();
            seen.wrongScreen = true;
          }
        }
        await host.getByRole("button", { name: /Next answer|Show leaderboard/ }).click();
        await waitForDb(code, (x) => x.seq !== s.seq);
        continue;
      }
    }
    if (s.phase === "reveal") {
      if (s.round.kind !== "suddenDeath") await expect(tv.getByText(/guessed right|no points this round/).first()).toBeVisible();
      await host.getByRole("button", { name: /Next|Finish game|Show final results|Next sudden-death word/ }).first().click();
      await waitForDb(code, (x) => x.seq !== s.seq);
      continue;
    }
    if (s.phase === "loserPick") {
      seen.loserPick = true;
      expect(s.loserPick.kind).toBe("pack");
      const picker = nameOf(s, s.loserPick.playerId);
      await expect(tv.getByText(/chooses the next question pack/)).toBeVisible();
      await phones[picker].getByRole("button", { name: /Hypotheticals|College Life|Friend Group|Funny Habits|Host's Questions/ }).first().click();
      await waitForDb(code, (x) => x.phase === "round");
      continue;
    }
    if (s.phase === "dare") {
      await host.getByRole("button", { name: /Continue/ }).click();
      await waitForDb(code, (x) => x.phase !== "dare");
    }
  }

  expect(mainRounds).toBe(5);
  expect(seen).toMatchObject({
    removed: true,
    skipped: true,
    refresh: true,
    freeze: true,
    eliminate: true,
    double: true,
    missed: true,
    correctScreen: true,
    wrongScreen: true,
    authorScreen: true,
    final: true,
  });
  const end = await checkScores(code, tv, phones);
  expect(end.history.every((h: { mode: string }) => h.mode === "wwi")).toBe(true);
  if (end.promptSubs.some((q: { status: string }) => q.status === "used")) expect(seen.friend).toBe(true);
  await expect(tv.getByText("Mastermind")).toBeVisible();
  await expect(tv.getByText("Undercover Agent")).toBeVisible();
  await expect(tv.getByText("Open Book")).toBeVisible();
  for (const hidden of ["Speed Demon", "Hint Addict", "Emoji Whisperer", "Most Lives Lost", "Crowd Favorite", "Mind Reader"])
    await expect(tv.getByText(hidden)).toHaveCount(0);
  // Answers that never went on screen never reached the TV.
  const unshown = [...typed].filter((t) => !shown.has(t));
  expect(unshown.length).toBeGreaterThan(0);
  for (const { body } of sinks.tv) for (const t of unshown) expect(body).not.toContain(t);
  scanForLeaks(sinks.all);
});

test("Mixed game with Hangman and Who Wrote It? on one leaderboard", async ({ browser }) => {
  const sinks = { all: [] as Sink, tv: [] as Sink };
  const names = ["Ana", "Ben", "Cleo", "Dev"];
  const { host, tv, phones, code } = await hostGame(browser, sinks, names, async (h) => {
    await h.getByRole("radio", { name: "🔀 Mixed" }).click();
    await h.getByRole("button", { name: "🕵️ Who Wrote It?", exact: true }).click();
    await expect(h.getByRole("button", { name: "🕵️ Who Wrote It?", exact: true })).toHaveAttribute("aria-pressed", "true");
    await h.getByRole("button", { name: "😀 Emoji Decode", exact: true }).click();
    await expect(h.getByRole("button", { name: "😀 Emoji Decode", exact: true })).toHaveAttribute("aria-pressed", "false");
    await h.getByRole("radiogroup", { name: "Rounds" }).getByRole("radio", { name: "5", exact: true }).click();
    await h.getByRole("radiogroup", { name: "Answers shown per round" }).getByRole("radio", { name: "1", exact: true }).click();
    await expect(h.getByRole("radiogroup", { name: "Answers shown per round" }).getByRole("radio", { name: "1", exact: true })).toHaveAttribute("aria-checked", "true");
  });
  expect((await dbState(code)).settings.mixedModes).toEqual(["hangman", "wwi"]);
  await expect(phones.Ana.getByText("🔀 Tonight: Hangman + Who Wrote It?")).toBeVisible();
  await host.getByRole("link", { name: /Open Host Controls/ }).click();
  await host.getByRole("button", { name: /Start game/ }).click();

  const pageOf = (s: State, id: string) => phones[nameOf(s, id)];
  for (let step = 0; step < 120; step++) {
    const s = await waitForDb(code, (x) => ["round", "reveal", "loserPick", "dare", "ended"].includes(x.phase));
    if (s.phase === "ended") break;
    if (s.phase === "round") {
      const r = s.round;
      const parts: string[] = r.participants;
      if (r.mode === "wwi") {
        const w = r.wwi;
        if (w.stage === "writing") {
          for (const [i, pid] of parts.entries()) if (!w.answers[pid]) await writeAndWait(code, pageOf(s, pid), pid, `Mixed ${r.number}${"ABCD"[i]}`);
          await waitForDb(code, (x) => x.round.wwi.stage !== "writing");
        } else if (w.stage === "review") {
          await host.getByRole("button", { name: /Start guessing/ }).click();
          await waitForDb(code, (x) => x.phase !== "round" || x.round.wwi.stage !== "review");
        } else if (w.stage === "guessing") {
          const cur = w.current;
          await expect(tv.getByText(`“${cur.text}”`)).toBeVisible();
          const guessers = parts.filter((id) => id !== cur.authorId);
          await pickAndWait(code, pageOf(s, guessers[0]), guessers[0], nameOf(s, cur.authorId));
          for (const id of guessers.slice(1)) await pickAndWait(code, pageOf(s, id), id, wrongName(s, id));
          await waitForDb(code, (x) => x.phase !== "round" || x.round.wwi.stage !== "guessing");
        } else {
          await expect(tv.getByText(`✍️ ${nameOf(s, w.revealed[0].authorId)}!`)).toBeVisible();
          await host.getByRole("button", { name: /Show leaderboard/ }).click();
          await waitForDb(code, (x) => x.seq !== s.seq);
        }
        continue;
      }
      if (r.mode === "mlt") {
        for (const voter of parts) await voteAndWait(code, pageOf(s, voter), voter, nameOf(s, r.candidates[0]));
      } else {
        for (const l of lettersOf(r.answer)) await guessAndWait(code, pageOf(s, parts[0]), parts[0], l);
        if (parts[1]) for (const l of wrongLetters(r.answer).slice(0, 6)) await guessAndWait(code, pageOf(s, parts[1]), parts[1], l);
        for (const id of parts.slice(2)) for (const l of lettersOf(r.answer)) await guessAndWait(code, pageOf(s, id), id, l);
      }
      await waitForDb(code, (x) => x.phase !== "round");
      continue;
    }
    if (s.phase === "reveal") {
      await host.getByRole("button", { name: /Next|Finish game|Show final results|Next sudden-death word/ }).first().click();
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
  expect(end.history.map((h: { mode: string }) => h.mode)).toEqual(["hangman", "wwi", "hangman", "wwi", "hangman"]);
  // Who Wrote It? points landed on the shared leaderboard.
  const wwiPoints = end.history.filter((h: { mode: string }) => h.mode === "wwi").flatMap((h: { results: Record<string, { points: number }> }) => Object.values(h.results).map((x) => x.points));
  expect(wwiPoints.some((p: number) => p >= 100)).toBe(true);
  scanForLeaks(sinks.all);
});
