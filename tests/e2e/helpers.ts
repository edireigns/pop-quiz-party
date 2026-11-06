import type { Browser, Page } from "@playwright/test";
import postgres from "postgres";

// One lazily-created connection per worker; spec files share it, and closeDb() lets the next file reconnect.
let client: ReturnType<typeof postgres> | null = null;
function conn() {
  client ??= postgres(process.env.E2E_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/popquiz_e2e", {
    prepare: false,
    max: 2,
    onnotice: () => {},
  });
  return client;
}
export const sql = {
  end: async () => {
    const c = client;
    client = null;
    await c?.end();
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function dbState(code: string): Promise<any> {
  const rows = await conn()`select state from rooms where code = ${code}`;
  return rows[0]?.state;
}

export function lettersOf(answer: string) {
  return [...new Set(answer.normalize("NFD").replace(/[^A-Za-z]/g, "").toUpperCase())];
}

export function wrongLetters(answer: string) {
  const set = new Set(lettersOf(answer));
  return "ZQXJKVWYFBGPMHUCDLRSNTOIAE".split("").filter((l) => !set.has(l));
}

export async function waitForDb(code: string, pred: (s: any) => boolean, timeout = 20_000) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const s = await dbState(code);
    if (s && pred(s)) return s;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("waitForDb timed out");
}

/** Records every /api JSON body a page receives, so tests can scan for leaks. */
export function recordApi(page: Page, sink: { url: string; body: string }[]) {
  page.on("response", async (res) => {
    if (!res.url().includes("/api/rooms")) return;
    if (res.url().includes("/events")) return;
    try {
      sink.push({ url: res.url(), body: await res.text() });
    } catch {}
  });
}

export async function newPhone(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  return ctx.newPage();
}

/** Make the current round's timer run out now (keeps long e2e games fast). */
export async function expireRound(code: string) {
  await conn()`update rooms set state = jsonb_set(state, '{round,deadline}', to_jsonb(${Date.now() - 1}::bigint)) where code = ${code}`;
}
