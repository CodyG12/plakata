# Deep Cuts — baseball trivia where obscure wins

A Krillion-style baseball trivia game. Each round asks for an MLB player who fits a prompt
("at least 300 career home runs", "played for the Seattle Mariners"…). Any valid player counts,
but **rarer answers score more** — Babe Ruth earns 5 points; Jay Buhner earns 60.

Seven rounds, 30 seconds each, up to 100 points per round (700 max).

## Quick start

```bash
npm install
npm run dev          # http://localhost:3000
```

| Command              | What it does                                    |
| -------------------- | ----------------------------------------------- |
| `npm run dev`        | Dev server                                      |
| `npm test`           | Unit tests (Vitest)                             |
| `npm run lint`       | ESLint                                          |
| `npm run typecheck`  | TypeScript                                      |
| `npm run build`      | Production build (`npm start` to serve it)      |
| `npm run build:data` | Regenerate `src/data/players.json` (see below)  |

Deploys to Vercel as-is — no environment variables, database, or other services.

## How to play

1. Press **Play Game**.
2. Type a player's name. Suggestions appear after two letters; use ↑/↓ and **Enter**, or click one.
3. Your first answer that resolves to a real player is locked in — right or wrong.
   Typos ("not found") don't use up the round; the clock keeps running and you can try again.
4. If the name you typed belongs to several qualifying players, you'll be asked which one you meant.
5. When time runs out with nothing locked in, the round scores zero.

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
    normalize-name.ts     Case/accent/punctuation/initials normalization (not fuzzy)
    dataset.ts            Player index: lookup by name, alias, surname; autocomplete search
    criteria.ts           Does player X satisfy question criteria Y? (+ factual explanation)
    validate-answer.ts    Input → canonical player → ValidationResult
    calculate-rarity.ts   ValidationResult → ScoreResult via a chain of RarityEstimators
  lib/game/
    reducer.ts            Game state machine (landing → playing → round-result → game-complete)
    use-countdown.ts      Deadline-based timer hook (one interval per round, always cleaned up)
  app/api/
    players/search        GET  ?q=   → autocomplete suggestions (searches ALL players)
    answers               POST {questionId, input | playerId} → { validation, score? }
  components/game/        Screens: Landing, Game, RoundResult, FinalResults + parts
```

**Why server routes?** The full player dataset is ~3.5 MB, too large to ship to the browser. Validation and
autocomplete run in two small Next.js route handlers; the client bundle contains no player data. All game
logic is plain TypeScript and unit-tested independently of React and Next.

**State machine.** Every round-scoped action carries its `roundIndex`, and the reducer rejects anything that
doesn't match the current state. That makes stale timer ticks, double submits, late network responses, and
skipping ahead harmless. The timer stores an absolute deadline rather than a counter, so it can't drift or
double-count, and it survives refreshes. A submission sent before the deadline is honored if its response
arrives within a 3-second grace period.

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

| Question | Qualifying players | Rule (all from Lahman) |
| --- | --- | --- |
| 300+ career HR | 165 | Sum of `Batting.HR` |
| MVP winner | 160 | `AwardsPlayers` "Most Valuable Player" |
| Played for the Yankees | 1,837 | Any `Appearances` row with teamID `NYA` (1903–present) |
| 2,000+ career hits | 298 | Sum of `Batting.H` |
| Cy Young winner | 88 | `AwardsPlayers` "Cy Young Award" |
| Played for the Mariners | 1,036 | Any `Appearances` row with teamID `SEA` (1977–present) |
| Hall of Fame | 281 | `HallOfFame` inducted = Y **and** category = Player |

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

**Name matching.** Matching ignores case, accents, punctuation and spacing in initials, so "Raúl Ibañez" =
"Raul Ibanez" and "JJ Putz" = "J. J. Putz". "Jr."/"Sr." suffixes are optional. There is no fuzzy or
edit-distance matching, so a typo is "not found" rather than silently mapped to a different player.
Nicknames such as "Big Papi", "Goose Gossage" and "Ichiro" work only through the explicit list in
`aliases.ts`.

**Duplicate names.** 731 names belong to more than one player. When a typed name matches several players:

- **Exactly one qualifies:** it's credited, and the result says so. "Randy Johnson" for Cy Young means the
  Big Unit, not the two 1980s namesakes.
- **None qualify:** the answer is invalid.
- **Several qualify:** the player is asked to choose (e.g., both Ken Griffeys for the Mariners).

## Rarity scoring (provisional)

Scores are labeled **"Estimated Rarity"** throughout the UI. They are **not** measured community answer
frequencies, search volume, or pageviews.

- `rarity-estimates.ts` puts well-known players into hand-curated, **question-specific** tiers:
  iconic **5**, famous **20**, well-known **40**, known **60**. The same player can score differently on
  different questions. Jay Buhner is 20 on the Mariners question, 60 on the 300-HR question, and an
  uncurated 75 as a Yankee.
- Any valid player who isn't curated for that question gets the documented **fallback of 75** ("deep cut,
  provisional"). Uncurated players are presumed less commonly named than curated ones, but there's no
  evidence for how much.
- Invalid answers, unanswered rounds and timeouts score 0. Points equal the rarity score.
- The test suite verifies that every curated player ID exists and actually satisfies its question. Writing
  that check caught several of the author's wrong assumptions, such as Mel Ott never winning an MVP and
  Christian Yelich being short of 300 HR.

Scoring is a chain of `RarityEstimator`s (`calculate-rarity.ts`). A future estimator can be inserted ahead
of the curated one without touching validation or UI code, for example community answer frequencies with
Bayesian smoothing toward the curated prior.

## Tests

`npm test` runs 53 unit tests covering:

- **Normalization:** case, accents, apostrophes, initials, suffixes.
- **Validation against the real dataset:** valid and invalid answers for all seven questions, aliases,
  accented names, not-found input, the three duplicate-name outcomes, and surname-only input.
- **Scoring:** curated vs. fallback scores, determinism, the 0–100 bounds, and that every curated ID is valid.
- **Game reducer:** the full seven-round loop and the total, double-submit prevention, timeout scoring zero,
  late and stale responses, no skipping ahead, restart, and save/restore including corrupted saves.

Not automated: component/browser tests. The UI was checked manually in Chrome at desktop width and at 375px
mobile width.

## Ideas for version two

1. **Real rarity data.** Log every submission per question. Score with `1 − P(answer)`, using Bayesian
   smoothing toward the curated tiers until a question has enough plays. This is the core of the game and
   needs a small database (e.g., Postgres or KV).
2. **Server-authoritative rounds.** The server currently trusts the client's clock and round state. That's
   fine for a demo, but a leaderboard would need the server to issue signed round tokens.
3. **A larger question bank.** Add new criteria types (teams by franchise, positions, seasons, stat
   thresholds, All-Star selections, World Series champions, birthplace) and pick seven at random or daily.
4. **More aliases.** Generate nickname coverage from Baseball-Reference/Retrosheet name variants, and accept
   misspellings only through a "did you mean …?" confirmation step.
5. **Better disambiguation labels.** Store "Jr./Sr." relationships so namesakes display as "Ken Griffey Jr."
6. **Post-round reveal.** Show the most common answers and the rarest valid answers, which also teaches
   players what counts as a deep cut.
7. **Component tests and an end-to-end Playwright run** covering timer expiry and keyboard flows.
