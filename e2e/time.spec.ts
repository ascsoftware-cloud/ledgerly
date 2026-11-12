import { expect, test } from "@playwright/test";
import { cleanUp, hasAdminKey, signIn, testEmail } from "./support/session";

test.skip(!hasAdminKey, "Add SUPABASE_SERVICE_ROLE_KEY to .env.local to run signed-in tests");

const created: string[] = [];
test.afterAll(async () => {
  if (hasAdminKey) await cleanUp(created);
});

test("the timer survives a reload, hours are billed to a draft invoice once only", async ({ page }) => {
  const userId = await signIn(page, testEmail("time"), "/welcome", "Tumi Time");
  created.push(userId);
  await expect(page).toHaveURL(/\/tumi-[0-9a-f]{4}$/, { timeout: 15_000 });
  const home = new URL(page.url()).pathname;

  await page.goto(`${home}/clients/new`);
  await page.getByLabel("Name").fill("Thandi Mokoena");
  await page.getByRole("button", { name: "Add client" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Thandi Mokoena" })).toBeVisible();

  await page.goto(`${home}/work/projects/new`);
  const form = page.getByRole("form", { name: "New project" });
  await form.getByLabel("Project name").fill("Bathroom");
  await form.getByLabel(/Client/).selectOption({ label: "Thandi Mokoena" });
  await form.getByLabel(/Hourly rate/).fill("400");
  await form.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Bathroom" })).toBeVisible();

  // Timer: start, reload, still running, stop.
  const timer = page.getByRole("region", { name: "Timer" });
  await timer.getByLabel("What are you working on?").fill("Remove old tiles");
  await timer.getByRole("button", { name: "Start timer" }).click();
  await expect(page.getByRole("timer")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("timer")).toHaveText(/^0:00:\d\d$/);
  await page.getByRole("region", { name: "Timer" }).getByRole("button", { name: "Stop" }).click();
  await expect(page.getByText("Time saved")).toBeVisible();

  // Manual time.
  const log = page.getByRole("form", { name: "Log time" });
  await log.getByLabel("How long").fill("1:30");
  await log.getByLabel("What was done").fill("Waterproofing");
  await log.getByRole("button", { name: "Log" }).click();
  await expect(page.getByText("Time logged")).toBeVisible();
  await log.getByLabel("How long").fill("banana");
  await log.getByRole("button", { name: "Log" }).click();
  await expect(log.getByRole("alert")).toContainText("How long?");

  // Bill only the 1h30.
  const entries = page.getByRole("list", { name: "Time entries" });
  await expect(entries.getByRole("listitem")).toHaveCount(2);
  await entries.getByRole("checkbox", { name: "Bill Remove old tiles" }).uncheck();
  await page.getByRole("button", { name: "Bill 1h 30m" }).click();
  await expect(page.getByText("Draft invoice ready to check")).toBeVisible();
  await expect(page.getByRole("article", { name: "Invoice" })).toContainText("Waterproofing");
  await expect(page.getByRole("article", { name: "Invoice" })).toContainText("R 600,00");

  // Back on the project, those hours are on the invoice and cannot be ticked again.
  await page.goBack();
  await page.reload();
  await expect(page.getByRole("list", { name: "Time entries" })).toContainText("on a draft invoice");
  await expect(page.getByRole("checkbox", { name: "Bill Waterproofing" })).toHaveCount(0);
});
