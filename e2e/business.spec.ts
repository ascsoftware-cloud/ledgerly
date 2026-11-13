import { expect, test } from "@playwright/test";
import { cleanUp, hasAdminKey, signIn, testEmail } from "./support/session";

test.skip(!hasAdminKey, "Add SUPABASE_SERVICE_ROLE_KEY to .env.local to run signed-in tests");

const created: string[] = [];
test.afterAll(async () => {
  if (hasAdminKey) await cleanUp(created);
});

test("the owner can change the business name and VAT details, and it shows across the app", async ({ page }) => {
  const owner = await signIn(page, testEmail("biz"), "/welcome", "Busi Business");
  created.push(owner);
  await expect(page).toHaveURL(/\/busi-[0-9a-f]{4}$/, { timeout: 15_000 });
  const home = new URL(page.url()).pathname;

  await page.goto(`${home}/more`);
  await page.getByRole("link", { name: /^Business details/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Business details" })).toBeVisible();

  const form = page.getByRole("form", { name: "Business details" });
  await form.getByLabel("Business name").fill("");
  await form.getByRole("button", { name: "Save" }).click();
  await expect(form.getByRole("alert")).toContainText("Enter your business name");

  await form.getByLabel("Business name").fill("Busi's Bakery");
  await form.getByLabel("Company registration number").fill("2020/123456/07");
  await form.getByLabel("We are registered for VAT").check();
  await form.getByLabel("VAT number").fill("123");
  await form.getByRole("button", { name: "Save" }).click();
  await expect(form.getByRole("alert")).toContainText("10 digits and start with 4");
  await form.getByLabel("VAT number").fill("4123 456 789");
  await form.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();

  // It stays after a reload, and the app uses the new name.
  await page.reload();
  await expect(page.getByLabel("Business name")).toHaveValue("Busi's Bakery");
  await expect(page.getByLabel("VAT number")).toHaveValue("4123456789");
  await page.goto(home);
  await expect(page.getByRole("link", { name: "Busi's Bakery" }).first()).toBeVisible();
});
