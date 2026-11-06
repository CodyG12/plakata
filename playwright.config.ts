/**
 * End-to-end tests (`npm run test:e2e`): a real browser against a production build of
 * the app. The server runs on a throwaway PGlite database (PLAKATA_DB=pglite wins over
 * any DATABASE_URL in .env.local), freshly set up with the bundled dataset and question
 * bank on every run, so these tests never touch Neon.
 */
import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
export const E2E_ADMIN_PASSWORD = "e2e-admin-password-123";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // one shared database: tests run in order
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  timeout: 60_000,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `rm -rf .data/e2e-pglite && npm run plakata -- setup && npx next build && npx next start -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}/api/admin/session`,
    timeout: 300_000,
    reuseExistingServer: false,
    stdout: "pipe",
    env: {
      PLAKATA_DB: "pglite",
      PGLITE_DIR: ".data/e2e-pglite",
      PLAKATA_ALLOW_PGLITE: "1",
      ADMIN_PASSWORD: E2E_ADMIN_PASSWORD,
      PLAKATA_SECRET: "e2e-only-secret-not-used-anywhere-else-0123456789",
    },
  },
});
