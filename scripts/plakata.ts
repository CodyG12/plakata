/**
 * Plakata admin CLI. Run with: npm run plakata -- <command> [args]
 *
 *   setup                 migrate + import players + sync questions (first run, and after data changes)
 *   db:migrate            apply pending SQL migrations
 *   players:import        upsert players.json + aliases into the players table
 *   questions:sync        make the database match src/data/question-bank.ts (new versions, disable removed)
 *   questions:list        active questions with eligible-answer counts and observation counts
 *   questions:preview <slug|all>
 *                         eligible-answer count and a sample, from the bank definition (no DB writes)
 *   questions:coverage    dataset coverage for each criteria type (missing fields)
 *   rarity:refresh [--alpha N]
 *                         rebuild scoring snapshots from community observations
 *   daily:show [YYYY-MM-DD]
 *                         show (and create if missing) a day's daily challenge
 *
 * Uses DATABASE_URL if set, otherwise the local PGlite database in .data/pglite.
 */
import { count } from "drizzle-orm";
import { QUESTION_BANK } from "@/data/question-bank";
import { getPlayerIndex } from "@/lib/baseball/dataset";
import { utcDay } from "@/lib/questions/selection";
import { closeDb, getDb, migrateDatabase } from "@/server/db/client";
import { rarityObservations } from "@/server/db/schema";
import { getOrCreateDaily } from "@/server/game-service";
import {
  eligiblePlayerIds,
  getVersions,
  importPlayers,
  listActiveVersions,
  refreshSnapshots,
  syncQuestionBank,
} from "@/server/question-store";
import { questionCriteriaSchema } from "@/types/baseball";

const [command, ...args] = process.argv.slice(2);

async function main() {
  const index = getPlayerIndex();
  switch (command) {
    case "setup": {
      await migrateDatabase();
      console.log("Migrations applied.");
      const db = await getDb();
      console.log(`Imported ${await importPlayers(db, index)} players (${index.meta.release}).`);
      printSync(await syncQuestionBank(db, index));
      return;
    }
    case "db:migrate":
      await migrateDatabase();
      console.log("Migrations applied.");
      return;
    case "players:import":
      console.log(`Imported ${await importPlayers(await getDb(), index)} players.`);
      return;
    case "questions:sync":
      printSync(await syncQuestionBank(await getDb(), index));
      return;
    case "questions:list": {
      const db = await getDb();
      const obs = await db
        .select({ id: rarityObservations.questionVersionId, n: count() })
        .from(rarityObservations)
        .groupBy(rarityObservations.questionVersionId);
      const byId = new Map(obs.map((o) => [o.id, Number(o.n)]));
      const rows = (await listActiveVersions(db)).sort((a, b) => a.category.localeCompare(b.category) || a.slug.localeCompare(b.slug));
      for (const q of rows) {
        console.log(`${q.category.padEnd(13)} ${`${q.slug} v${q.version}`.padEnd(28)} ${String(q.eligibleCount).padStart(6)} eligible  ${String(byId.get(q.id) ?? 0).padStart(6)} observations`);
      }
      console.log(`${rows.length} active questions`);
      return;
    }
    case "questions:preview": {
      const target = args[0];
      if (!target) throw new Error("usage: questions:preview <slug|all>");
      const defs = target === "all" ? QUESTION_BANK : QUESTION_BANK.filter((d) => d.slug === target);
      if (defs.length === 0) throw new Error(`No question "${target}" in the bank`);
      for (const def of defs) {
        const ids = eligiblePlayerIds(questionCriteriaSchema.parse(def.criteria), index);
        const sample = ids.slice(0, 8).map((id) => index.getById(id)!.name).join(", ");
        const pick = index.getById(def.plakataPick);
        console.log(`${def.slug}: ${ids.length} eligible. Plákata pick: ${pick?.name ?? def.plakataPick}${ids.includes(def.plakataPick) ? "" : " (NOT ELIGIBLE)"}`);
        console.log(`  "${def.prompt}"`);
        if (target !== "all") console.log(`  e.g. ${sample}${ids.length > 8 ? ", …" : ""}`);
      }
      return;
    }
    case "questions:coverage": {
      const players = index.all();
      const pct = (n: number) => `${((100 * n) / players.length).toFixed(1)}%`;
      const missingCountry = players.filter((p) => p.birthCountry === null).length;
      const noPitching = players.filter((p) => p.career.wins === undefined).length;
      const noBatting = players.filter((p) => p.career.homeRuns === undefined).length;
      console.log(`Dataset: ${index.meta.source}, ${index.meta.release}, ${players.length} players`);
      console.log(`  birthplace unknown:      ${missingCountry} (${pct(missingCountry)}): never eligible for birthplace questions`);
      console.log(`  no pitching rows:        ${noPitching} (${pct(noPitching)}): pitching thresholds need a pitching record`);
      console.log(`  no batting rows:         ${noBatting} (${pct(noBatting)})`);
      console.log("  World Series: titles count only modern Series (1903+) in which the player appeared");
      console.log("  All-Star: AllstarFull covers 1933+; selection = on the roster, played or not");
      return;
    }
    case "rarity:refresh": {
      const alphaFlag = args.indexOf("--alpha");
      const alpha = alphaFlag >= 0 ? Number(args[alphaFlag + 1]) : undefined;
      const reports = await refreshSnapshots(await getDb(), { alpha });
      for (const r of reports) console.log(`${r.slug.padEnd(26)} snapshot ${r.snapshotId}  ${r.observations} observations`);
      console.log(`Refreshed ${reports.length} snapshots. New games use them; games in progress keep theirs.`);
      return;
    }
    case "daily:show": {
      const day = args[0] ?? utcDay(Date.now());
      const db = await getDb();
      const daily = await getOrCreateDaily(db, day);
      const versions = await getVersions(db, daily.questionVersionIds);
      console.log(`Daily challenge ${day}:`);
      daily.questionVersionIds.forEach((id, i) => {
        const v = versions.get(id)!;
        console.log(`  ${i + 1}. [${v.category}] ${v.prompt}  (v${v.version}, snapshot ${daily.snapshotIds[i]})`);
      });
      return;
    }
    default:
      console.log("Commands: setup, db:migrate, players:import, questions:sync, questions:list, questions:preview <slug|all>, questions:coverage, rarity:refresh [--alpha N], daily:show [day]");
      if (command) process.exitCode = 1;
  }
}

function printSync(reports: Awaited<ReturnType<typeof syncQuestionBank>>) {
  for (const r of reports) {
    if (r.action !== "unchanged") console.log(`  ${r.action.padEnd(11)} ${r.slug} v${r.version} (${r.eligibleCount} eligible)`);
  }
  const unchanged = reports.filter((r) => r.action === "unchanged").length;
  console.log(`Questions synced: ${reports.length - unchanged} changed, ${unchanged} unchanged.`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closeDb());

