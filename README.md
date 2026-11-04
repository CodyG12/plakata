# Plákata — baseball trivia where obscure wins

A Krillion-style baseball trivia game. Each round asks for an MLB player who fits a prompt
("at least 300 career home runs", "played for the Seattle Mariners"…). Any valid player counts,
but **rarer answers score more**: every round is a Strikeout, Bunt, Single, Double, Triple or Plákata.
Babe Ruth on the 300-HR question is a Bunt; Jay Buhner there is a Triple.

Seven rounds: 3 seconds to read each prompt, then 30 seconds to answer. Up to 100 points per round (700 max).

## Quick start

```bash
npm install
npm run dev          # http://localhost:3000
```

| Command              | What it does                                   |
| -------------------- | ---------------------------------------------- |
| `npm run dev`        | Dev server                                     |
| `npm test`           | Unit tests (Vitest)                            |
| `npm run lint`       | ESLint                                         |
| `npm run typecheck`  | TypeScript                                     |
| `npm run build`      | Production build (`npm start` to serve it)     |
| `npm run build:data` | Regenerate `src/data/players.json` (see below) |

Deploys to Vercel as-is — no environment variables, database, or other services.

## How to play

1. Press **Swing Away**.
2. Each round opens with **3 seconds to read the prompt**. Only the prompt and a short countdown show; the
   answer field and Submit button are hidden and the 30-second clock holds. When reading ends, the field
   appears with focus and the clock starts.
3. Type a player's name from memory and press **Enter** or **Submit**. There are no suggestions, so the
   interface never hints at possible answers.
4. **Guess as many times as you like.** A rejected guess shows a short message, clears the field, and the
   clock keeps running. Wrong guesses cost nothing but time.
5. Minor typos get a correction: type "Derek Jeeter" and the field changes to "Derek Jeter" with **"Did you
   mean Derek Jeter?"** Press Enter to submit it, or edit it. A suggestion isn't counted as a wrong guess,
   and the clock keeps running. For father/son namesakes, the plain name means the father: "Ken Griffey"
   is submitted as Ken Griffey Sr., and only "Ken Griffey Jr." reaches the son. A surname alone
   that several players share ("Griffey", "Johnson") must be typed as a full name. A full name shared by
   unrelated players ("Randy Johnson") counts if any of them fits the question; if several fit, you pick
   which one you meant.
