import { expect, test } from "@playwright/test";
import { cleanUp, hasAdminKey, signIn, testEmail } from "./support/session";

test.skip(!hasAdminKey, "Add SUPABASE_SERVICE_ROLE_KEY to .env.local to run signed-in tests");

const created: string[] = [];
test.afterAll(async () => {
  if (hasAdminKey) await cleanUp(created);
});

// Shaped like a real export: a title, account details, a blank line, then the table and a closing balance.
const STATEMENT = [
  "ACCOUNT TRANSACTION HISTORY",
  "Account,62000000000",
  "",
  "Date,Amount,Balance,Description",
  "01/11/2026,-450.00,9550.00,POS PURCHASE ENGEN RIVONIA",
  "03/11/2026,2300.00,11850.00,MAGTAPE CREDIT THANDI INV0001",
  "04/11/2026,-65.00,11785.00,MONTHLY ACCOUNT FEE",
  ",,,CLOSING BALANCE",
].join("\r\n");

test("import a statement, skip it the second time, match money in and log money out", async ({ page }) => {
  const userId = await signIn(page, testEmail("bank"), "/welcome", "Bongani Bank");
  created.push(userId);
  await expect(page).toHaveURL(/\/bongani-[0-9a-f]{4}$/, { timeout: 15_000 });
  const home = new URL(page.url()).pathname;

  await page.goto(`${home}/clients/new`);
  await page.getByLabel("Name").fill("Thandi Mokoena");
  await page.getByRole("button", { name: "Add client" }).click();
  await page.getByRole("link", { name: "New invoice" }).click();
  await page.getByLabel("Line 1 description").filter({ visible: true }).fill("Plumbing");
  await page.getByLabel("Line 1 price").filter({ visible: true }).fill("2 300");
  await page.getByRole("button", { name: "Save and send invoice" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "INV-0001" })).toBeVisible();

  await page.goto(`${home}/money/bank`);
  const file = { name: "fnb-november.csv", mimeType: "text/csv", buffer: Buffer.from(STATEMENT) };
  await page.getByLabel("Bank statement CSV").setInputFiles(file);
  const check = page.getByRole("region", { name: "Check the columns" });
  await expect(check.getByRole("status")).toContainText("3 transactions found");
  await expect(check.getByRole("status")).toContainText("Skipped 1 balance or summary rows");
  await check.getByRole("button", { name: "Import 3 transactions" }).click();
  await expect(page.getByText("Added 3 lines.")).toBeVisible();

  await page.getByLabel("Bank statement CSV").setInputFiles(file);
  await page.getByRole("region", { name: "Check the columns" }).getByRole("button", { name: "Import 3 transactions" }).click();
  await expect(page.getByText("Added 0 lines, skipped 3 already imported.")).toBeVisible();

  const todo = page.getByRole("list", { name: "Lines to sort out" });
  await expect(todo.getByRole("listitem")).toHaveCount(3);

  // The invoice number in the description is recognised; one tap confirms it.
  const credit = todo.getByRole("listitem", { name: /MAGTAPE CREDIT/ });
  await credit.getByRole("button", { name: "Confirm match" }).click();
  await expect(page.getByText("Payment recorded")).toBeVisible();

  const fuel = page.getByRole("list", { name: "Lines to sort out" }).getByRole("listitem", { name: /ENGEN/ });
  await fuel.getByLabel(/Category for/).selectOption({ label: "Fuel and travel" });
  await fuel.getByRole("button", { name: "Make expense" }).click();
  await expect(page.getByText("Expense logged")).toBeVisible();

  await page.getByRole("list", { name: "Lines to sort out" }).getByRole("listitem", { name: /ACCOUNT FEE/ }).getByRole("button", { name: "Ignore" }).click();
  await expect(page.getByText("Nothing to sort out")).toBeVisible();

  await page.getByRole("link", { name: "All lines", exact: true }).click();
  const all = page.getByRole("list", { name: "All statement lines" });
  await expect(all).toContainText("Paid INV-0001");
  await expect(all).toContainText("Logged as an expense");

  await page.goto(`${home}/money`);
  await expect(page.getByRole("list", { name: "Invoices" })).toContainText("Paid");
  await page.goto(`${home}/money/expenses?month=2026-11`);
  await expect(page.getByRole("list", { name: /Expenses in/ })).toContainText("POS PURCHASE ENGEN RIVONIA");
});
