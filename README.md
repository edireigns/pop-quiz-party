# 🎈 Pop Quiz Party

A neon game-show word-guessing party game for ~15 friends (up to 30).
The **TV** shows a QR code, the puzzle and a live leaderboard. Everyone solves the **same puzzle at the same time on their own phone**. No accounts, no app installs, and a host can spin up a new game any time.

Three game modes, one shared leaderboard:

- **🔤 Hangman** (default): guess letters. Each wrong letter pops one of your six neon balloons.
- **😀 Emoji Decode**: the TV shows an emoji clue like 🦁👑, and you type the answer on your phone. You get 3 attempts.
- **🔀 Mixed**: alternates Hangman and Emoji Decode every round, starting with Hangman.

Built with **Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · Supabase (Postgres + Realtime) · Vercel**.

---

## Contents

1. [What's in the box](#whats-in-the-box)
2. [Quick start (local)](#quick-start-local)
3. [Supabase setup](#supabase-setup)
4. [Deploying to Vercel](#deploying-to-vercel)
5. [Editing word lists & dares](#editing-word-lists--dares)
6. [How to host a game night](#how-to-host-a-game-night)
7. [Game modes](#game-modes)
8. [Rules & scoring](#rules--scoring)
9. [Architecture & security](#architecture--security)
10. [Testing](#testing)
11. [Final checklist](#final-checklist)

Having trouble? Jump to [Troubleshooting](#troubleshooting) or open `/api/health` on your running site.

---

## What's in the box

| Screen | URL | Who |
| --- | --- | --- |
| Landing | `/` | Anyone: **Host a new game** or **Join with a code** |
| Host Prep | `/host/CODE/prep#k=SECRET` | Host picks the **Game Mode** and sets up rounds, timer, categories, difficulty, content level, friend-written words, Dare Wheel, Inside Jokes and custom dares, and reviews friend submissions |
| Host Controls | `/host/CODE#k=SECRET` | Host's phone: Game Mode (in the lobby and after a game), Start, Next, Pause/Resume, Skip, **Drop Hint** (Emoji Decode), Remove player, Re-spin dare, End, Play Again. The host doesn't play. |
| TV Display | `/tv/CODE` | Laptop on HDMI at 1920×1080: QR lobby, puzzle, leaderboard + rival tracker, reactions, dare wheel, podium & awards, sound with mute, full-screen button |
| Player Phone | `/play/CODE` | Join with a nickname. Hangman: on-screen keyboard (a physical keyboard works too) and hint. Emoji Decode: large answer box with a **Show clue** button. Both: power-ups and reactions. |

Game-night features: Power-ups (Freeze a rival / Reveal a letter / Extra Life, 2 uses per game), Loser Picks, Double-Points Final, Sudden Death, Dare Wheel, Emoji Reactions, End-of-Night Awards (Speed Demon, Most Lives Lost, Hint Addict, Comeback Kid, Master Stumper, Emoji Whisperer), optional friend-written words, and a private **Inside Jokes** category.

---

## Quick start (local)

You need **Node 20.9+** and **a Postgres database**. The game can't host a room without one.

**1. Install and create your env file**

```bash
npm install
cp .env.example .env.local
```

On Windows PowerShell, use `copy .env.example .env.local` instead of `cp`.

**2. Get a database.** Pick **one** option and put its connection string in `DATABASE_URL` in `.env.local`:

| Option | What to do | `DATABASE_URL` |
| --- | --- | --- |
| **A. Use your Supabase project** (nothing to install) | Supabase → **Connect** → *Transaction pooler* | `postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres` |
| **B. Docker** | `docker run -d --name pqp-db -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=popquiz -p 5432:5432 postgres:16` | `postgres://postgres:postgres@localhost:5432/popquiz` (the default) |
| **C. Postgres installed locally** | Start it, then `createdb popquiz` | `postgres://<user>:<password>@localhost:5432/popquiz` |

Connections to remote hosts like Supabase are encrypted automatically.

**3. Create the tables, then start the app**

```bash
npm run db:migrate
```

```bash
npm run dev
```

Open http://localhost:3000 and click **Host a new game**. If something isn't set up, the page tells you what's wrong. You can also open **http://localhost:3000/api/health** for a full setup check.

To try it alone, open the TV link in a second window and the join link in two or three private windows (one per "phone").

**Playing locally with real phones (same Wi-Fi)**

```bash
npm run dev:lan
```

Then open the TV page on the laptop **using the laptop's network address**, not `localhost`. Next.js prints it as `Network:`, for example `http://192.168.1.20:3000/tv/ABCDE`. The QR code will use that address so phones can reach it.

- Phones can't open `localhost`. If `NEXT_PUBLIC_SITE_URL` is `localhost`, the QR code automatically uses the address you opened the TV page from.
- If phones still can't connect, allow Node.js through your computer's firewall, and make sure the laptop and the phones are on the same Wi-Fi network (not a guest network).

Without Supabase keys, live updates locally use a built-in Server-Sent Events channel. On Vercel, set up Supabase Realtime (below) for instant updates. Without it, the game still works but refreshes every 2–3 seconds.

### Troubleshooting

Open **`/api/health`**, locally or on your deployed site. It checks every setting and says what's wrong, without showing any secret values.

| You see | Fix |
| --- | --- |
| "DATABASE_URL isn't set" | Create `.env.local` from `.env.example` and restart `npm run dev`. On Vercel, add the variable and **redeploy**. |
| "Can't reach the database" | Postgres isn't running, or the host/port is wrong. On Supabase, use the **Transaction pooler** string (port 6543), not `db.<ref>.supabase.co`. |
| "rejected the password" | Copy the connection string again. Passwords containing `@ : / #` must be URL-encoded. |
| "database … doesn't exist" | `createdb popquiz`, or fix the name at the end of `DATABASE_URL`. |
| "tables aren't set up yet" | `npm run db:migrate`, or paste `supabase/migrations/0001_init.sql` into the Supabase SQL Editor. |
| Phones stuck on "Loading…" locally | Use `npm run dev:lan` and open the TV page through the network address (see above). |
| QR code opens `localhost` on the live site | Set `NEXT_PUBLIC_SITE_URL` in Vercel and **redeploy**. |
| "Too many requests" | You created a lot of rooms quickly. Wait a few minutes. |

### Environment variables

| Variable | Where | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SITE_URL` | public | The public URL, e.g. `https://pop-quiz-party.vercel.app` (no trailing slash). Used for QR codes and join links. **Read at build time**, so redeploy after changing it. |
| `DATABASE_URL` | server only | Postgres connection string. On Supabase use the **Transaction pooler** string (port 6543). |
| `NEXT_PUBLIC_SUPABASE_URL` | public | `https://<project>.supabase.co`, used to subscribe to Realtime. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public | Supabase anon key. It can only *listen* to "state changed" pings and can't read or write any table (RLS). |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only** | Used by API routes to broadcast pings. Never prefix with `NEXT_PUBLIC_`. |
| `CRON_SECRET` | server only | Long random string. Vercel Cron sends it to `/api/cron/cleanup`. |

**Never commit `.env.local`.** It is git-ignored, and only `.env.example` is tracked.

---

## Supabase setup

1. **Create a project** at [supabase.com](https://supabase.com). Pick a region close to your Vercel region.
2. **Create the schema.** Either:
   - open **SQL Editor**, paste [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) and run it, **or**
   - run `DATABASE_URL="<your connection string>" npm run db:migrate` locally.

   This creates `rooms` and `rate_limits`, **enables Row Level Security with no policies** (so the anon/authenticated API roles can't touch them), revokes those roles' access, and adds the `hit_rate_limit()` and `cleanup_expired_rooms()` functions.
3. **Get the connection string:** Project → **Connect** → *Connection string* → **Transaction pooler** (port `6543`). Replace `[YOUR-PASSWORD]`. This becomes `DATABASE_URL`. The app already disables prepared statements for the pooler.
4. **Get the API keys:** Project Settings → **API**: copy the Project URL (`NEXT_PUBLIC_SUPABASE_URL`), the `anon` key (`NEXT_PUBLIC_SUPABASE_ANON_KEY`) and the `service_role` key (`SUPABASE_SERVICE_ROLE_KEY`, kept secret).
5. **Realtime:** the game uses **Broadcast** on public channels named `room-<uuid>`. Under Project Settings → **Realtime**, make sure Realtime is enabled and that public channels are allowed ("Allow public access" on / "private channels only" off). No table replication is needed. Broadcast messages carry only a sequence number, never game data.
6. **(Recommended) hourly cleanup inside Supabase.** Vercel's free cron runs once a day, and the API already treats rooms as deleted exactly 24 h after their game ends. To also purge the rows hourly, enable the `pg_cron` extension (Database → Extensions) and run:

   ```sql
   select cron.schedule('pqp-cleanup', '7 * * * *', 'select public.cleanup_expired_rooms()');
   ```

**Data retention:** a room, with its players, scores, friend-written words, Inside Jokes and custom dares (all stored inside the room), is deleted **24 hours after the game ends**. Rooms that never finish are removed after **7 days** without activity, so you can still prepare a game days ahead. The built-in word bank lives in the code and is never deleted.

---

## Deploying to Vercel

1. Push this repository to GitHub.
2. In Vercel: **Add New… → Project → import the repo.** The framework preset is detected as Next.js, and the defaults are fine.
3. Add the **Environment Variables** above for *Production* (and *Preview* if you like):
   - `NEXT_PUBLIC_SITE_URL` = your production URL, e.g. `https://pop-quiz-party.vercel.app`
   - `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`
4. **Deploy.** If you add a custom domain later, update `NEXT_PUBLIC_SITE_URL` and **redeploy** so QR codes point to it.
5. `vercel.json` registers a daily cron job for `/api/cron/cleanup`. Vercel automatically sends `Authorization: Bearer $CRON_SECRET`.
6. Optional: under Settings → Functions, set the function region to match your Supabase region for the lowest latency.

Smoke test after deploying: host a game, open `/tv/CODE` on a laptop, scan the QR code with your phone, join, and start.

---

## Editing word lists & dares

### Built-in words: [`src/data/words.ts`](src/data/words.ts)

Each line is one entry:

```ts
w("Breaking Bad", "A chemistry teacher goes very wrong", "easy"),
w("Pulp Fiction", "Royale with cheese", "hard", "pg13"),
//  answer          hint                          difficulty  content (default "clean")
```

- `difficulty`: `"easy" | "medium" | "hard"`. `content`: `"clean"` (default) or `"pg13"`. PG-13 entries only appear when the host picks PG-13.
- Answers use plain **A–Z letters, digits, spaces and basic punctuation** (`. , ' ! ? & : -`). Spaces, punctuation **and digits** are revealed automatically; players guess letters only.
- Categories: TV Shows, Gen Z Phrases, Movies, Music Artists, Memes & Internet Culture, Food, College Life, Mixed. **No video game or sports categories.**
- `npm test` validates the file: at least 40 entries per category, no duplicates, valid characters, the hint doesn't contain the answer, and Clean entries pass the Clean filter.
- The word bank is `server-only`: it never ships to browsers (the e2e test checks this).
- To add a category: add it to `CATEGORY_IDS` in `src/lib/game/types.ts`, to `src/data/categories.ts` (label and emoji), and to `WORD_BANK`.

### Emoji Decode clues: [`src/data/clues.ts`](src/data/clues.ts)

Each line is one clue, grouped by category (the section it's in is its category):

```ts
c("🦁👑", "The Lion King", ["Lion King"], "easy"),
c("🍺🏓", "Beer Pong", [], "medium", "pg13"),
//  clue    answer         accepted alternates  difficulty  content (default "clean")
```

- **clue:** emojis and spaces only. Stick to widely supported emojis (Emoji 13 or older) so every phone and TV shows them.
- **alternates:** other names to accept, such as `"Spiderman"` or `"Fries"`. You don't need entries for case, accents, punctuation, extra spaces, a leading "the/a/an" or small typos. Those are handled automatically (see [Answer matching](#answer-matching)).
- **difficulty / content:** same meaning as in the word bank.
- `npm test` checks the file:
  - 30+ clues per category, all of them emoji-only.
  - No duplicate answers or clues.
  - The answer and every alternate are accepted.
  - Clean answers pass the Clean filter.
  - No Emoji 14+ characters.
- Like the word bank, the clue bank is `server-only` and never ships to browsers.

### Starter dares: [`src/data/dares.ts`](src/data/dares.ts)

Each `d("text", "clean" | "pg13")` entry is one dare. Keep dares **safe, consensual and optional**: no alcohol, nothing physically risky, nothing degrading. Hosts can also add custom dares on the Prep screen.

### Content filter: [`src/lib/moderation.ts`](src/lib/moderation.ts)

The filter has two ROT13-encoded lists. `SEVERE` (slurs and explicit terms) is blocked at **both** content levels. `MILD` (everyday profanity) is blocked only in **Clean** mode. To add a term: `echo word | tr 'a-z' 'n-za-m'` and append the result. The filter normalizes leetspeak, spaced-out letters and repeated letters.

---

## How to host a game night

1. On your phone, go to the site and tap **Host a new game**. **Bookmark the private host link** (it ends in `#k=…`). That link is your only key to the game, and it also brings you back if you disconnect.
2. On Host Prep, pick the **Game Mode** (see below), then choose rounds (5/10/15/20), the timer (45/60/90 s), categories, difficulty, Clean or PG-13, friend-written words, and the Dare Wheel (every 2/3/5 rounds). You can also add Inside Jokes and custom dares. This can be done days ahead.
3. On the laptop connected to the TV, open the **TV display link** and click **▶ Start TV**. This enables sound and goes full screen.
4. Friends scan the QR code (or visit `/join` and type the code), then pick nicknames. If friend-written words are on, they submit one each, and you can remove any on Host Prep.
5. Open **Host Controls** and press **Start**. After each round the TV reveals the answer and points, and the game waits for you to tap **Next**.
6. At the end the TV shows the podium and the awards. **Play Again** resets scores and keeps the room and the players.

Late joiners start with 0 points from the next round. Phones that refresh or reconnect keep their score and progress.

---

## Game modes

**Choosing a mode:**
- Pick it at the top of **Host Prep → Game settings**, or with the **Game mode** picker on Host Controls in the lobby.
- After a game ends you can switch modes, then tap **Play Again**. Settings can be changed in the lobby and on the game-over screen, but not mid-game.
- The TV lobby and every phone show which mode is on.
- Every other setting applies to all modes: rounds, timer, categories, difficulty, content level, friend-written words and the Dare Wheel.

| Mode | What happens |
| --- | --- |
| 🔤 Hangman (default) | Unchanged from before: guess letters before your 6 balloons pop. |
| 😀 Emoji Decode | Every round is an emoji clue. |
| 🔀 Mixed | Round 1 Hangman, round 2 Emoji Decode, round 3 Hangman, and so on. Answers never repeat across the two modes. |

**An Emoji Decode round:**
1. The TV shows a big emoji clue, the category, the timer and how many players have answered. The leaderboard beside it shows each player's attempts left and whether they've solved it, but never their guesses.
2. Each player types answers on their phone, with up to 3 attempts. Each attempt is marked correct or not, without revealing the answer. The phone keeps your eyes on the TV, but **Show clue** brings the emojis up on the phone for anyone who can't see the screen well.
3. While the round runs, the host can tap **Drop Hint** up to twice, and everyone sees it:
   - Hint 1 is the first letter.
   - Hint 2 is the number of words and letters.
4. The round ends when the timer runs out or everyone has finished. The TV reveals the answer, how many players got it, the fastest correct player and each player's points. Then it waits for **Next**.

Solving shows the usual celebration. Running out of attempts shows **YOU SUCK 😂** in PG-13 mode, or **YOU'RE OUT 😂** in Clean mode. Reactions stay available while you wait.

**Custom clues:**
- **Inside Jokes:** in Emoji Decode or Mixed, Host Prep has an extra form for an emoji clue, its answer and optional comma-separated alternates. Clues must be emojis and spaces only.
- **Friend-written words:** players add an emoji clue alongside their word. It's required in Emoji Decode. In Mixed it's optional, and a word without a clue is only used in Hangman rounds. Host review, author sit-out, content filtering and +15 per stumped player all work as before.

**Existing features in Emoji Decode:**
- **Power-ups:**
  - Freeze locks a rival's answer box for 5 s.
  - Reveal privately shows you one letter of the answer.
  - Extra Life gives you one more attempt.
  - Same limit as before: 2 uses per game.
- **Loser Picks** and the **Dare Wheel** work the same as in Hangman.
- **Sudden Death** uses the game's mode, and Mixed uses Hangman. In Emoji Decode Sudden Death, one wrong answer eliminates you and the first correct answer wins.
- **Awards:**
  - Wrong attempts count toward Most Lives Lost.
  - Hint Addict only appears when the game had Hangman rounds.
  - **Emoji Whisperer** goes to the most correct Emoji Decode answers.

---

## Rules & scoring

| Event | Points |
| --- | --- |
| Correct letter (each distinct letter) | **+10** |
| Solving the word | **+50** |
| Each balloon (life) left when solving | **+10** |
| Speed bonus | up to **+30**, scaled linearly by time remaining |
| Revealing the hint | **−20** |
| Friend-word author, per player who fails their word | **+15** |
| Final round | every point earned is **doubled** (the hint penalty isn't) |

Other rules:

- Scores never go below 0.
- 6 lives per round. Wrong letters are crossed out and pop a balloon.
- The round ends when the timer runs out or every active player has finished.
- **Skip** ends the word with no points for anyone (any power-ups used are refunded), and the round still counts.
- **Power-ups:** 2 uses per player per game, shared between the three types.
  - **Freeze:** locks a rival's keyboard for 5 s, enforced by the server. A player can only be frozen once per round.
  - **Reveal:** shows one hidden letter, with no letter points.
  - **Extra Life:** adds one balloon.
- **Loser Picks:** the active player with the lowest score that round picks the next category within 15 s, otherwise it's random. Ties are broken randomly. This is skipped when the next round is a friend-written word or after a skip.
- **Sudden Death:** if first place is tied after the final round, only the tied players play. One wrong guess eliminates a player, and the first to solve wins. If everyone is eliminated, another word is played.
- **Dare Wheel:** the player in last place overall spins the wheel. They can pass, and the host can re-spin. It auto-spins after 15 s.
- **Friend-written words** are used for about ⅓ of the rounds (`round(rounds / 3)` of them, if enough were submitted). The author sits out that round and is revealed only after it ends. Unused submissions are never shown to anyone except the host.

### Emoji Decode scoring

| Event | Points |
| --- | --- |
| Correct answer | **+100** |
| Speed bonus | up to **+100**, scaled linearly by time remaining |
| Each host hint revealed before you answered | **−25** off that maximum |
| Wrong or missing answer | **0** |
| Final round | doubled, as in Hangman |

Scores can't go below 0, and both modes add to one shared leaderboard.

### Answer matching

Answers are checked on the server:
- Case, accents, punctuation and extra spaces are ignored, and so is a leading "the", "a" or "an". For example, `spiderman` matches *Spider-Man* and `lion king` matches *The Lion King*.
- Any listed alternate is accepted.
- Typos are forgiven by answer length, counting letters and digits only:
  - Under 4 characters: must match exactly (`Up`, `BTS`).
  - 4–8 characters: one typo.
  - Longer: two typos.
- A typo is a missing, extra or wrong letter, or two neighbouring letters swapped. Close-but-wrong guesses such as *Shark* for *Shrek* or *Toy* for *Toy Story* are rejected, and tests cover these cases.

---

## Architecture & security

```
Phones / TV / Host ──HTTPS──▶ Next.js API routes (Vercel) ──SQL (row lock)──▶ Supabase Postgres
        ▲                               │
        └──── Supabase Realtime ◀───────┘  "room changed, seq=N" (no game data)
```

- **No database migration for Emoji Decode.** Room state is one JSONB document, so the new fields are just extra keys with defaults. Rooms saved by an older version are upgraded in memory when loaded (`upgradeState`), so existing data is never rewritten or lost. `supabase/migrations/0001_init.sql` is still the only migration.
- **The server is the source of truth.** All game state for a room is one JSONB document, changed only inside `SELECT … FOR UPDATE` transactions by a pure, unit-tested engine (`src/lib/game/engine.ts`). That covers rounds, guesses, timers, power-ups and scores.
- **Timers without a long-running server.** The server stores deadlines. Expiry, Loser Picks timeouts and dare auto-spins are applied lazily on any request, and clients wake up at each deadline, so nothing waits on a background process. Pausing freezes the remaining time on the server.
- **The answer never leaves the server early.** Clients only receive role-specific *views* (`src/lib/game/views.ts`):
  - the TV gets the blank pattern;
  - each phone gets only the letters it has earned;
  - the hint goes only to the player who paid for it;
  - the answer appears only after the round ends.

  Realtime messages contain only a sequence number. Unit, integration and e2e tests scan every view and every network response for leaks, and also check that the word bank isn't in the JS bundle.
- **No accounts.**
  - The host gets a 256-bit secret token, which lives in the URL **fragment** so it's never sent in a request URL or logged. Players get a per-room token stored in `localStorage`.
  - Only SHA-256 hashes are stored, and they're compared in constant time.
  - Duplicate nicknames (case-insensitive) are blocked per room, and nicknames go through the content filter.
- **RLS:** enabled on every table with no policies, and API roles are revoked. The browser's anon key can only listen to broadcast pings. The service role key and the database URL stay server-side.
- **Rate limits:**
  - Room creation and joins are limited per IP and per room, in Postgres so the limit holds across serverless instances.
  - Every API route also has a per-instance in-memory limiter, applied per client so a whole party behind one Wi-Fi IP isn't blocked.
  - Guesses (12 per second) and reactions (8 per 10 s, minimum 600 ms gap) are limited per player inside the engine.
- **Isolation:** every row, token and realtime channel is scoped to one room, so any number of games can run at once.
- **Clear states:** reconnecting banner, invalid room code, game already ended, removed from game, host link needed.
- **Accessibility:**
  - Large tap targets (buttons ≥ 48 px, keyboard keys 56 px tall), with no horizontal scrolling on phones.
  - Colors meet WCAG AA contrast on the dark stage.
  - Screen-reader labels are provided for the puzzle, balloons, timer and keyboard keys.
  - Keyboard focus rings are visible, and `prefers-reduced-motion` disables flying, shaking and sweeping animations.
- **Sound** is synthesized in code with the Web Audio API (original and license-free), plays on the TV only, and has a mute toggle.

Key folders:

```
src/app/                  pages + API routes (/api/rooms/...)
src/lib/game/             engine, scoring, phrase handling, views, awards (pure, tested)
src/lib/server/           db, auth tokens, rate limits, realtime broadcast, room locking
src/lib/client/           useRoom hook (realtime + polling + reconnect), storage
src/components/           TV, player, host and shared UI
src/data/                 word bank, categories, dares
supabase/migrations/      SQL schema
tests/unit|integration|e2e, scripts/load-test.ts
```

---

## Testing

```bash
# unit + integration (integration uses TEST_DATABASE_URL, default postgres://postgres:postgres@localhost:5432/popquiz_test)
createdb popquiz_test && DATABASE_URL=postgres://postgres:postgres@localhost:5432/popquiz_test npm run db:migrate
npm test

# multi-browser end-to-end game (host + TV + 3 phones); builds and starts its own server on :3200
createdb popquiz_e2e
npm run test:e2e

# load test: 2 concurrent games × 15 players against a running server (Mixed mode by default)
BASE_URL=http://localhost:3000 DATABASE_URL=postgres://... npm run load-test
#   GAMES=2 PLAYERS=15 ROUNDS=5 MODE=mixed by default (MODE=hangman|emoji|mixed)
#   With DATABASE_URL, some bots peek at the current Emoji answer (test oracle) so correct answers are exercised too

npm run check   # lint + typecheck + tests + production build
```

CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs all of the above except the load test, against a Postgres service.

Scripts such as `db:migrate` and `load-test` read `.env.local` themselves, and variables already set in your shell take priority.

---

## Final checklist

| Definition of done | Where it's verified |
| --- | --- |
| Scoring, phrase handling, answer protection, friend-word author rules, power-ups, final-round scoring, tie handling | `tests/unit/*.test.ts` (engine, scoring, text, views) + `tests/integration/*.test.ts` |
| Multi-browser full game with host, TV and multiple players | `tests/e2e/full-game.spec.ts` |
| 15 concurrent players, full game, scores match on server, phones and TV | `npm run load-test` (also checks that the round history adds up to every score) |
| Refreshing a player, host or TV mid-round restores the correct state | e2e (round 2 refreshes all three) + integration "restores progress on refresh" |
| Answer not visible in dev tools or network traffic before the round ends | unit view scans, integration API scans, e2e scan of every `/api` response + JS bundle |
| Works start to finish with only built-in words, friend words off | e2e full game asserts every round's source is `builtin` |
| Two games at once without interference | integration "keeps two games fully separate" + load test runs 2 games concurrently |
| Production build passes; README explains configuration and deployment | `npm run build`, this file |
| **Emoji Decode:** Hangman unchanged when selected | all original Hangman tests still pass unchanged |
| **Emoji Decode:** mode selection, answer matching, attempts, hint penalties, scoring, power-ups, custom clues, answer protection | `tests/unit/emoji.test.ts`, `answers.test.ts`, `clues.test.ts`, `views.test.ts` + `tests/integration/emoji-api.test.ts` |
| **Emoji Decode:** full games in Emoji Decode and Mixed mode (host, TV, 3 phones) | `tests/e2e/modes.spec.ts` |
| **Emoji Decode:** 15 concurrent players in Mixed mode, scores match on server, phones and TV | `MODE=mixed npm run load-test` |
| **Emoji Decode:** rooms saved before the update keep working | unit + integration "rooms saved before Emoji Decode existed" |

Before game night, confirm:

- [ ] Supabase project created and migration run
- [ ] Realtime public channels allowed
- [ ] All six env vars set in Vercel and deployed
- [ ] `NEXT_PUBLIC_SITE_URL` matches the live domain (redeploy after changing)
- [ ] `/api/cron/cleanup` shows up under Vercel → Settings → Cron Jobs (and/or the `pg_cron` job is scheduled)
- [ ] Test run: host link bookmarked, TV link on the laptop, a phone scans the QR code and joins
