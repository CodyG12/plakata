# Plákata: baseball trivia where obscure wins

A Krillion-style baseball trivia game. Each round asks for an MLB player who fits a prompt
("at least 300 career home runs", "played for the Montreal Expos", "born in Japan"…). Any valid player
counts, but **rarer answers score more**: every round is a Strikeout, Bunt, Single, Double, Triple or
Plákata, and rarity comes from **what real fans actually answer**.

Seven rounds: 3 seconds to read each prompt, then 30 seconds to answer. Up to 100 points per round (700 max).
The server runs the game: it picks the questions, keeps the clock, checks answers and awards points.

## Quick start (local)

```bash
npm install
npm run plakata -- setup   # create the local database, import 24,011 players, sync 43 questions (~10 s)
npm run dev                # http://localhost:3000
```

No credentials are needed locally. Without `DATABASE_URL`, the app uses **PGlite**: real PostgreSQL
compiled to WebAssembly, stored in `.data/pglite` (git-ignored). It uses the same schema, migrations and SQL
as production. Only one process can open it at a time, so stop `npm run dev` before running CLI commands
that write (`setup`, `questions:sync`, `rarity:refresh`).

| Command                                    | What it does                                                    |
| ------------------------------------------ | --------------------------------------------------------------- |
| `npm run dev`                              | Dev server                                                      |
| `npm test`                                 | Unit + integration tests (Vitest; integration uses in-memory PGlite) |
| `npm run lint` / `npm run typecheck`       | ESLint / TypeScript                                             |
| `npm run build`                            | Production build (`npm start` to serve it)                      |
| `npm run plakata -- setup`                 | Migrate, import players, sync the question bank                 |
| `npm run plakata -- questions:sync`        | Make the DB match `src/data/question-bank.ts` (new versions, disable removed) |
| `npm run plakata -- questions:list`        | Active questions with eligible-answer and observation counts    |
| `npm run plakata -- questions:preview <slug\|all>` | Eligible count, sample answers and the Plákata pick (no DB writes) |
| `npm run plakata -- questions:coverage`    | Dataset gaps (missing birthplaces, pitching records…)           |
| `npm run plakata -- rarity:refresh [--alpha N]` | Rebuild scoring snapshots from community answers           |
| `npm run plakata -- daily:show [YYYY-MM-DD]` | Show (creating if needed) a day's daily challenge             |
| `npm run db:generate`                      | Generate a SQL migration after editing `src/server/db/schema.ts` |
| `npm run build:data -- <dir>`              | Regenerate `src/data/players.json` from Lahman CSVs (see below) |

### Environment variables

See `.env.example`.

