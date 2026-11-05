import { defineConfig } from "drizzle-kit";

// Migrations are generated from the schema (`npm run db:generate`) and committed.
// They run against PostgreSQL in production and PGlite locally.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
});
