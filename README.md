# 🎈 Pop Quiz Party

A neon game-show word-guessing party game for ~15 friends (up to 30).
The **TV** shows a QR code, the puzzle and a live leaderboard. Everyone solves the **same puzzle at the same time on their own phone**. No accounts, no app installs, and a host can spin up a new game any time.

Six game modes, one shared leaderboard:

- **🔤 Hangman** (default): guess letters. Each wrong letter pops one of your six neon balloons.
- **😀 Emoji Decode**: the TV shows an emoji clue like 🦁👑, and you type the answer on your phone. You get 3 attempts.
- **👑 Most Likely To**: the TV asks "Who is most likely to…?" and everyone secretly votes for a player. You score by reading the room. Needs 3+ players.
- **🕵️ Who Wrote It?**: everyone anonymously answers a question on their phone, then guesses who wrote each answer shown on the TV. Fool your friends for points. Needs 4+ players.
- **⚡ Category Blitz**: the TV shows a category and a letter ("Movies starting with S"); type as many answers as you can before time runs out. Answers nobody else thought of score extra.
- **🔀 Mixed**: rotates through the modes you choose, one per round. By default it alternates Hangman and Emoji Decode, starting with Hangman.

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
| Host Prep | `/host/CODE/prep#k=SECRET` | Host picks the **Game Mode** (and which modes Mixed includes) and sets up rounds, timers, categories or question packs, difficulty, content level, friend-written words, Dare Wheel, Inside Jokes, custom questions and custom dares, and reviews friend submissions |
| Host Controls | `/host/CODE#k=SECRET` | Host's phone: Game Mode (in the lobby and after a game), Start, Next, Pause/Resume, Skip, **Drop Hint** (Emoji Decode), Skip question (Most Likely To, Who Wrote It?), Skip answer / Remove upcoming answer (Who Wrote It?), Skip prompt and answer review (Category Blitz), Remove player, Re-spin dare, End, Play Again. The host doesn't play. |
| TV Display | `/tv/CODE` | Laptop on HDMI at 1920×1080: QR lobby, puzzle, leaderboard + rival tracker, reactions, dare wheel, podium & awards, sound with mute, full-screen button |
| Player Phone | `/play/CODE` | Join with a nickname. Hangman: on-screen keyboard (a physical keyboard works too) and hint. Emoji Decode: large answer box with a **Show clue** button. Most Likely To: a big list of names. Who Wrote It?: a large answer box with a character count, then four big name buttons. Category Blitz: a large answer box that stays focused, and your list of added answers. All modes: power-ups and reactions. |

Game-night features: Power-ups (Freeze a rival / Reveal a letter / Extra Life, 2 uses per game), Loser Picks, Double-Points Final, Sudden Death, Dare Wheel, Emoji Reactions, End-of-Night Awards (Speed Demon, Most Lives Lost, Hint Addict, Comeback Kid, Master Stumper, Emoji Whisperer, Crowd Favorite, Mind Reader, Mastermind, Undercover Agent, Open Book, Original Thinker, Blitz Machine), optional friend-written words, and a private **Inside Jokes** category.

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

### Most Likely To questions: [`src/data/questions.ts`](src/data/questions.ts)

