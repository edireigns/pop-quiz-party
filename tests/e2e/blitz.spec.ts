// Category Blitz: a full game, and a Mixed game with Hangman, on real browsers.
import { expect, test, type Browser, type Page } from "@playwright/test";
import { dbState, expireRound, lettersOf, newPhone, recordApi, sql, waitForDb, wrongLetters } from "./helpers";

test.afterAll(async () => {
  await sql.end();
});

type Sink = { url: string; body: string }[];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type State = any;

const nameOf = (s: State, id: string) => s.players.find((p: { id: string }) => p.id === id).nickname as string;

async function addAndWait(code: string, page: Page, pid: string, text: string) {
  const before = (await dbState(code)).round?.blitz?.subs?.[pid]?.length ?? 0;
  const box = page.getByRole("textbox", { name: "Your answer" });
  await expect(box).toBeEnabled({ timeout: 10_000 }); // waits out a freeze
  await box.fill(text);
  await box.press("Enter");
  const after = await waitForDb(code, (x) => x.phase !== "round" || x.round.blitz?.stage !== "play" || (x.round.blitz.subs[pid]?.length ?? 0) > before);
  if (after.phase === "round" && after.round.kind !== "suddenDeath") await expect(box).toHaveValue(""); // cleared, ready for the next one
  await page.waitForTimeout(300);
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

async function hostGame(browser: Browser, sinks: { all: Sink; tv: Sink; host: Sink }, names: string[], configure: (host: Page) => Promise<void>) {
  const host = await (await browser.newContext({ viewport: { width: 400, height: 860 } })).newPage();
  host.on("dialog", (d) => d.accept());
  recordApi(host, sinks.all);
  recordApi(host, sinks.host);
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

/**
 * Accepted answers and other players' answers never reach the TV or the host before the
 * reveal, and no response ever carries the secret parts of the round.
 */
function scanForLeaks(sinks: { all: Sink; tv: Sink; host: Sink }, secrets: Map<number, string[]>) {
  let roundViews = 0;
  for (const { url, body } of sinks.all) expect(body, url).not.toMatch(/"subs"|"answers":\[\[|"suggestions"|"promptKey"/);
  for (const { url, body } of [...sinks.tv, ...sinks.host]) {
    let j: State;
    try {
      j = JSON.parse(body);
    } catch {
      continue;
    }
    const v = j?.view ?? j;
    if (!v?.round?.blitz || v.reveal || v.round.kind === "suddenDeath") continue;
    roundViews++;
    for (const a of secrets.get(v.round.number) ?? []) expect(body, `${url} round ${v.round.number}: "${a}"`).not.toContain(`"${a}"`);
  }
  expect(roundViews).toBeGreaterThan(10);
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

/** Host review: approve the first answer, reject the second, then Done. */
async function review(code: string, host: Page, tv: Page, seen: { review: boolean }) {
  await expect(host.getByText(/Review these answers/)).toBeVisible();
  await expect(tv.getByText(/The host is checking/)).toBeVisible();
  const approve = host.getByRole("button", { name: /^Approve / });
  await approve.first().click();
  await expect(approve.first()).toHaveAttribute("aria-pressed", "true");
  if ((await host.getByRole("button", { name: /^Reject / }).count()) > 1) await host.getByRole("button", { name: /^Reject / }).nth(1).click();
  await host.getByRole("button", { name: /Done reviewing/ }).click();
  await waitForDb(code, (x) => x.phase !== "round");
  seen.review = true;
}

test("full Category Blitz game: host, TV and 3 players", async ({ browser }) => {
  test.setTimeout(420_000);
  const sinks = { all: [] as Sink, tv: [] as Sink, host: [] as Sink };
  const names = ["Ana", "Ben", "Cleo"];
  const { host, tv, phones, code } = await hostGame(browser, sinks, names, async (h) => {
    await h.getByRole("radio", { name: "⚡ Category Blitz" }).click();
    await expect(h.getByRole("radio", { name: "⚡ Category Blitz" })).toHaveAttribute("aria-checked", "true");
    await h.getByRole("radiogroup", { name: "Rounds" }).getByRole("radio", { name: "5", exact: true }).click();
    await expect(h.getByRole("radiogroup", { name: "Round timer (Category Blitz)" }).getByRole("radio", { name: "30s" })).toHaveAttribute("aria-checked", "true");
    await h.getByRole("button", { name: "Memes & Internet Culture", exact: true }).click();
    await expect(h.getByRole("button", { name: "Memes & Internet Culture", exact: true })).toHaveAttribute("aria-pressed", "false");
    await h.getByLabel("Category", { exact: true }).fill("Things in a fridge");
    await h.getByLabel("Letter", { exact: true }).fill("M");
    await h.getByLabel("Accepted answers (optional)").fill("Milk, Mayonnaise / Mayo, Mustard");
    await h.getByRole("button", { name: "Add prompt" }).click();
    await expect(h.getByText("3 accepted answers")).toBeVisible();
    await expect(h.getByText(/Estimated game length: about \d+ min/)).toBeVisible();
  });
  const st0 = await dbState(code);
  expect(st0.settings).toMatchObject({ mode: "blitz", rounds: 5, blitzSec: 30 });
  expect(st0.settings.blitzCategories).not.toContain("memes");
  expect(st0.settings.blitzCategories).toContain("hostPrompts");
  await expect(tv.getByText(/Game mode:/)).toContainText("Category Blitz");
  await expect(phones.Ana.getByText("⚡ Tonight: Category Blitz")).toBeVisible();
  await host.getByRole("link", { name: /Open Host Controls/ }).click();
  await host.getByRole("button", { name: /Start game/ }).click();

  const secrets = new Map<number, string[]>();
  const seen = { naturalTimer: false, refresh: false, freeze: false, suggestion: false, extra: false, review: false, zeroScreen: false, countsScreen: false, loserPick: false, final: false };
  let mainRounds = 0;
  let lastRound = 0;
  for (let step = 0; step < 120; step++) {
    const s = await waitForDb(code, (x) => ["round", "reveal", "loserPick", "dare", "ended"].includes(x.phase));
    if (s.phase === "ended") break;
    if (s.phase === "round") {
      const r = s.round;
      const b = r.blitz;
      expect(r.mode).toBe("blitz");
      const ids: string[] = r.participants;
      const accepted: string[] = b.answers.map((g: string[]) => g[0]);
      if (r.kind === "suddenDeath") {
        await addAndWait(code, phones[nameOf(s, ids[0])], ids[0], accepted[0]);
        await waitForDb(code, (x) => x.phase !== "round");
        continue;
      }
      if (b.stage === "review") {
        await review(code, host, tv, seen);
        continue;
      }
      if (r.number !== lastRound) {
        lastRound = r.number;
        mainRounds++;
        secrets.set(r.number, b.answers.flat());
        if (r.kind === "final") seen.final = true;
        await expect(tv.getByLabel(`the letter ${b.letter}`)).toBeVisible();
        await expect(tv.getByText(b.categoryLabel, { exact: true }).first()).toBeVisible();
      }
      const [a, bn, c] = ids;
      const L: string = b.letter;
      if (mainRounds === 1) {
        // Power-ups, answers shown only as "Added", a refresh mid-round, then let the timer run out.
        await phones.Cleo.getByRole("button", { name: /Freeze rival/ }).click();
        await phones.Cleo.getByRole("dialog").getByRole("button", { name: "Ana" }).click();
        await expect(phones.Ana.getByText(/FROZEN/)).toBeVisible();
        seen.freeze = true;
        await phones.Ben.getByRole("button", { name: /Get a Suggestion/ }).click();
        await expect(phones.Ben.getByText(/only you can see this/)).toBeVisible();
        const tip = (await dbState(code)).round.blitz.suggestions[bn];
        await expect(phones.Ben.getByText(`“${tip}”`)).toBeVisible();
        await expect(phones.Ana.getByText(/only you can see this/)).toHaveCount(0);
        seen.suggestion = true;
        await phones.Cleo.getByRole("button", { name: /Extra Time/ }).click();
        await waitForDb(code, (x) => x.round.blitz.extra[c] === 5000);
        seen.extra = true;
        await addAndWait(code, phones.Ana, a, accepted[0]);
        await addAndWait(code, phones.Ana, a, accepted[1]);
        await addAndWait(code, phones.Ana, a, `Zz nope`);
        await expect(phones.Ana.getByText(/· Added/)).toHaveCount(3);
        await expect(phones.Ana.getByLabel("3 of 20 answers")).toBeVisible();
        await addAndWait(code, phones.Ben, bn, accepted[0]);
        await addAndWait(code, phones.Ben, bn, tip === accepted[0] ? accepted[2] : tip);
        await addAndWait(code, phones.Cleo, c, `${L}uper mystery thing`);
        await addAndWait(code, phones.Cleo, c, `${L}omething odd`);
        await expect(tv.getByLabel("2 answers added").first()).toBeVisible();
        await phones.Ana.reload();
        await expect(phones.Ana.getByText(/· Added/)).toHaveCount(3);
        await expect(phones.Ana.getByRole("textbox", { name: "Your answer" })).toBeFocused();
        await tv.reload();
        await tv.getByRole("button", { name: /Start TV/ }).click();
        await expect(tv.getByLabel(`the letter ${L}`)).toBeVisible();
        await host.reload();
        await expect(host.getByText(/answers so far/)).toBeVisible();
        seen.refresh = true;
        await waitForDb(code, (x) => x.phase !== "round" || x.round.blitz.stage !== "play", 45_000);
        seen.naturalTimer = true;
        continue;
      }
      if (mainRounds === 2) {
        // Cleo adds nothing: 0 points.
        await addAndWait(code, phones.Ana, a, accepted[3]);
        await addAndWait(code, phones.Ben, bn, accepted[4]);
      } else {
        for (const [i, id] of ids.entries()) await addAndWait(code, phones[nameOf(s, id)], id, accepted[i] ?? `${L}${i}`);
      }
      await expireRound(code);
      await waitForDb(code, (x) => x.phase !== "round" || x.round.blitz.stage !== "play");
      continue;
    }
    if (s.phase === "reveal") {
      if (s.round.kind !== "suddenDeath" && s.round.endReason !== "skipped") {
        await expect(tv.getByLabel("Round results")).toBeVisible();
        for (const n of names) {
          const res = s.round.blitz.results?.players[s.players.find((p: { nickname: string }) => p.nickname === n).id];
          if (!res) continue;
          if (res.points === 0) {
            await expect(phones[n].getByText("YOU'RE OUT 😂")).toBeVisible();
            seen.zeroScreen = true;
          } else {
            await expect(phones[n].getByText(`+${res.points}`, { exact: true })).toBeVisible();
            await expect(phones[n].getByText(/valid ·/)).toBeVisible();
            seen.countsScreen = true;
          }
        }
      }
      await host.getByRole("button", { name: /Next|Finish game|Show final results|Next sudden-death word/ }).first().click();
      await waitForDb(code, (x) => x.seq !== s.seq);
      continue;
    }
    if (s.phase === "loserPick") {
      seen.loserPick = true;
      expect(s.loserPick.kind).toBe("category");
      await expect(tv.getByText(/chooses the next category/)).toBeVisible();
      const picker = nameOf(s, s.loserPick.playerId);
      await phones[picker].getByRole("button", { name: /TV Shows|Movies|Music Artists|Food|College Life|Places|Animals|Host's Prompts/ }).first().click();
      await waitForDb(code, (x) => x.phase === "round");
      continue;
    }
    if (s.phase === "dare") {
      await host.getByRole("button", { name: /Continue/ }).click();
      await waitForDb(code, (x) => x.phase !== "dare");
    }
  }

  expect(mainRounds).toBe(5);
  expect(seen).toMatchObject({ naturalTimer: true, refresh: true, freeze: true, suggestion: true, extra: true, review: true, zeroScreen: true, countsScreen: true, final: true });
  const end = await checkScores(code, tv, phones);
  expect(end.history.every((h: { mode: string }) => h.mode === "blitz")).toBe(true);
  await expect(tv.getByText("Blitz Machine")).toBeVisible();
  await expect(tv.getByText("Original Thinker")).toBeVisible();
  for (const hidden of ["Speed Demon", "Hint Addict", "Emoji Whisperer", "Most Lives Lost", "Crowd Favorite", "Mastermind"]) await expect(tv.getByText(hidden)).toHaveCount(0);
  scanForLeaks(sinks, secrets);
});

test("Mixed game with Hangman and Category Blitz on one leaderboard", async ({ browser }) => {
  test.setTimeout(300_000);
  const sinks = { all: [] as Sink, tv: [] as Sink, host: [] as Sink };
  const names = ["Ana", "Ben", "Cleo"];
  const { host, tv, phones, code } = await hostGame(browser, sinks, names, async (h) => {
    await h.getByRole("radio", { name: "🔀 Mixed" }).click();
    await h.getByRole("button", { name: "⚡ Category Blitz", exact: true }).click();
    await expect(h.getByRole("button", { name: "⚡ Category Blitz", exact: true })).toHaveAttribute("aria-pressed", "true");
    await h.getByRole("button", { name: "😀 Emoji Decode", exact: true }).click();
    await expect(h.getByRole("button", { name: "😀 Emoji Decode", exact: true })).toHaveAttribute("aria-pressed", "false");
    await h.getByRole("radiogroup", { name: "Rounds" }).getByRole("radio", { name: "5", exact: true }).click();
    await expect(h.getByRole("radiogroup", { name: "Rounds" }).getByRole("radio", { name: "5", exact: true })).toHaveAttribute("aria-checked", "true");
  });
  expect((await dbState(code)).settings.mixedModes).toEqual(["hangman", "blitz"]);
  await expect(phones.Ana.getByText("🔀 Tonight: Hangman + Category Blitz")).toBeVisible();
  await host.getByRole("link", { name: /Open Host Controls/ }).click();
  await host.getByRole("button", { name: /Start game/ }).click();

  const secrets = new Map<number, string[]>();
  const seen = { review: false };
  const pageOf = (s: State, id: string) => phones[nameOf(s, id)];
  for (let step = 0; step < 120; step++) {
    const s = await waitForDb(code, (x) => ["round", "reveal", "loserPick", "dare", "ended"].includes(x.phase));
    if (s.phase === "ended") break;
    if (s.phase === "round") {
      const r = s.round;
      const parts: string[] = r.participants;
      if (r.mode === "blitz") {
        const b = r.blitz;
        if (b.stage === "review") {
          await review(code, host, tv, seen);
          continue;
        }
        secrets.set(r.number, b.answers.flat());
        await expect(tv.getByLabel(`the letter ${b.letter}`)).toBeVisible();
        const accepted: string[] = b.answers.map((g: string[]) => g[0]);
        await addAndWait(code, pageOf(s, parts[0]), parts[0], accepted[0]);
        await addAndWait(code, pageOf(s, parts[1]), parts[1], accepted[0]);
        await addAndWait(code, pageOf(s, parts[2]), parts[2], `${b.letter}omething made up`);
        await expireRound(code);
        await waitForDb(code, (x) => x.phase !== "round" || x.round.blitz.stage !== "play");
        continue;
      }
      for (const l of lettersOf(r.answer)) await guessAndWait(code, pageOf(s, parts[0]), parts[0], l);
      if (parts[1]) for (const l of wrongLetters(r.answer).slice(0, 6)) await guessAndWait(code, pageOf(s, parts[1]), parts[1], l);
      if (parts[2]) for (const l of lettersOf(r.answer)) await guessAndWait(code, pageOf(s, parts[2]), parts[2], l);
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
  expect(end.history.map((h: { mode: string }) => h.mode)).toEqual(["hangman", "blitz", "hangman", "blitz", "hangman"]);
  const blitzPoints = end.history
    .filter((h: { mode: string }) => h.mode === "blitz")
    .flatMap((h: { results: Record<string, { points: number }> }) => Object.values(h.results).map((x) => x.points));
  expect(blitzPoints.some((p: number) => p >= 10)).toBe(true);
  expect(seen.review).toBe(true);
  scanForLeaks(sinks, secrets);
});