| Variable            | Local    | Production   | Purpose                                                          |
| ------------------- | -------- | ------------ | ---------------------------------------------------------------- |
| `DATABASE_URL`      | optional | **required** | PostgreSQL connection string (use your provider's pooled URL)    |
| `PLAKATA_SECRET`    | optional | **required** | ≥ 32 random chars. Signs round tokens and participant cookies, keys the IP hash |
| `CRON_SECRET`       | –        | recommended  | Enables the daily `/api/cron/refresh-rarity` job                  |
| `RARITY_ALPHA`      | –        | optional     | Prior strength α (default 100)                                   |
| `DATABASE_POOL_MAX` | –        | optional     | Connections per instance (default 5)                             |

Credentials are only read on the server. Nothing in `src/server` is imported by client components, and the
browser bundle contains no player data, eligibility sets or secrets.

## Deploying to Vercel

1. Create a PostgreSQL database. **Neon** works well (Vercel Marketplace → Neon); Supabase or any Postgres 14+
   also works. Copy the **pooled** connection string.
2. Initialize it once from your machine:
   ```bash
   DATABASE_URL='postgresql://…' npm run plakata -- setup
   ```
   Re-run `setup` (or `questions:sync`) whenever the question bank, players.json or schema changes. It's
   idempotent.
3. In the Vercel project, set `DATABASE_URL`, `PLAKATA_SECRET` (`openssl rand -hex 32`) and `CRON_SECRET`.
4. Deploy. `vercel.json` schedules `/api/cron/refresh-rarity` daily at 09:00 UTC. It rebuilds snapshots from
   new answers; games in progress and the current day's challenge keep the snapshots they froze.

Without `DATABASE_URL` the production server refuses to start a database connection. PGlite on serverless
would silently lose data.

## How to play

1. Pick a mode (**Daily** by default, or **Random**) and press **Swing Away**.
   - **Daily:** the same seven prompts, in the same order and scored against the same frozen rarity
     snapshots, for everyone on a given UTC day.
   - **Random:** seven prompts drawn server-side from the full bank, one per category.
2. Each round opens with **3 seconds to read the prompt**. Only the prompt and a short countdown show; the
   answer field appears and the 30-second clock starts when reading ends.
3. Type a player's name from memory and press **Enter** or **Submit**. There are no suggestions, so the
   interface never hints at possible answers.
4. **Guess as many times as you like.** A rejected guess shows a short, generic message and clears the field.
   The clock keeps running.
5. Minor typos get a correction ("Did you mean Derek Jeter?"). Press Enter to submit it, or edit it. It isn't
   counted as a wrong guess. Father/son namesakes default to the father ("Ken Griffey" = Sr.). A surname
   alone that several players share must be typed as a full name. If several unrelated namesakes fit the
   question, you pick which one you meant.
6. The first **valid** answer ends the round and earns a hit (see [Scoring](#scoring)).
7. When time runs out without a valid answer, the round is a **Strikeout** and scores zero.

Refreshing the page resumes the game exactly where it stands. Only the game id is kept in `localStorage`; the
server holds the state and the clock.

## Architecture

```
scripts/
  download-lahman.sh      Fetch the needed Lahman CSVs from SABR
  build-dataset.mjs       CSVs → src/data/players.json (pure derivation, no hand edits)
  plakata.ts              Admin CLI (setup, question sync/preview, rarity refresh, daily)
drizzle/                  SQL migrations (generated from the schema, committed)
src/
  data/
    players.json          24,011 players (generated, ~12 MB, server-only)
    question-bank.ts      43 question definitions (typed criteria + Plákata pick): edit to change the bank
    rarity-estimates.ts   Curated popularity tiers for the original seven: the rarity PRIOR
    aliases.ts            Nicknames / Jr.-Sr. disambiguation → player IDs
  lib/baseball/           Pure game logic (name matching, criteria, scoring tiers)
  lib/rarity/rarity.ts    Prior → Bayesian smoothing → calibration → snapshot → tier (pure, deterministic)
  lib/questions/selection.ts  Balanced random and date-seeded daily selection
  lib/game/               Client: view reducer, API client, countdown hook, shared game constants
  server/
    db/schema.ts          PostgreSQL schema (Drizzle ORM)
    db/client.ts          node-postgres when DATABASE_URL is set, PGlite otherwise
    game-service.ts       Server-authoritative lifecycle: create, start, submit, complete
    question-store.ts     Question versions, eligibility sets, snapshots (cached by id; immutable)
    tokens.ts             Signed round tokens (HS256 JWT via jose)
    participant.ts        Signed anonymous participant cookie, IP hashing
    rate-limit.ts         Fixed-window limits stored in Postgres
    http.ts               Route plumbing: caller identity, errors, no-store
  app/api/
    games                               POST {mode} → new game (server picks 7 questions)
    games/[gameId]                      GET → current state (refresh recovery)
    games/[gameId]/rounds/start         POST → start the next round (idempotent)
    games/[gameId]/rounds/[roundId]/submit    POST {token, input, playerId?}
    games/[gameId]/rounds/[roundId]/complete  POST → settle a round whose time is up
    cron/refresh-rarity                 GET (Bearer CRON_SECRET) → rebuild rarity snapshots
  components/game/        Screens: Landing, Game, RoundResult, FinalResults (visual design unchanged)
```

### Database

| Table                 | What it holds                                                                 |
| --------------------- | ----------------------------------------------------------------------------- |
| `participants`        | Anonymous id (server-issued) + hashed first IP. No names, emails or raw IPs.  |
| `players`             | Lahman players: id, name, aliases, full attribute JSON, data release          |
| `questions`           | Stable question slug                                                          |
| `question_versions`   | Immutable prompt + typed criteria + data release + content hash; one active per slug |
| `question_eligibility`| Precomputed valid player ids per version (PK version+player)                  |
| `scoring_snapshots`   | Frozen distribution (JSONB) per version: α, calc version, pick, observation count |
| `rarity_stats`        | Per-answer n, N, prior, observed, smoothed probability and calibrated rarity  |
| `daily_challenges`    | One row per UTC day: the 7 version ids and 7 snapshot ids                     |
| `games` / `rounds`    | Game mode and total; per round: question version, snapshot, server times, token id, accepted answer, tier, points |
| `submissions`         | Every attempt: raw text, outcome (valid, ineligible, ambiguous, unrecognized, suggestion, choose, not_open, expired, closed), accepted flag, server time |
| `rarity_observations` | The ONLY input to rarity: one row per participant per question version        |
| `rate_limits`         | Fixed-window counters                                                         |

Constraints that enforce the rules: `rounds(game_id, position)` unique; `rounds.points` must be one of
0/10/25/50/75/100; `rarity_observations(participant_id, question_version_id)` unique and `(round_id)`
unique; one active version per slug (partial unique index).

### Server-authoritative timing

- `POST …/rounds/start` sets `startedAt = now`, `opensAt = now + 3 s`, `expiresAt = opensAt + 30 s` on the
  **server clock** and issues a round token. Calling it again while the round runs returns the same round
  unchanged, so refreshes, retries and second tabs can't reset the clock or skip ahead. Rounds start
  strictly in order, and only after the previous one has finished.
- **Deadline policy:** a submission counts only if the server **receives** it no later than
  `expiresAt + 750 ms` (`LATENCY_GRACE_MS`, covering a guess sent at 29.9 s that arrives late).
  Submissions received before `opensAt` are rejected (`not_open`). Client timestamps are never read.
- The browser computes `offset = serverNow − localNow` from each response and displays
  `expiresAt − offset`. Changing the device clock only changes the display. When the display hits zero,
  the client asks `…/complete`, which settles the round as a Strikeout only once the server agrees time is
  up (otherwise it answers `round_in_progress` and the client retries). A round that ran out while the
  page was closed is settled on the next read.
- **Round tokens** are HS256 JWTs (via `jose`, key derived from `PLAKATA_SECRET`) carrying game id, round
  id, question version, position, start/expiry and a unique `jti`. Every submission checks the signature,
  then that the token matches the round **row** (same round, game, question version and `jti`). The
  database row, not the token, decides whether the round is open. An authentic expired token still
  identifies its round, so a late answer becomes a Strikeout, never points.
- **One accepted answer per round:** the accept is `UPDATE rounds … WHERE id = ? AND status = 'active'`
  inside a transaction. Of two simultaneous correct answers (double click, two tabs, retries), exactly one
  changes the row; the other gets the finished round back. `start` also takes a row lock on the game. The
  game total is always recomputed in SQL from the rounds, never accumulated or accepted from the client.
- Games are bound to the participant cookie: anyone else gets `404` for the game id.

### Rate limits and abuse protection

Postgres-backed fixed windows: 25 submissions per 10 s per participant (120 per IP), 30 new games per hour
per participant (120 per IP). Normal play never comes close. Requests over the limit get `429` and change
nothing. Inputs are length-capped and schema-validated (zod).

## Player data

**Source:** [SABR Lahman Baseball Database](https://sabr.org/lahman-database/), release 1871–2025
(published Dec 10, 2025), licensed **CC BY-SA 3.0** (attribution in the footer; share-alike applies to
derived data such as `players.json`). To regenerate:

```bash
scripts/download-lahman.sh /tmp/lahman      # 14 tables incl. Pitching, AllstarFull, *Post, TeamsFranchises
npm run build:data -- /tmp/lahman
npm run plakata -- questions:sync           # a new data release creates new question versions
```

**Coverage:** all 24,011 people with a recorded major-league appearance, including the leagues SABR
recognizes as major (NA 1871–75, AA, UA, PL, FL and the Negro Leagues 1920–48). Each player record has:
teams and franchises, seasons played, regular-season games by position, career and best-season batting
(HR, H, RBI, SB) and pitching (W, SO, SV), MVP / Cy Young years, Hall of Fame (player category),
All-Star seasons, World Series titles, and birth country/state.

**Rules and judgment calls** (each is enforced by code in `src/lib/baseball/criteria.ts`):

- **Franchise vs. team:** a `franchise` question counts every team in the franchise's history
  (Lahman `franchID`: the Dodgers are Brooklyn and Los Angeles). A `team` question counts specific
  `teamID`s, i.e. one team name/era (the Montreal Expos = `MON`, not the Nationals). "Yankees" keeps v1's
  rule (`NYA`, 1903–present, including the Highlanders).
- **Positions:** regular-season games at the position from `Appearances` (G_c, G_ss, G_cf, …). Prompts
  state the minimum ("at least 100 career games at catcher"), so one-inning cameos don't count.
- **Seasons and eras:** a recorded regular-season appearance in a season in range; "career began before
  1950" = first season < 1950.
- **Stats:** career totals sum every stint; single-season bests sum every stint within the season.
  Missing stats are never zero: a player with no pitching rows can't meet a pitching threshold.
- **All-Star selections:** listed on an `AllstarFull` roster that season, whether or not he played (`GP`);
  seasons with two games (1959–62) count once. Data starts in 1933.
- **World Series champions:** Lahman has no championship rosters. A title counts only when the player
  **appeared in a modern World Series game (1903+) for the winning team** (postseason batting, pitching
  or fielding row with G > 0, matched to `SeriesPost`). Roster members who never played in the Series,
  pre-1903 "World Series" and the Negro World Series are excluded. Prompts say "appeared in".
- **Birthplace:** `People.birthCountry`/`birthState`. 933 players (3.9%, mostly Negro Leagues) have no
  recorded birthplace and never qualify for birthplace questions, not even "born outside the US".
  Puerto Rico, Guam, the U.S. Virgin Islands and American Samoa are Lahman "countries"; "outside the
  United States and its territories" excludes them.
- **MVP** is whatever Lahman labels Most Valuable Player (includes the Chalmers and League Awards).
  **Hall of Fame** counts people inducted as players only.
- Career totals include every league Lahman treats as major, so some 19th-century totals differ from
  MLB.com.

## Question bank

43 questions in `src/data/question-bank.ts`, across eight balancing categories:

| Category     | Questions (eligible answers)                                                                 |
| ------------ | -------------------------------------------------------------------------------------------- |
| team         | Yankees (1,837), Mariners (1,036), Expos (620), Dodgers franchise (2,002), Braves franchise (2,165), Athletics franchise (2,147), Cubs franchise (2,277) |
| position     | ≥100 games at catcher (1,020), shortstop (930), center field (1,098)                         |
| era          | Played in the 1990s (2,805), in 1975 (844), career began before 1950 (11,062)               |
| stats        | 300 HR (165), 500 HR (28), 2,000 H (298), 3,000 H (33), 200 W (122), 3,000 SO (20), 300 SV (31), 500 SB (39), 40-HR season (165), 50-HR season (34), 20-win season (547), 200-hit season (272) |
| honors       | MVP (160), Cy Young (88), Hall of Fame (281)                                                 |
| all_star     | Any selection (2,306), ≥5 selections (379), 1998 All-Star (63)                               |
| world_series | Played for a champion (1,759), for ≥2 champions (437), 2004 Red Sox (21), 2016 Cubs (25)     |
| birthplace   | Japan (84), Dominican Republic (937), Venezuela (500), Cuba (455), Puerto Rico (310), Canada (273), California (2,524), outside the US and territories (2,885) |

**Criteria are typed data, not code.** `QuestionCriteria` is a zod-validated discriminated union
(`franchise`, `team`, `position`, `season`, `debut`, `stat_threshold`, `award`, `hall_of_fame`,
`all_star`, `world_series_champion`, `birthplace`) with enums for stats and positions.

**Precomputed, versioned eligibility.** `questions:sync` evaluates each definition against every player
once and stores the valid ids as a **question version** (hash of prompt + criteria + data release). The
server checks answers by set membership (cached in memory per version). Editing a prompt or criteria, or
importing a new data release, creates a new version; old rounds keep pointing at theirs, so historical
results never change. Removing a question (or `active: false`) disables it without deleting history.

**Adding a question:** add an entry to the bank, run `npm run plakata -- questions:preview <slug>` to see
its answer count and pick, then `questions:sync`. The sync refuses an empty answer set or an ineligible
Plákata pick.

**Selection.** Random games are drawn with `crypto.randomInt`, round-robin across shuffled categories:
no duplicates, and no category repeats until all eight are used. The daily seven use the same algorithm
seeded with the UTC date. The first request of the day writes them, with their snapshot ids, to
`daily_challenges`, and everyone reads that row afterwards, so the daily can't change mid-day even if the
bank or snapshots do. The client never chooses questions.

## Answer matching

Answers are checked on the server, only after the player submits. There is no autocomplete while typing. A
probable typo comes back as a **suggestion**: the corrected spelling, which the player must confirm by
submitting it. A rejected answer gets one of three generic messages and **no player names, IDs, or stats**:

| Status         | Message                                                                                                                                            |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unrecognized` | "Player not recognized. Check the spelling and try again."                                                                                         |
| `ambiguous`    | "Multiple players match that name. Please enter the player's full name."                                                                           |
| `ineligible`   | "Incorrect answer — that player doesn't fit this question. Try again!"                                                                             |
| `suggestion`   | "Did you mean Derek Jeter?" (not a rejection; the input is pre-filled with the correction)                                                         |
| `choose`       | "More than one Luis Castillo fits this question. Which one did you mean?" plus a button for each, showing career years and teams (not a rejection) |

Only a `valid` result carries the player's ID, canonical name and `matchType`. A suggestion is produced
**before** eligibility is checked, so it's identical whether or not the player fits the question. It reveals
only the spelling of a real player close to what was typed.

**Two steps.** `resolve-player.ts` turns text into players using the name alone. It never sees the question
and never uses popularity, statistics or rarity. Only
after one player is identified does `validate-answer.ts` check them against the question.

**Resolution pipeline.** The first step that finds anyone wins; a later step never overrides an earlier
match.

1. **Normalize:** lowercase, strip accents and punctuation, collapse whitespace, and merge initials
   ("J. J. Putz" = "JJ Putz").
2. **Exact:** canonical Lahman name or a verified alias from `aliases.ts`. Aliases include nicknames ("Big
   Papi", "Ichiro") and Jr./Sr. forms for 15 father/son pairs whose Lahman names are identical.
3. **Exact without suffix:** the same lookup with a trailing Jr./Sr./II/III/IV removed.
4. **Partial:** the input equals a surname or a first name on its own ("Ohtani", "Buhner", "Kiner-Falefa").
   Surnames come from Lahman's own surname field, so multi-word surnames match as a unit.
5. **Fuzzy:** Damerau-Levenshtein distance (substitutions, missing/extra letters, adjacent transpositions)
   against every canonical name, alias, surname and first name.

At every step, one matching player resolves the answer, and none leave it **unrecognized**. When several
players match, the outcome depends on what was typed:

- **A surname or first name alone** ("Griffey", "Johnson", "Mike") is **ambiguous**, judged across all
  24,011 players. "Griffey" is ambiguous even on the 300-HR question, where only Junior qualifies. A single
  word never uses the question to decide.
- **A full name shared by unrelated players** ("Randy Johnson", "Luis Castillo") is checked against the
  question. If no namesake fits, the answer is ineligible; if exactly one fits, that player is accepted;
  if several fit, the player chooses from buttons. Only a player from that list is accepted as the choice:
  the server re-checks the pick against the same name and question.
- **A father/son name** follows the default below.

**Father/son default.** A father/son pair is two players sharing a full name, with verified "Jr." and
"Sr." aliases in `aliases.ts`. For these pairs, a full name typed **without** a suffix, or a typo of one, is
treated as the father. A correctly spelled name resolves to him directly; a typo comes back as a
suggestion, "Did you mean Ken Griffey Sr.?", for the player to confirm. Only typing "Jr." reaches the son. The rule is driven purely by the name, never by who fits the
question, and doesn't apply to surnames alone ("Griffey" stays ambiguous). It covers 15 pairs, including
Griffey, Tatis, Guerrero, Rose, Gwynn, Alomar, Witt, Raines and Jose Cruz.

**Fuzzy thresholds,** based on the normalized input length including spaces:

| Input length | Max edits         | Examples                                        |
| ------------ | ----------------- | ----------------------------------------------- |
| 1–4          | 0 (must be exact) | "Ruth", "Cobb", "Ott"                           |
| 5–9          | 1                 | "Jeeter" → Jeter, "Mel Ot" → Mel Ott            |
| 10+          | 2                 | "Derek Jeeter", "Shohei Otani", "Albert Pujolz" |

A typo produces a suggestion only if exactly one player sits at the minimum distance; if two players tie, the
answer is ambiguous. A typo is never accepted automatically. The suggested text keeps the spelling that was
matched, such as an alias like "Ken Griffey Jr.". A typo of a shared full name suggests that name ("Randy
Jonson" → "Randy Johnson"), which is then handled as namesakes. Every suggestion is re-checked to make
sure that submitting it resolves to the same players without any correction; otherwise no suggestion is
offered.
Because exact matches are checked first, typing a real name (Jim Price) is never "corrected" to a near
neighbour (Jim Rice).

**Dataset-driven limitations**

- Lahman has no Jr./Sr. field. Fathers and sons are recognized only through the curated aliases. A
  father/son pair missing from that list, such as Mark Leiter and his son, is handled like unrelated
  namesakes.
- Eddie Collins has a third, unrelated namesake (a 1910–18 Negro Leagues player). The plain name defaults to
  the Hall of Fame father, so the third player is reached only through his alias, "Eddie Collins (Negro
  Leagues)".
- A surname is accepted alone only if it is unique among all 24,011 players. Many famous surnames are not
  unique ("Jeter", "Pujols", "Cobb", "Ruth" is unique).
- Nicknames work only if listed in `aliases.ts`. Reversed names ("Jeter Derek") are not recognized.


## Scoring

Every round ends in exactly one tier with fixed points (`src/lib/baseball/scoring.ts`, unchanged
thresholds):

| Tier      | Calibrated rarity | Points |
| --------- | ----------------- | -----: |
| Strikeout | no valid answer   |      0 |
| Bunt      | 0–19              |     10 |
| Single    | 20–39             |     25 |
| Double    | 40–59             |     50 |
| Triple    | 60–79             |     75 |
| Plákata   | the hand-picked answer |  100 |

**One Plákata per question.** Each question's `plakataPick` always scores 100 (product decision). Every
other valid answer gets its tier from community rarity, **capped at a Triple**. Picks for the original
seven were hand-chosen in v1. Picks for the 36 new questions follow a documented rule (fewest career games
among eligible players with ≥ 100 games), except in small elite pools where that rule lands on a star
(e.g. McGwire for 500 HR). Those were hand-picked deep cuts and are marked in the file. **They're
provisional: review them.**

### How rarity is calculated

All of it is pure, deterministic code in `src/lib/rarity/rarity.ts`.

1. **Prior.** Curated tiers are ordinal, so they're turned into relative naming weights: iconic 27,
   famous 9, well-known 3, known 1 ("an iconic player is 3× as likely to be named as a famous one"). Uncurated
   eligible players share 40% of the mass, capped at half a "known" player's weight each. Normalizing gives
   `p_prior(a|q)`. It's positive for every eligible answer (including unknown deep cuts) and sums to 1.
   Questions without a curated list get a uniform prior.
2. **Community frequency.** `n_aq` = eligible observations of answer *a* for question version *q*, and
   `N_q` = their total. Invalid guesses are never observations, so they're in neither count.
3. **Bayesian smoothing.** `p_smoothed(a|q) = (n_aq + α·p_prior(a|q)) / (N_q + α)`, with α = 100
   equivalent observations by default (`RARITY_ALPHA`; a starting point, not a fitted value). After 100
   real answers the data and the prior weigh equally; after 1,000 the data has ~91% of the weight. It still
   sums to 1.
4. **Calibration.** The raw `100 × (1 − p_smoothed)` is kept (`rawRarity`), but it compresses: with
   2,000 eligible Dodgers even the most common answer has p ≈ 0.02 and scores 98. The calibrated score is
   the percentile **"rarer than X% of the answers fans give"**: 100 × (mass of strictly more common answers
   + half the mass tied with this one). It's monotonic (a more common answer is never rarer), deterministic,
   and spreads answers across the tiers. Tests use synthetic distributions to show the compression and the fix.
5. **Snapshot.** The distribution is frozen into `scoring_snapshots` (never-named uncurated answers share
   one entry). Every round records the snapshot id it was created with; daily challenges freeze theirs for
   the whole day. `rarity:refresh` (or the cron) writes new snapshots that only new games use, so completed
   scores are reproducible and never change.

**Zero observations vs. v1.** With no community data yet, scores come from the prior alone. Compared with
v1's fixed table (iconic Bunt, famous Single, well-known Double, known Triple, uncurated Triple, pick Plákata),
every curated tier lands within one tier of v1, keeps its order, and the pick is the only Plákata:

| Question     | iconic | famous | well-known | known  | uncurated |
| ------------ | ------ | ------ | ---------- | ------ | --------- |
| 300 HR       | Bunt   | Single | Triple     | Triple | Triple    |
| MVP          | Bunt   | Single | Triple     | Triple | Triple    |
| Yankees      | Bunt   | Single | Double     | Double | Triple    |
| 2,000 hits   | Bunt   | Single | Triple     | Triple | Triple    |
| Cy Young     | Bunt   | Double | Triple     | Triple | Triple    |
| Mariners     | Bunt   | Single | Double     | Double | Triple    |
| Hall of Fame | Bunt   | Single | Triple     | Triple | Triple    |

New questions start uniform, so every non-pick answer is a Double until fans play them. The curated
estimates are a prior only; nothing in the database pretends they are observations.

## Data integrity

Five things are deliberately kept apart:

1. **Submissions:** every attempt, logged with its outcome (an audit trail; never used for rarity).
2. **Accepted answers:** at most one per round (`rounds.accepted_player_id`).
3. **Rarity observations:** the first accepted answer a participant gives to a question version. Later
   games, practice and replays still score but add nothing (unique index). Each IP hash can add at most 5
   observations per question version per day.
4. **Snapshots:** frozen distributions built from observations by an explicit refresh.
5. **Awarded scores:** fixed points written on the round when it's accepted, summed in SQL for the game.

## Limitations

- **Anonymous identity is a cookie.** Participant ids are server-issued and HMAC-signed, so they can't be
  forged or chosen, but anyone can clear cookies and become a new participant. That's a Sybil attack on
  rarity. The per-IP observation cap, rate limits and α-smoothing blunt it; they don't stop a determined
  attacker with many IPs. Before a public leaderboard: accounts or device attestation, outlier detection on
  observation bursts, and Turnstile on game creation.
- **Rate limits** are fixed windows in Postgres: simple and approximate (bursts at window edges).
- **The observation policy is "first answer ever"** per participant and question version, so returning
  players' changing tastes don't count. A per-season window is a future option.
- **Calibration and α are design choices**, not fitted to data. Revisit them once real distributions exist.
  `calc_version` is stored with each snapshot.
- **Rule picks** for new questions are provisional, and some are active players whose stats will change.
- **Dataset:** all limitations under [Player data](#player-data). World Series titles require a Series
  appearance; birthplace questions skip 933 players with no birthplace.
- No public leaderboard yet; the schema keeps per-game totals, modes and daily dates to support one.

## Tests

`npm test` runs unit and integration tests. Integration tests start a fresh **in-memory PostgreSQL
(PGlite)** with the real migrations and dataset, and pass time in explicitly, so deadlines are exact.

- **Rarity:** prior normalization and tier ordering; uniform priors; the smoothing formula; sums to 1 at
  every sample size; zero-observation = prior; low-sample stability; convergence of data over prior;
  calibration vs. raw compression; monotonicity; ties; determinism; unknown valid answers > 0; the pick =
  Plákata and everyone else capped at Triple; curated priors valid and ordered for the original seven.
- **Server gameplay:** seven rounds created; random mode distinct and balanced; signed token claims;
  refresh/re-start doesn't reset the timer; read period rejected; wrong / unknown guesses keep the round
  open and count; a valid answer ends the round with server-computed points; the pick = Plákata;
  **three simultaneous correct answers award points once**; token replay; the latency grace boundary
  (750 ms accepted, 751 ms rejected); expired tokens; `complete` before/after the deadline; lazy expiry;
  forged / tampered / cross-round / cross-question tokens; other participants; a full seven-round game
  totaled by the server; observations (only accepted, one per participant, IP cap); **snapshots frozen for
  old games and the daily while new games use the refresh**; daily determinism.
- **Questions:** every criteria type against dataset facts plus synthetic edge cases (season gaps,
  missing pitching, unknown birthplace, territories); schema rejects malformed criteria; every pick is
  eligible; selection has no duplicates, is balanced and is deterministic per day.
- **Tokens and cookies:** round-trip, expiry, tampering, `alg: none`; cookie signatures; IP hashing.
- Plus v1's name-matching, validation, scoring, screen-render and client-reducer tests.

Manual check: a production build (`next start`) driven in Chrome covered the read period, a wrong
guess, a mid-round refresh (the clock continued, not reset), a valid answer and a time-out Strikeout,
with no console errors. The HTTP API was also exercised with real cookies, including forged tokens and
foreign game ids.

## Ideas for the next version

1. **Accounts or attestation** before any leaderboard (see Limitations), then daily leaderboards.
2. **Post-round reveal:** the most common and rarest answers from the frozen snapshot.
3. **Fit α and the calibration** to real distributions once a few thousand games exist.
4. **More aliases** generated from Baseball-Reference/Retrosheet name variants.
5. **Playwright end-to-end tests** for the timer and keyboard flows.
