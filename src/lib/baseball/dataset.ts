import rawDataset from "@/data/players.json";
import { PLAYER_ALIASES } from "@/data/aliases";
import type { BaseballPlayer, PlayersDataset } from "@/types/baseball";
import { normalizeName } from "./normalize-name";
import { damerauLevenshtein } from "./string-distance";

/** Where a lookup key came from. */
export interface FuzzyMatch {
  distance: number;
  /** Every player whose key lies at the minimum distance found. */
  playerIds: Set<string>;
  /**
   * For each of those players, the properly spelled text that was matched
   * (canonical name, else alias, else surname/first name) — used to build a
   * "Did you mean …?" suggestion that resolves back to the same player.
   */
  spelling: Map<string, string>;
}

/**
 * In-memory lookup tables over the Lahman-derived dataset. Built once per
 * server process (the JSON is ~3.5 MB and is never sent to the browser).
 *
 * The index knows nothing about questions, popularity, or eligibility — name
 * resolution must be decided by the name alone.
 */
export interface PlayerIndex {
  meta: PlayersDataset["meta"];
  getById(id: string): BaseballPlayer | undefined;
  /** Players whose canonical name normalizes to `key`. */
  byCanonicalName(key: string): ReadonlySet<string>;
  /** Players with a verified alias that normalizes to `key`. */
  byAlias(key: string): ReadonlySet<string>;
  /** Players whose surname — or first name — alone normalizes to `key`. */
  byPartialName(key: string): ReadonlySet<string>;
  /**
   * Closest canonical names and aliases (and, if `includePartial`, surnames and
   * first names) within `maxDistance` edits of `key`.
   */
  fuzzy(key: string, maxDistance: number, includePartial: boolean): FuzzyMatch | null;
  teamName(teamId: string): string;
  /** Properly spelled text for a normalized key (canonical name, alias, or partial name). */
  displayOf(key: string): string | undefined;
}

const EMPTY: ReadonlySet<string> = new Set();

export function createPlayerIndex(
  dataset: PlayersDataset,
  aliases: ReadonlyArray<readonly [string, string]> = [],
): PlayerIndex {
  const byId = new Map<string, BaseballPlayer>();
  const canonical = new Map<string, Set<string>>();
  const alias = new Map<string, Set<string>>();
  const partial = new Map<string, Set<string>>();

  /** Properly spelled display text for each normalized key. */
  const display = new Map<string, string>();

  const add = (map: Map<string, Set<string>>, text: string, id: string) => {
    const key = normalizeName(text);
    if (!key) return;
    const set = map.get(key);
    if (set) set.add(id);
    else map.set(key, new Set([id]));
    if (!display.has(key)) display.set(key, text.trim());
  };

  for (const player of dataset.players) {
    byId.set(player.id, player);
    add(canonical, player.name, player.id);
    add(partial, player.lastName, player.id);
    add(partial, player.name.slice(0, player.name.length - player.lastName.length), player.id);
  }
  for (const [name, id] of aliases) {
    if (!byId.has(id)) throw new Error(`Alias "${name}" points to unknown player ${id}`);
    add(alias, name, id);
  }

  // Fuzzy candidates bucketed by key length, so a lookup only scans keys whose
  // length is within maxDistance of the input. Lower rank = preferred spelling.
  type Entry = { key: string; ids: Set<string>; rank: number; text: string };
  const buckets = new Map<number, Entry[]>();
  const pushEntries = (map: Map<string, Set<string>>, rank: number) => {
    for (const [key, ids] of map) {
      const list = buckets.get(key.length);
      const entry = { key, ids, rank, text: display.get(key) ?? key };
      if (list) list.push(entry);
      else buckets.set(key.length, [entry]);
    }
  };
  pushEntries(canonical, 0);
  pushEntries(alias, 1);
  pushEntries(partial, 2);

  return {
    meta: dataset.meta,
    getById: (id) => byId.get(id),
    byCanonicalName: (key) => canonical.get(key) ?? EMPTY,
    byAlias: (key) => alias.get(key) ?? EMPTY,
    byPartialName: (key) => partial.get(key) ?? EMPTY,
    teamName: (teamId) => dataset.teams[teamId] ?? teamId,
    displayOf: (key) => display.get(key),

    fuzzy(key, maxDistance, includePartial) {
      if (maxDistance <= 0) return null;
      let best: FuzzyMatch | null = null;
      const rankOf = new Map<string, number>();
      const record = (match: FuzzyMatch, entry: Entry) => {
        for (const id of entry.ids) {
          match.playerIds.add(id);
          if (entry.rank < (rankOf.get(id) ?? Infinity)) {
            rankOf.set(id, entry.rank);
            match.spelling.set(id, entry.text);
          }
        }
      };
      for (let len = key.length - maxDistance; len <= key.length + maxDistance; len++) {
        for (const entry of buckets.get(len) ?? []) {
          if (entry.rank === 2 && !includePartial) continue;
          const limit = best ? best.distance : maxDistance;
          const distance = damerauLevenshtein(key, entry.key, limit);
          if (distance > limit) continue;
          if (!best || distance < best.distance) {
            best = { distance, playerIds: new Set(), spelling: new Map() };
            rankOf.clear();
          }
          record(best, entry);
        }
      }
      return best;
    },

  };
}

let defaultIndex: PlayerIndex | undefined;

/** Shared index over the bundled dataset and curated aliases. */
export function getPlayerIndex(): PlayerIndex {
  defaultIndex ??= createPlayerIndex(rawDataset as PlayersDataset, PLAYER_ALIASES);
  return defaultIndex;
}
