/**
 * The admin Question Builder, end to end: sign in, draft a statistical question,
 * validate it, take the suggested Plákata pick, test answers (including the Top-5
 * Bunt override and the 1893 pitching floor), publish, and disable it.
 */
import { expect, test, type Page } from "@playwright/test";
import { E2E_ADMIN_PASSWORD } from "../playwright.config";

const PROMPT = "Name a pitcher who struck out at least 300 batters in a single season.";

async function signIn(page: Page) {
  await page.goto("/admin/questions");
  await page.getByLabel("Admin password").fill(E2E_ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "New question" })).toBeVisible();
}

test("admin APIs refuse requests without a session", async ({ request }) => {
  expect((await request.get("/api/admin/session")).status()).toBe(200);
  expect(await (await request.get("/api/admin/session")).json()).toMatchObject({ enabled: true, authenticated: false });
  expect((await request.get("/api/admin/questions")).status()).toBe(401);
});

test("a wrong password is rejected", async ({ page }) => {
  await page.goto("/admin/questions");
  await page.getByLabel("Admin password").fill("not-the-password-at-all");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText(/password/i).last()).toBeVisible();
  await expect(page.getByRole("button", { name: "New question" })).toHaveCount(0);
});

test("draft, validate, test answers, publish and disable a statistical question", async ({ page }) => {
  await signIn(page);
  await expect(page.getByText("No custom questions yet.")).toBeVisible();
  await expect(page.getByRole("heading", { name: /Built-in questions \(43\)/ })).toBeVisible();

  // 1. Draft.
  await page.getByRole("button", { name: "New question" }).click();
  await page.getByLabel("Question text").fill(PROMPT);
  await page.getByRole("combobox", { name: /^Statistic/ }).selectOption("pitcherStrikeouts");
  await page.getByRole("combobox", { name: /^Scope/ }).selectOption("season");
  await page.getByRole("textbox", { name: /^At least/ }).fill("300");
  await expect(page.getByRole("checkbox", { name: /^Automatically award Bunt/ })).toBeChecked();
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Draft saved.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Edit question" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish" })).toBeDisabled();

  // 2. Validate without a pick: blocked, with a suggestion.
  await page.getByRole("button", { name: "Validate question" }).click();
  await expect(page.getByText("Validation finished.")).toBeVisible();
  const report = page.locator("section", { has: page.getByRole("heading", { name: "Validation results" }) });
  await expect(report.getByText("Not ready to publish")).toBeVisible();
  await expect(report.getByText("Choose this question's Plákata pick")).toBeVisible();

  // The 1893 floor: modern leaders, not 1880s pitchers.
  await expect(report.getByText(/from 1893 on/)).toBeVisible();
  const leaders = report.locator("ol");
  for (const name of ["Nolan Ryan", "Sandy Koufax", "Randy Johnson", "Rube Waddell", "Bob Feller"]) {
    await expect(leaders.getByText(name)).toBeVisible();
  }
  await expect(leaders.getByText("Matt Kilroy")).toHaveCount(0);

  // 3. Take the suggested pick, save, validate again: ready.
  await report.getByRole("button", { name: /^Use suggestion:/ }).click();
  await expect(page.getByLabel("Plákata pick (player id)")).not.toHaveValue("");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Draft saved.")).toBeVisible();
  await page.getByRole("button", { name: "Validate question" }).click();
  await expect(report.getByText("Valid: ready to publish")).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish" })).toBeEnabled();

  // 4. Test answers the way a player would type them.
  const tester = page.locator("section", { has: page.getByRole("heading", { name: "Test an answer" }) });
  const testAnswer = async (name: string) => {
    await tester.getByPlaceholder("Type a player name, as a player would").fill(name);
    await tester.getByRole("button", { name: "Test" }).click();
  };
  await testAnswer("nolan ryan");
  await expect(tester.getByText("Qualifies", { exact: false }).first()).toBeVisible();
  await expect(tester.getByText(/Expected: Bunt \(\+10\) · Top-5 Bunt override/)).toBeVisible();
  // Kilroy's 513 (1886) still counts as a valid answer, just without the automatic Bunt.
  await testAnswer("Matt Kilroy");
  await expect(tester.getByText(/^Qualifies/)).toBeVisible();
  await expect(tester.getByText(/Top-5 Bunt override/)).toHaveCount(0);
  await testAnswer("Tony Gwynn Sr.");
  await expect(tester.getByText(/^Does not qualify/)).toBeVisible();

  // 5. Publish, then disable.
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Published: it can now appear in random games and future dailies.")).toBeVisible();
  await expect(page.getByText(/Live: version 1 \(in rotation\)/)).toBeVisible();
  const mine = page.locator("section", { has: page.getByRole("heading", { name: "Your questions" }) });
  await expect(mine.getByText(PROMPT)).toBeVisible();
  await expect(mine.getByText("published")).toBeVisible();

  await page.getByRole("button", { name: "Disable" }).click();
  await expect(page.getByText("Disabled: it won't be picked for new games.")).toBeVisible();
  await expect(page.getByText(/Live: version 1 \(disabled\)/)).toBeVisible();

  // 6. Survives a reload, and signing out locks the page again.
  await page.reload();
  await expect(mine.getByText(PROMPT)).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByLabel("Admin password")).toBeVisible();
});
