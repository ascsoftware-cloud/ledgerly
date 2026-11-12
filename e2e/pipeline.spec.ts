import { expect, test } from "@playwright/test";
import { cleanUp, hasAdminKey, signIn, testEmail } from "./support/session";

test.skip(!hasAdminKey, "Add SUPABASE_SERVICE_ROLE_KEY to .env.local to run signed-in tests");

const created: string[] = [];
test.afterAll(async () => {
  if (hasAdminKey) await cleanUp(created);
});

test("add a deal, move it along with the keyboard, and see it on the client's timeline", async ({ page }) => {
  created.push(await signIn(page, testEmail("pipeline"), "/welcome", "Petra Pipe"));
  await expect(page).toHaveURL(/\/petra-[0-9a-f]{4}$/, { timeout: 15_000 });
  const home = new URL(page.url()).pathname;

  await page.goto(`${home}/clients/new`);
  await page.getByLabel("Name").fill("Thandi Mokoena");
  await page.getByRole("button", { name: "Add client" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Thandi Mokoena" })).toBeVisible();

  await page.goto(`${home}/clients`);
  await page.getByRole("navigation", { name: "Client views" }).getByRole("link", { name: "Pipeline" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Pipeline" })).toBeVisible();
  const stages = page.getByRole("list", { name: "Pipeline stages" });
  await expect(stages.getByRole("heading", { level: 2 })).toHaveText([/New lead/, /In talks/, /Quote sent/, /Won/, /Lost/]);

  const form = page.getByRole("form", { name: "Add a deal" });
  await form.getByLabel("Deal").fill("Bathroom revamp");
  await form.getByLabel("Value (R)").fill("4 500");
  await form.getByLabel("Client").selectOption({ label: "Thandi Mokoena" });
  await form.getByRole("button", { name: "Add deal" }).click();

  const lead = page.getByRole("region", { name: "New lead" });
  await expect(lead.getByText("Bathroom revamp")).toBeVisible();
  await expect(lead).toContainText("R 4 500,00");
  await expect(page.getByText("R 4 500,00 in open deals.")).toBeVisible();

  const right = page.getByRole("button", { name: "Move Bathroom revamp to In talks" });
  await right.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("region", { name: "In talks" }).getByText("Bathroom revamp")).toBeVisible();
  await expect(lead.getByText("Bathroom revamp")).toHaveCount(0);

  await page.getByRole("region", { name: "In talks" }).getByRole("link", { name: "Thandi Mokoena" }).click();
  await expect(page.getByRole("region", { name: "Timeline" })).toContainText("Bathroom revamp moved to In talks");
});
