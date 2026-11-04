import rawDataset from "@/data/players.json";
import { PLAYER_ALIASES } from "@/data/aliases";
import type { BaseballPlayer, PlayerSummary, PlayersDataset } from "@/types/baseball";
import { normalizeName, stripSuffix } from "./normalize-name";

/**
 * In-memory index over the Lahman-derived player dataset. Built once per
 * server process (the JSON is ~3.5 MB, so it is never sent to the browser).
 */
export interface PlayerIndex {
  meta: PlayersDataset["meta"];
  getById(id: string): BaseballPlayer | undefined;
  /** Players whose primary name or an explicit alias normalizes to `name`. */
  findByName(name: string): BaseballPlayer[];
  /** Players whose last name (final token) normalizes to `lastName`. */
  findByLastName(lastName: string): BaseballPlayer[];
  summarize(player: BaseballPlayer): PlayerSummary;
  teamName(teamId: string): string;
  /** Deterministic "how well-known is this player" signal used only for ordering. */
  prominence(player: BaseballPlayer): number;
}

export function createPlayerIndex(
  dataset: PlayersDataset,
  aliases: ReadonlyArray<readonly [string, string]> = [],
): PlayerIndex {
  const byId = new Map<string, BaseballPlayer>();
  const byName = new Map<string, BaseballPlayer[]>();
  const byLastName = new Map<string, BaseballPlayer[]>();

  const add = (map: Map<string, BaseballPlayer[]>, key: string, player: BaseballPlayer) => {
    const list = map.get(key);
    if (!list) map.set(key, [player]);
    else if (!list.includes(player)) list.push(player);
  };

  for (const player of dataset.players) {
    byId.set(player.id, player);
    const key = normalizeName(player.name);
    add(byName, key, player);
    add(byLastName, key.split(" ").at(-1) ?? key, player);
  }
  for (const [alias, id] of aliases) {
    const player = byId.get(id);
    if (!player) throw new Error(`Alias "${alias}" points to unknown player ${id}`);
    const key = normalizeName(alias);
    add(byName, key, player);
  }

  const prominence = (p: BaseballPlayer) =>
    p.games + (p.hof !== null ? 1500 : 0) + 400 * (p.mvp.length + p.cyYoung.length);

  const byProminence = (a: BaseballPlayer, b: BaseballPlayer) =>
    prominence(b) - prominence(a) || a.id.localeCompare(b.id);

  const teamName = (teamId: string) => dataset.teams[teamId] ?? teamId;

  const summarize = (player: BaseballPlayer): PlayerSummary => {
    const years =
      player.firstYear === player.lastYear ? `${player.firstYear}` : `${player.firstYear}–${player.lastYear}`;
    const shown = player.teams.slice(0, 2).map(teamName);
    const extra = player.teams.length - shown.length;
    return {
      id: player.id,
      name: player.name,
      detail: `${years} · ${shown.join(", ")}${extra > 0 ? ` +${extra} more` : ""}`,
    };
  };

  return {
    meta: dataset.meta,
    getById: (id) => byId.get(id),
    findByName(name) {
      // Exact form first (so "Ken Griffey Jr." hits its alias), then without "Jr."/"Sr.".
      const key = normalizeName(name);
      const matches = byName.get(key) ?? byName.get(stripSuffix(key)) ?? [];
      return [...matches].sort(byProminence);
    },
    findByLastName: (lastName) => [...(byLastName.get(normalizeName(lastName)) ?? [])].sort(byProminence),
    summarize,
    teamName,
    prominence,
  };
}

let defaultIndex: PlayerIndex | undefined;

/** Shared index over the bundled dataset and curated aliases. */
export function getPlayerIndex(): PlayerIndex {
  defaultIndex ??= createPlayerIndex(rawDataset as PlayersDataset, PLAYER_ALIASES);
  return defaultIndex;
}
