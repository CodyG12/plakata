/**
 * The landing page keeps only the rule headlines; the full rules live in the
 * How to play dialog, which opens modally and closes with the X, Escape or a
 * click on the backdrop.
 */
import { expect, test } from "@playwright/test";

test("How to play opens the full rules and closes three ways", async ({ page }) => {
  await page.goto("/");
  const dialog = page.getByRole("dialog", { name: "How to play" });
  const open = page.getByRole("button", { name: "How to play" });
  await expect(open).toBeVisible();
  await expect(dialog).toBeHidden();
  if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/landing.png`, fullPage: true });

  await open.click();
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("seconds to read the prompt");
  await expect(dialog).toContainText("Bunt 10 · Single 25");
  await expect(dialog).toContainText("strikeout");
  if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/how-to-play.png` });
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
  await expect(open).toBeFocused(); // focus goes back to the trigger

  await open.click();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await open.click();
  await page.mouse.click(5, 5); // the backdrop, outside the panel
  await expect(dialog).toBeHidden();
});