6. The first **valid** answer ends the round. It's always a hit, classified by its estimated rarity
   (see [Scoring](#scoring)).
7. When time runs out without a valid answer, the round is a **Strikeout** and scores zero.

An in-progress game survives a page refresh (saved in `localStorage`; the timer keeps counting).

## Architecture

```
scripts/
  download-lahman.sh      Fetch the needed Lahman CSVs from SABR
  build-dataset.mjs       CSVs → src/data/players.json (pure derivation, no hand edits)
src/
  data/
    players.json          24,011 players (generated, ~3.5 MB, server-only)
    questions.ts          The seven questions + round length — edit to change the game
    rarity-estimates.ts   Curated, per-question popularity tiers (provisional)
    aliases.ts            Nicknames / Jr.-Sr. disambiguation → player IDs
  lib/baseball/           Pure, UI-independent game logic
    normalize-name.ts     Case/accent/punctuation/initials normalization
    string-distance.ts    Damerau-Levenshtein distance with early cut-off
    dataset.ts            Lookup tables: canonical names, aliases, surnames/first names, fuzzy buckets
    resolve-player.ts     Typed text → exactly one player, or ambiguous/unrecognized (no question knowledge)
    criteria.ts           Does player X satisfy question criteria Y? (+ factual explanation)
    validate-answer.ts    resolve-player → criteria → ValidationResult (generic messages when rejected)
    calculate-rarity.ts   ValidationResult → rarity estimate (chain of RarityEstimators) → ScoreResult
    scoring.ts            Tier names, rarity thresholds and fixed points: the only place they're defined
  lib/game/
    reducer.ts            Game state machine (landing → playing → round-result → game-complete)
    use-countdown.ts      Deadline-based timer hook (one interval per round, always cleaned up)
  app/api/
    answers               POST {questionId, input} → { validation, score? }  (score only when valid)
  components/game/        Screens: Landing, Game, RoundResult, FinalResults + parts
```

**Why server routes?** The full player dataset is ~3.5 MB, too large to ship to the browser. Validation runs
in one small Next.js route handler; the client bundle contains no player data. All game
logic is plain TypeScript and unit-tested independently of React and Next.

**State machine.** Every round-scoped action carries its `roundIndex`, and the reducer rejects anything that
doesn't match the current state. That makes stale timer ticks, double submits, late network responses, and
skipping ahead harmless. The timer stores an absolute deadline rather than a counter, so it can't drift or
double-count, and it survives refreshes.

**Round rules in the reducer.** Only a valid answer ends a round early. Rejected guesses (ineligible,
ambiguous, or unrecognized) increment an attempt counter and keep the round open. Network errors don't
count as attempts. A guess can't start at or after the deadline.
A _correct_ guess sent before the deadline still counts if its response arrives within a 3-second grace
period. Anything else that resolves after the deadline ends the round with zero points.

## Player data

**Source:** [SABR Lahman Baseball Database](https://sabr.org/lahman-database/), release 1871–2025
(published Dec 10, 2025), licensed **CC BY-SA 3.0**. To regenerate:

```bash
scripts/download-lahman.sh /tmp/lahman
npm run build:data -- /tmp/lahman
```

**Coverage:** every one of the 24,011 people with at least one recorded major-league appearance in Lahman.
That includes the leagues SABR recognizes as major: NA (1871–75), AA, UA, PL, FL, and the Negro Leagues
(1920–48).

| Question                | Qualifying players | Rule (all from Lahman)                                 |
| ----------------------- | ------------------ | ------------------------------------------------------ |
| 300+ career HR          | 165                | Sum of `Batting.HR`                                    |
| MVP winner              | 160                | `AwardsPlayers` "Most Valuable Player"                 |
| Played for the Yankees  | 1,837              | Any `Appearances` row with teamID `NYA` (1903–present) |
| 2,000+ career hits      | 298                | Sum of `Batting.H`                                     |
| Cy Young winner         | 88                 | `AwardsPlayers` "Cy Young Award"                       |
| Played for the Mariners | 1,036              | Any `Appearances` row with teamID `SEA` (1977–present) |
| Hall of Fame            | 281                | `HallOfFame` inducted = Y **and** category = Player    |

**Known limitations and judgment calls**

- Career totals include every league Lahman treats as major. That includes the 1871–75 National
  Association, which MLB's official records exclude, so a few 19th-century totals differ from MLB.com.
- "MVP" is whatever Lahman labels Most Valuable Player. That includes the Chalmers Award (1911–14) and the
  League Awards (1922–29). Babe Ruth's 1923 award counts, for example.
- "Yankees" includes the 1903–12 New York Highlanders (same franchise, same teamID). It excludes the
  1901–02 Baltimore Orioles. "Mariners" excludes the 1969 Seattle Pilots, who are today's Brewers.
- Hall of Fame counts only people inducted as **players**. Executives, managers, umpires and pioneers are
  excluded. That includes Negro Leagues players inducted in the Player category.
- Stats are never coerced to zero. A player with no batting record would get `null` and fail stat questions
  with an explicit message. In this release every player has batting rows.
- Data is current through the 2025 season and the 2026 Hall of Fame Era Committee election (Jeff Kent).

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

Every round ends in exactly one tier with fixed points. All of it lives in `src/lib/baseball/scoring.ts`.

| Tier      | Estimated rarity | Points |
| --------- | ---------------- | -----: |
| Strikeout | no valid answer  |      0 |
| Bunt      | 0–19             |     10 |
| Single    | 20–39            |     25 |
| Double    | 40–59            |     50 |
| Triple    | 60–79            |     75 |
| Plákata   | 80–100           |    100 |

- The thresholds are **provisional**; edit `SCORING_TIERS` to change them.
- `classifyRarity()` rounds and clamps the estimate to 0–100, then picks the highest tier whose minimum
  it reaches. A valid answer is always at least a Bunt, never zero.
- A Strikeout happens only when time runs out without a valid answer, however many wrong guesses came
  first.
- The game total is the sum of the round points: 700 at most (7 × Plákata).
- The estimated rarity is stored apart from the points. The round result shows only the tier and points.

### Rarity estimates (provisional)

Rarity estimates are **not** measured community answer frequencies, search volume, or pageviews.

- `rarity-estimates.ts` puts well-known players into hand-curated, **question-specific** tiers:
  iconic **5** (Bunt), famous **20** (Single), well-known **40** (Double), known **60** (Triple). The same
  player can score differently on different questions. Jay Buhner is 20 on the Mariners question
  (Single), 60 on the 300-HR question (Triple), and an uncurated 75 as a Yankee (Triple).
- Any valid player who isn't curated for that question gets the documented **fallback of 75** ("deep cut,
  provisional"). Uncurated players are presumed less commonly named than curated ones, but there's no
  evidence for how much.
- **Exactly one Plákata per question.** `PLAKATA_PICKS` names one hand-picked, deliberately obscure
  player per question (rarity 100). Every other uncurated answer is a Triple; the fallback must stay
  below 80. Starting picks are the eligible, uncurated player with the fewest career games: Richie
  Sexson (300 HR), Spud Chandler (MVP), Deacon White (2,000 hits), LaMarr Hoyt (Cy Young) and Frank
  Grant (Hall of Fame). For the Yankees and Mariners that rule lands on one-game players, so those are
  hand-picked instead: Hensley Meulens and Mickey Brantley. Tests check every pick exists, qualifies
  and isn't also curated for that question.
- The test suite verifies that every curated player ID exists and actually satisfies its question. Writing
  that check caught several of the author's wrong assumptions, such as Mel Ott never winning an MVP and
  Christian Yelich being short of 300 HR.

Scoring is a chain of `RarityEstimator`s (`calculate-rarity.ts`). A future estimator can be inserted ahead
of the curated one without touching validation or UI code, for example community answer frequencies with
Bayesian smoothing toward the curated prior.

## Tests

`npm test` runs 96 unit tests covering:

- **Normalization:** case, accents, apostrophes, initials, suffixes.
- **Name resolution against the real dataset:** exact names, aliases, accents, typo tolerance,
  "Did you mean" suggestions (and that each one resolves back to the same player), the father/son Sr.
  default, unique vs. shared surnames, identical full names returned as namesakes, exact-over-fuzzy
  precedence (Jim Rice vs. Jim Price), and strict short-name matching.
- **Isolated fixture:** typo ties, near-neighbour precedence, and database-wide ambiguity.
- **Validation:** surnames never resolved by the question; namesakes accepted when one fits, rejected when
  none fit, and offered as a choice when several fit (only listed choices accepted); rejected results expose
  nothing but a status and a generic message.
- **Damerau-Levenshtein** distance and its early cut-off.
- **Scoring:** the six tiers, names and points; every threshold boundary; every rarity 0–100 mapping to
  exactly one non-zero hit; clamping; Strikeouts at zero; the 700 maximum; curated vs. fallback estimates,
  determinism, and that every curated ID is valid.
- **Screens:** the round result, final box score, landing rules and progress labels render the tier names
  and points; every tier color and animation has a theme token.
- **Game reducer:** the full seven-round loop and the total; unlimited incorrect guesses with the timer
  untouched; a valid answer ending the round; double-submit and duplicate-response prevention; timeouts
  as Strikeouts; late and stale responses; no skipping ahead; restart; save/restore including corrupted
  saves.

Not automated: browser tests. Screens are covered by server-render tests (`results-render.test.ts`). The
tiered results UI was checked manually in Chrome at desktop width; it has not yet been re-checked at 375px.

## Ideas for version two

1. **Real rarity data.** Log every submission per question. Score with `1 − P(answer)`, using Bayesian
   smoothing toward the curated tiers until a question has enough plays. This is the core of the game and
   needs a small database (e.g., Postgres or KV).
2. **Server-authoritative rounds.** The server currently trusts the client's clock and round state. That's
   fine for a demo, but a leaderboard would need the server to issue signed round tokens.
3. **A larger question bank.** Add new criteria types (teams by franchise, positions, seasons, stat
   thresholds, All-Star selections, World Series champions, birthplace) and pick seven at random or daily.
4. **More aliases.** Generate nickname and Jr./Sr. coverage from Baseball-Reference or Retrosheet name
   variants instead of a hand-written list.
5. **Post-round reveal.** Show the most common answers and the rarest valid answers, which also teaches
   players what counts as a deep cut.
6. **Component tests and an end-to-end Playwright run** covering timer expiry and keyboard flows.
