/**
 * Database connection. Server-only: never import this from a client component.
 *
 *  - DATABASE_URL set → PostgreSQL via node-postgres (Neon, Supabase, RDS, local Postgres…).
 *  - DATABASE_URL unset (local dev) → PGlite, real Postgres compiled to WASM, persisted
 *    in .data/pglite. Same schema, same migrations, same SQL.
 *
 * In production DATABASE_URL is required: PGlite on a serverless host would lose data.
 */
import { join } from "node:path";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
/** A transaction handle has the same query API as Db. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type Executor = Db | Tx;

export const MIGRATIONS_FOLDER = join(process.cwd(), "drizzle");

interface Handle {
  db: Db;
  ready: Promise<void>;
  close(): Promise<void>;
}

async function openPostgres(url: string): Promise<Handle> {
  const [{ Pool }, { drizzle }] = await Promise.all([import("pg"), import("drizzle-orm/node-postgres")]);
  // Small pool: serverless functions each get their own; use the provider's pooled URL.
  const pool = new Pool({ connectionString: url, max: Number(process.env.DATABASE_POOL_MAX ?? 5) });
  const db = drizzle(pool, { schema }) as unknown as Db;
  return { db, ready: Promise.resolve(), close: () => pool.end() };
}

/** dataDir undefined = in-memory (tests). */
export async function openPglite(dataDir?: string, opts: { migrate?: boolean } = {}): Promise<Handle> {
  const [{ PGlite }, { drizzle }, { migrate }] = await Promise.all([
    import("@electric-sql/pglite"),
    import("drizzle-orm/pglite"),
    import("drizzle-orm/pglite/migrator"),
  ]);
  if (dataDir) {
    const { mkdirSync } = await import("node:fs");
    mkdirSync(dataDir, { recursive: true }); // PGlite won't create parent directories
  }
  const client = dataDir ? new PGlite(dataDir) : new PGlite();
  const db = drizzle(client, { schema });
  // PGlite runs in-process and is always ours, so it's migrated on open.
  const ready = opts.migrate === false ? client.waitReady : migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return { db: db as unknown as Db, ready: ready.then(() => undefined), close: () => client.close() };
}

/** Applies pending migrations (`npm run plakata -- db:migrate`). */
export async function migrateDatabase(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    const handle = await getHandle();
    await handle.ready;
    return;
  }
  const [{ Pool }, { drizzle }, { migrate }] = await Promise.all([
    import("pg"),
    import("drizzle-orm/node-postgres"),
    import("drizzle-orm/node-postgres/migrator"),
  ]);
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await pool.end();
  }
}

const globalForDb = globalThis as unknown as { __plakataDb?: Promise<Handle> };

function getHandle(): Promise<Handle> {
  // Cached on globalThis so Next.js dev hot reloads reuse one connection/PGlite instance.
  globalForDb.__plakataDb ??= (async () => {
    const url = process.env.DATABASE_URL;
    if (url) return openPostgres(url);
    if (process.env.NODE_ENV === "production" && process.env.PLAKATA_ALLOW_PGLITE !== "1") {
      throw new Error("DATABASE_URL is not set. Production needs a PostgreSQL database (see README).");
    }
    return openPglite(process.env.PGLITE_DIR ?? join(process.cwd(), ".data", "pglite"));
  })();
  return globalForDb.__plakataDb;
}

export async function getDb(): Promise<Db> {
  const handle = await getHandle();
  await handle.ready;
  return handle.db;
}

/** For scripts: close the shared connection so the process can exit. */
export async function closeDb(): Promise<void> {
  const pending = globalForDb.__plakataDb;
  globalForDb.__plakataDb = undefined;
  if (pending) await (await pending).close();
}

/** Tests: swap in a specific database (e.g. an in-memory PGlite). */
export function setDbForTesting(handle: Handle | undefined): void {
  globalForDb.__plakataDb = handle ? Promise.resolve(handle) : undefined;
}
