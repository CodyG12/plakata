import { defineConfig } from "drizzle-kit";

// Migrations are generated from the schema (`npm run db:generate`) and committed.
// They run against PostgreSQL in production and PGlite locally.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  // Only needed by drizzle-kit commands that connect (migrate/studio). Uses the direct URL.
  ...(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL
    ? { dbCredentials: { url: (process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL)! } }
    : {}),
});
