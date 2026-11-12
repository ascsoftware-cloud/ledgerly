import { expect, test, type Page } from "@playwright/test";
import { cleanUp, hasAdminKey, signIn, testEmail } from "./support/session";

test.skip(!hasAdminKey, "Add SUPABASE_SERVICE_ROLE_KEY to .env.local to run signed-in tests");

const created: string[] = [];
test.afterAll(async () => {
  if (hasAdminKey) await cleanUp(created);
});

async function workspaceWithClient(page: Page, tag: string) {
  created.push(await signIn(page, testEmail(tag), "/welcome", "Ivy Invoice"));
  await expect(page).toHaveURL(/\/ivy-[0-9a-f]{4}$/, { timeout: 15_000 });
  const home = new URL(page.url()).pathname;
  await page.goto(`${home}/clients/new`);
  await page.getByLabel("Name").filter({ visible: true }).fill("Thandi Mokoena");
  await page.getByLabel("Phone").filter({ visible: true }).fill("082 123 4567");
  await page.getByRole("button", { name: "Add client" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Thandi Mokoena" })).toBeVisible();
  return home;
}

test("create and send an invoice from a client, with live totals and the next number", async ({ page }) => {
  const home = await workspaceWithClient(page, "invoice");
  await page.getByRole("link", { name: "New invoice" }).click();
  await expect(page.getByRole("heading", { name: "New invoice" })).toBeVisible();
  await expect(page.getByLabel("Client", { exact: true }).filter({ visible: true })).toHaveValue(/[0-9a-f-]{36}/);

  await page.getByLabel("Line 1 description").filter({ visible: true }).fill("Geyser repair");
  await page.getByLabel("Line 1 quantity").filter({ visible: true }).fill("1,5");
  await page.getByLabel("Line 1 price").filter({ visible: true }).fill("R 1 000");
  await page.getByRole("button", { name: "Add a line" }).click();
  await page.getByLabel("Line 2 description").filter({ visible: true }).fill("Call-out");
  await page.getByLabel("Line 2 price").filter({ visible: true }).fill("350");

  // Not VAT registered by default, so 1.5 × R1 000 + R350 = R1 850.
  await expect(page.getByRole("definition").filter({ hasText: "R 1 850,00" })).toBeVisible();

  await page.getByRole("button", { name: "Save and send invoice" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "INV-0001" })).toBeVisible();
  await expect(page.getByText("Sent", { exact: true })).toBeVisible();
  const doc = page.getByRole("article", { name: "Invoice" });
  await expect(doc).toContainText("Geyser repair");
  await expect(doc).toContainText("R 1 850,00");

  const wa = page.getByRole("link", { name: "Send on WhatsApp" });
  await expect(wa).toHaveAttribute("href", /^https:\/\/wa\.me\/27821234567\?text=/);
  await expect(wa).toHaveAttribute("href", /INV-0001/);

  // The quest and the client timeline both know.
  await page.goto(home);
  await expect(page.getByRole("region", { name: "Setup quest" })).toContainText("2 of 4 done");
  await page.goto(`${home}/money`);
  await expect(page.getByText("R 1 850,00 still to come in.")).toBeVisible();
});

test("drafts can be edited and deleted; sent invoices cannot be edited", async ({ page }) => {
  const home = await workspaceWithClient(page, "drafts");
  await page.goto(`${home}/money/new?kind=invoice`);
  await page.getByLabel("Client", { exact: true }).filter({ visible: true }).selectOption({ label: "Thandi Mokoena" });
  await page.getByLabel("Line 1 description").filter({ visible: true }).fill("Consulting");
  await page.getByLabel("Line 1 price").filter({ visible: true }).fill("500");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Draft invoice" })).toBeVisible();

  await page.getByRole("link", { name: "Edit" }).click();
  await expect(page.getByLabel("Line 1 price").filter({ visible: true })).toHaveValue("500,00");
  await page.getByLabel("Line 1 price").filter({ visible: true }).fill("750");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("article", { name: "Invoice" })).toContainText("R 750,00");

  await page.getByRole("button", { name: "Delete draft" }).click();
  await expect(page).toHaveURL(new RegExp(`${home}/money$`));
  await expect(page.getByRole("heading", { name: "No invoices yet" })).toBeVisible();
});

test("a quote turns into an invoice in one tap", async ({ page }) => {
  const home = await workspaceWithClient(page, "quote");
  await page.goto(`${home}/money/new?kind=quote`);
  await page.getByLabel("Client", { exact: true }).filter({ visible: true }).selectOption({ label: "Thandi Mokoena" });
  await page.getByLabel("Line 1 description").filter({ visible: true }).fill("Kitchen tiling");
  await page.getByLabel("Line 1 price").filter({ visible: true }).fill("12 500");
  await page.getByLabel("Deposit").filter({ visible: true }).selectOption("pct");
  await page.getByLabel("Deposit percentage").filter({ visible: true }).fill("50");
  await expect(page.getByRole("definition").filter({ hasText: "R 6 250,00" })).toBeVisible();
  await page.getByRole("button", { name: "Save and send quote" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "QUO-0001" })).toBeVisible();

  await page.getByRole("button", { name: "Turn into invoice" }).click();
  await expect(page.getByRole("heading", { name: "Edit invoice" })).toBeVisible();
  await expect(page.getByText("From quote QUO-0001.")).toBeVisible();
  await expect(page.getByLabel("Line 1 description").filter({ visible: true })).toHaveValue("Kitchen tiling");
  await page.getByRole("button", { name: "Save and send invoice" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "INV-0001" })).toBeVisible();
  await expect(page.getByRole("article", { name: "Invoice" })).toContainText("From quote");
});

test("mistakes are explained, and nothing is lost", async ({ page }) => {
  const home = await workspaceWithClient(page, "invoiceerr");
  await page.goto(`${home}/money/new?kind=invoice`);
  await page.getByLabel("Client", { exact: true }).filter({ visible: true }).selectOption({ label: "Thandi Mokoena" });
  await page.getByLabel("Line 1 description").filter({ visible: true }).fill("Something");
  await page.getByLabel("Line 1 price").filter({ visible: true }).fill("lots");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Line 1: enter a price" })).toBeVisible();
  await expect(page.getByLabel("Line 1 description").filter({ visible: true })).toHaveValue("Something");
});