Each line finishes the sentence "Who is most likely to …?", grouped by pack (the section it's in is its pack):

```ts
q("miss their own graduation"),                                  // Clean (default)
q("start chaos in the group chat and then go to sleep", "pg13"), // only in PG-13 games
```

- Keep it playful: harmless habits, funny scenarios and friend-group humor.
- No questions about health, mental health, sexuality, gender, race, religion, immigration, money, body shape, trauma, relationships, crimes, or anything degrading.
- `npm test` checks the file:
  - 30+ questions per pack and no duplicates.
  - 10–120 characters as displayed.
  - The content filter.
  - A list of off-limits topic words.
- The bank is `server-only` and never ships to browsers.

### Who Wrote It? questions: [`src/data/prompts.ts`](src/data/prompts.ts)

One question per line, grouped by pack (Hypotheticals, College Life, Friend Group, Chaos, Funny Habits — the section it's in is its pack):

```ts
w("What would you name a pet rock?"),                      // Clean (default)
w("What would be the most unhinged thing a smart fridge could say?", "pg13"), // only in PG-13 games
```

- Quick and playful: something anyone can answer in a few words.
- No secrets, health, mental health, sexuality, gender, race, religion, immigration, money, body shape, trauma, relationships, crimes, or anything degrading.
- `npm test` checks the file: 30+ questions per pack, no duplicates, 10–120 characters ending in "?", the content filter, and a list of off-limits topic words.
- Hosts can also add their own questions on Host Prep (the **Host's Questions** pack). The bank is `server-only` and never ships to browsers.

### Category Blitz prompts: [`src/data/blitz.ts`](src/data/blitz.ts)

One prompt per line, grouped by category (TV Shows, Movies, Music Artists, Food, Memes & Internet Culture, College Life, Places, Animals — the section it's in is its category):

```ts
p("S", "easy", "The Simpsons | Seinfeld | Saturday Night Live / SNL | ..."),   // Clean (default)
p("D", "hard", "Daria | Dexter | ...", "pg13"),                                   // only in PG-13 games
```

- The letter, a difficulty (`easy` / `medium` / `hard`), then the accepted answers separated by `|`. Alternate names for the **same** answer go together, separated by ` / ` (with spaces) — they count as one answer for uniqueness.
- Every answer must start with the letter once a leading "The/A/An" is dropped ("The Simpsons" is an S answer; "The Office" would be an O answer).
- Use globally recognizable answers and letters with plenty of them. No video game or sports categories.
- `npm test` checks the file: 15+ prompts per category, one prompt per letter per category, 30+ answers each, every answer starts with the letter, no duplicates, and Clean prompts pass the Clean filter.
- Anything players type that isn't listed goes to the host to approve after the round, so the list doesn't have to be complete. The bank is `server-only` and never ships to browsers.

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
- Rounds, content level, friend-written rounds and the Dare Wheel apply to every mode. The round timer, categories and difficulty apply to the word modes (Hangman, Emoji Decode). The voting timer and question packs apply to Most Likely To. The writing timer, guessing timer, answers per round and its own question packs apply to Who Wrote It?. The Category Blitz timer and categories apply to Category Blitz. Host Prep only shows the settings for the modes you picked.
- Host Prep, Host Controls and the TV lobby show an **estimated game length** for the current settings.

| Mode | What happens |
| --- | --- |
| 🔤 Hangman (default) | Unchanged from before: guess letters before your 6 balloons pop. |
| 😀 Emoji Decode | Every round is an emoji clue. |
| 👑 Most Likely To | Every round is a vote. Needs at least 3 players. |
| 🕵️ Who Wrote It? | Every round is a question to answer anonymously, then guess the writers. Needs at least 4 players. |
| ⚡ Category Blitz | Every round is a category + letter prompt; add as many answers as you can. |
| 🔀 Mixed | Rotates through the modes ticked under **Include in Mixed** (at least two), one per round, in order: Hangman → Emoji Decode → Most Likely To → Who Wrote It? → Category Blitz. Most Likely To rounds are skipped while fewer than 3 players are in, Who Wrote It? rounds while fewer than 4. The default is Hangman + Emoji Decode, the original Mixed. Answers never repeat across Hangman and Emoji Decode. |

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

**A Most Likely To round:**
1. The TV shows a question such as *"Who is most likely to miss their own graduation?"*, the voting timer and how many votes are in. The leaderboard shows who has voted, never for whom.
2. Each player picks a name from a large, scrollable list on their phone and taps **Lock vote**. Voting for yourself is allowed. Once locked, the phone shows **Vote locked**.
3. The round ends when the voting timer (15/20/30 s, default 20) runs out or everyone has voted.
4. The TV builds suspense:
   - Players with no votes are listed in one line.
   - Vote totals then appear from lowest to highest.
   - The player with the most votes is crowned 👑. Ties crown everyone tied, and if nobody voted there's no crown.
5. The TV shows round points and the leaderboard, then waits for **Next**. Phones show **You read the room!** if your vote matched the crown. Otherwise they show the usual **YOU SUCK 😂** (PG-13) or **YOU'RE OUT 😂** (Clean).

**Most Likely To details:**
- **Settings:**
  - **3 players minimum.** A Most Likely To-only game won't start with fewer. If players leave mid-game, the next round is held and the host and TV say so; once someone joins, tap Next. In Mixed, Most Likely To rounds are simply skipped while fewer than 3 players are in.
  - **Question packs:** College Life, Friend Group, Chaos, Future Predictions and Funny Habits, plus **Host's Questions** once you add your own on Host Prep. Questions never repeat within a game.
  - **Friend-written questions:** with friend-written rounds on, each player can submit one question in the lobby. The host can review and remove them. They're used for about a third of the Most Likely To rounds and are always anonymous (not even the host sees who wrote one), with no author points.
  - **Validation:** custom questions are 10–120 characters and go through the usual content filter. Write a full "Who…?" question or just the ending ("adopt a goat named Kevin").
- **During a game:**
  - **Skip:** the host can skip a question before the reveal. The votes are discarded unseen and nobody gets points.
  - **Late joiners** vote and appear as options from the next round.
  - **Removed players** can't vote and stop being options. Any vote they cast is discarded. Anyone who had voted *for* them gets their vote back and can vote again before time runs out; otherwise it counts as missed.
- **Existing features:**
  - **Power-ups** (the same 2 per game):
    - Freeze locks a rival's voting screen for 5 s, but not in the final 5 seconds.
    - Peek privately shows the current leader.
    - Double Vote counts your vote twice.
  - **Loser Picks:** the lowest scorer picks the next *question pack*. If the next round is a word round, they pick a category as before.
  - **Dare Wheel:** unchanged.
  - **Sudden Death:** games with word rounds keep the Hangman or Emoji Decode tiebreak. In a Most Likely To-only game, the non-tied players vote on the tied players, and a tied vote is settled at random.
  - **Awards:** **Crowd Favorite** goes to the most crowns and **Mind Reader** to the most correct votes. Awards nobody qualifies for are hidden.
- **Vote privacy:**
  - No screen shows who voted for whom. That includes the host's screen, and the voter's own phone, which only ever says "Vote locked".
  - Votes live only on the server. They never appear in client code, Realtime messages or API responses, and they're validated there: one vote per player per round, current options only, rate-limited.
  - Once a round is scored, the voter → vote record is deleted and only the totals are kept. Everything else is deleted with the room under the usual 24-hour cleanup.

**A Who Wrote It? round:**
1. **Writing.** The TV shows the question, the writing timer (30/45/60 s, default 45) and how many answers are in. Each player types one anonymous answer (up to 80 characters, with a live count) and taps **Lock in my answer**. It can't be changed once locked. Writing ends when the timer runs out or every player has answered.
2. **Selection.** The server picks the host's number of answers (1/3/5, default 3), favoring players whose answers have been shown least. If fewer were written, all of them are shown; if nobody wrote anything, there are no points and the host moves on. A 5-second pause lets the host review the selected answers.
3. **Guessing**, for each selected answer:
   - The TV shows the answer, never the writer, plus how many players have guessed.
   - Every other player gets four big name buttons (the writer plus three other players, never themselves) in their own random order, and taps one.
   - The writer's phone says **"Your answer is on screen. Keep a straight face 😏"** — they don't guess on their own answer.
   - When the guessing timer (10/15/20 s, default 15) runs out or everyone has guessed, the TV reveals the writer, how many guessed right and the updated scores. Phones show a celebration, **YOU SUCK 😂** (PG-13) / **YOU'RE OUT 😂** (Clean), or, for the writer, how many players their answer fooled.
4. After the last answer the TV shows the round's answers with their writers and the leaderboard, then waits for **Next**.

**Who Wrote It? details:**
- **Host controls:** Host Controls lists the selected answers still to come (text only — even the host never sees who wrote one). The host can **Remove** one before it reaches the TV (another answer takes its place if one is available), **Skip** the answer on screen before its reveal (no points, writer stays secret, a replacement comes up), **Skip question** for the rest of the round, and tap **Next** to move on from a reveal early.
- **Content:** answers go through the content filter when submitted, at the game's Clean / PG-13 level. Answers that weren't selected never appear on the TV or anyone else's phone and are deleted when the round ends.
- **Custom questions:** add your own on Host Prep (10–120 characters, content-filtered). With friend-written rounds on, each player can submit one question in the lobby; you can review and remove them. They're used for about a third of the Who Wrote It? rounds, are always anonymous and earn no author points. Questions never repeat within a game.
- **Players:**
  - **4 players minimum.** A Who Wrote It?-only game won't start with fewer; if players leave, the next round is held and the host and TV say so until someone joins.
  - **Late joiners** start with 0 points and play from the next question. They can appear as a name choice only after they've written an answer.
  - **Removed players** can't write or guess. Their unrevealed answers are dropped (and replaced when possible).
- **Existing features:**
  - **Power-ups** (the same 2 per game): **Freeze** locks a rival's guess buttons for 5 s (not in the final 5 seconds; anyone can be frozen, even the writer, so a freeze never gives anything away), **Eliminate Two** removes two wrong names (always leaving at least two), **Double Guess** lets you pick two names. One boost per answer; power-ups spent on a skipped answer are refunded.
  - **Loser Picks:** the lowest scorer picks the next question pack (or category, if the next round is a word round).
  - **Dare Wheel:** unchanged.
  - **Sudden Death:** games with word rounds keep their word tiebreak. In a Who Wrote It?-only game (or Mixed with only Most Likely To and Who Wrote It?), the non-tied players vote on the tied players without showing who voted for whom; a tie is settled at random.
  - **Awards:** **Mastermind** (most correct guesses), **Undercover Agent** (fooled the most guesses), **Open Book** (whose answers were guessed correctly most often). Hidden when nobody qualifies.
- **Anonymity:** the writer of an answer stays on the server until that answer's reveal. It never appears in client code, Realtime messages, API responses, choice order or the host's screen, and no screen ever shows who guessed whom — only totals. Who has written or guessed isn't shown either (it would hint at the writer); only counts are. Each guess is deleted as soon as the writer is revealed.
- **Reliability:** the server is the source of truth: one answer per player per round, one guess per player per answer (two with Double Guess), both rate-limited. Refreshing restores the stage, question, answer on screen, timer, your answer status, your choices, power-ups and score.

**A Category Blitz round:**
1. The TV shows the category and a big letter — e.g. *Movies starting with S* — plus the round timer (30/45/60 s, default 30) and how many answers each player has added. Answer text is never shown during the round, so nobody can copy.
2. Phones show the category, letter, timer and a large answer box that stays focused: type, press **Enter** (or **Add**), repeat. Each answer appears in your list as **Added** — the phone never says whether it's valid. Up to 20 answers each.
3. When the timer runs out, the server checks every answer against the prompt's accepted answers.
4. **Host review:** the host gets up to 20 seconds to approve or reject up to 10 of the most common answers the game didn't recognize (Host Controls shows each with how many players gave it). Anything left unreviewed earns nothing. If there's nothing to review, this step is skipped.
5. The TV reveals popular answers, answers only one player thought of, each player's valid/unique counts and round points, and the leaderboard, then waits for **Next**. Phones show your valid and unique counts — or, if you scored 0, **YOU SUCK 😂** (PG-13) / **YOU'RE OUT 😂** (Clean).

**Category Blitz details:**
- **Answer matching** (on the server): case, accents, punctuation, extra spaces and a leading "the/a/an" are ignored; the answer must start with the letter after that; listed alternates count as the same answer. One typo is forgiven for answers of 5–8 characters and two for longer ones; shorter answers must match exactly. Numbers must match ("Shrek 2" is not "Shrek"), and a typo equally close to two different answers (Moise → Mouse or Moose?) counts as neither, so close names are never merged. Repeating your own answer is rejected.
- **Custom prompts:** add your own category + letter on Host Prep (**Host's Prompts**). Accepted answers are optional; without them the most common answers go straight to your review. Friend-written submissions don't apply to this mode. Prompts never repeat within a game.
- **Content:** answers are filtered at the game's content level when they're typed, so nothing blocked can reach the TV.
- **Power-ups** (the same 2 per game): **Freeze** a rival's answer box for 5 s (not in the final 5 seconds), **Get a Suggestion** privately shows you one valid answer (only on your phone), **Extra Time** adds 5 seconds for you only. Skipped prompts refund them.
- **Loser Picks:** the round's lowest scorer picks the next category from the host's selected categories (if the next round is another mode, that mode's usual pick).
- **Dare Wheel:** unchanged. **Late joiners** start with 0 points from the next round. **Removed players** stop playing and their answers stop counting toward anyone's uniqueness.
- **Sudden Death:** games with word-guessing rounds keep their existing tiebreak. In a Category Blitz-only game, the tied players get one prompt: the first valid answer wins, an invalid answer eliminates that player, and if everyone is eliminated another prompt is played.
- **Awards:** **Original Thinker** (most answers nobody else gave) and **Blitz Machine** (most valid answers). Hidden when nobody qualifies.
- **Answer protection:** the accepted answers and everyone else's answers live only on the server until the reveal — never in client code, Realtime messages or API responses — and are deleted when the round ends. A suggestion is sent only to the player who used it. Answers are rate-limited, and refreshing restores the prompt, your timer, your answers, power-ups and score.

### Emoji Decode scoring

| Event | Points |
| --- | --- |
| Correct answer | **+100** |
| Speed bonus | up to **+100**, scaled linearly by time remaining |
| Each host hint revealed before you answered | **−25** off that maximum |
| Wrong or missing answer | **0** |
| Final round | doubled, as in Hangman |

Scores can't go below 0, and both modes add to one shared leaderboard.

### Most Likely To scoring

| Event | Points |
| --- | --- |
| You voted for a crowned player | **+100** |
| You were crowned | **+50** |
| Missed vote, or a vote for anyone else | **0** |
| Tie for the most votes | everyone tied is crowned, and votes for any of them count |
| Nobody votes | no crown, no points |
| Final round | doubled, as in the other modes |

Points are added when the round ends, so the leaderboard never hints at who is leading the vote.

### Who Wrote It? scoring

| Event | Points |
| --- | --- |
| You guessed the writer | **+100** |
| Your answer fooled someone (per player who guessed wrong) | **+15** |
| Wrong guess, missed guess, or writing your own answer | **0** |
| Final round | doubled, as in the other modes |

Points are added at each answer's reveal; scores never go below 0 and share the one leaderboard.

### Category Blitz scoring

| Event | Points |
| --- | --- |
| Each valid answer | **+10** |
| Nobody else gave that answer | **+30** more |
| Invalid answer | **0** (no penalty) |
| Most per round | **300** (then doubled in the final round) |
| Answers per player per round | 20 max |

Scores never go below 0 and share the one leaderboard.

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

- **No database migration for Emoji Decode, Most Likely To, Who Wrote It? or Category Blitz.** Room state is one JSONB document, so the new fields are just extra keys with defaults. Rooms saved by an older version are upgraded in memory when loaded (`upgradeState`), so existing data is never rewritten or lost. `supabase/migrations/0001_init.sql` is still the only migration, and votes, answers, guesses and Category Blitz answers are deleted with their room by the existing cleanup.
- **Votes are secret by construction.** The voter → vote map lives only in server state. Views are built from totals, and the map is wiped as soon as a round is scored. A unit test plays the same round with different voters but identical totals and checks that every screen's data is byte-for-byte identical.
- **Who Wrote It? authors are secret by construction.** Answers and guesses live only in server state; views carry the answer text and totals, never an author before its reveal. Unit tests swap who wrote the answer on screen (or whom a player guessed) and check that every other screen's data is identical; guesses are wiped at each reveal and unshown answers at the end of the round.
- **Category Blitz answers are secret until the reveal.** The prompt's accepted answers and every player's answers live only in server state; the TV and host get counts, a player gets only their own list, and a suggestion only reaches the player who used it. Both are dropped when the round ends. Tests scan every screen and API response for accepted answers before the reveal.
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
#   GAMES=2 PLAYERS=15 ROUNDS=5 MODE=mixed by default (MODE=hangman|emoji|mlt|wwi|blitz|mixed)
#   MIXED=hangman,emoji,mlt,wwi,blitz sets the Mixed rotation; every response is scanned for individual votes,
#   Who Wrote It? secrets (an author before its reveal, anyone's guesses, unshown answers) and, mid-round,
#   Category Blitz accepted answers on the TV and host screens
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
| **Most Likely To:** existing modes unchanged | all earlier Hangman, Emoji Decode and Mixed tests pass unchanged (default Mixed = Hangman + Emoji Decode) |
| **Most Likely To:** mode selection, voting, ties, scoring, double points, power-ups, custom questions, player removal, vote privacy | `tests/unit/mlt.test.ts`, `questions.test.ts` + `tests/integration/mlt-api.test.ts` |
| **Most Likely To:** full Most Likely To game and a Mixed game (host, TV, multiple phones) | `tests/e2e/mlt.spec.ts` |
| **Most Likely To:** 15 concurrent players, scores match on server, phones and TV, no vote leaks | `MODE=mlt npm run load-test` and `MODE=mixed MIXED=hangman,emoji,mlt npm run load-test` |
| **Most Likely To:** dev tools / network can't reveal who voted for whom | unit "identical views" test, integration + e2e scans of every response, load-test scan |
| **Who Wrote It?:** existing modes unchanged | all earlier Hangman, Emoji Decode, Most Likely To and Mixed tests pass unchanged |
| **Who Wrote It?:** mode selection, answer selection, choice generation, author sit-outs, scoring, double points, power-ups, custom questions, host removal, late joining, player removal, anonymity | `tests/unit/wwi.test.ts`, `prompts.test.ts`, `estimate.test.ts` + `tests/integration/wwi-api.test.ts` |
| **Who Wrote It?:** full Who Wrote It? game and a Mixed game (host, TV, 4 phones) | `tests/e2e/wwi.spec.ts` |
| **Who Wrote It?:** 15 concurrent players, scores match on server, phones and TV | `MODE=wwi npm run load-test` and `MODE=mixed MIXED=hangman,emoji,mlt,wwi npm run load-test` |
| **Who Wrote It?:** dev tools / network can't reveal an author or another player's guess before it's shown | unit "identical views" tests, integration + e2e scans of every response, load-test scan |
| **Category Blitz:** existing modes unchanged | all earlier Hangman, Emoji Decode, Most Likely To, Who Wrote It? and Mixed tests pass unchanged |
| **Category Blitz:** mode selection, answer matching, starting letters, duplicates, uniqueness, score caps, host review, power-ups, custom prompts, answer protection | `tests/unit/blitz.test.ts`, `blitz-match.test.ts`, `blitz-bank.test.ts` + `tests/integration/blitz-api.test.ts` |
| **Category Blitz:** full Category Blitz game and a Mixed game (host, TV, 3 phones) | `tests/e2e/blitz.spec.ts` |
| **Category Blitz:** 15 concurrent players submitting answers quickly, scores match on server, phones and TV | `MODE=blitz npm run load-test` and `MODE=mixed MIXED=hangman,emoji,mlt,wwi,blitz npm run load-test` |
| **Category Blitz:** dev tools / network can't reveal accepted answers before the reveal | unit + integration scans of every view and response, e2e scan of every TV/host response, load-test scan |

Before game night, confirm:

- [ ] Supabase project created and migration run
- [ ] Realtime public channels allowed
- [ ] All six env vars set in Vercel and deployed
- [ ] `NEXT_PUBLIC_SITE_URL` matches the live domain (redeploy after changing)
- [ ] `/api/cron/cleanup` shows up under Vercel → Settings → Cron Jobs (and/or the `pg_cron` job is scheduled)
- [ ] Test run: host link bookmarked, TV link on the laptop, a phone scans the QR code and joins
