import { expect, test } from "@playwright/test";
import { admin, cleanUp, hasAdminKey, signIn, testEmail, userClient } from "./support/session";

test.skip(!hasAdminKey, "Add SUPABASE_SERVICE_ROLE_KEY to .env.local to run signed-in tests");

const created: string[] = [];
test.afterAll(async () => {
  if (hasAdminKey) await cleanUp(created);
});

// A 1×1 PNG, small enough to keep the test fast.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

test("log an expense with a receipt, see it in the month, archive it and undo", async ({ page }) => {
  const userId = await signIn(page, testEmail("expense"), "/welcome", "Eddie Expense");
  created.push(userId);
  await expect(page).toHaveURL(/\/eddie-[0-9a-f]{4}$/, { timeout: 15_000 });
  const home = new URL(page.url()).pathname;

  await page.getByRole("button", { name: "Quick add" }).filter({ visible: true }).click();
  await page.getByRole("menuitem", { name: "Log expense" }).click();
  const form = page.getByRole("form", { name: "Log an expense" });
  await form.getByRole("button", { name: "Log expense" }).click();
  await expect(form.getByRole("alert")).toContainText("Enter the amount");

  await form.getByLabel("Amount (R)").fill("1 150,00");
  await form.getByLabel("Category").selectOption({ label: "Fuel and travel" });
  await form.getByLabel(/Supplier/).fill("Engen Rivonia");
  await form.getByLabel(/Receipt/).setInputFiles({ name: "slip.png", mimeType: "image/png", buffer: PNG });
  await form.getByRole("button", { name: "Log expense" }).click();
  await expect(page.getByText("Expense logged.")).toBeVisible();

  const list = page.getByRole("list", { name: /Expenses in/ });
  await expect(list).toContainText("Engen Rivonia");
  await expect(list).toContainText("R 1 150,00");
  await expect(page.getByRole("region", { name: "Month" })).toContainText("VAT to claim R 150,00");

  // The receipt is private: only a short-lived signed link opens it.
  await list.getByRole("link", { name: /Engen Rivonia/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Engen Rivonia" })).toBeVisible();
  const popup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "View receipt" }).click();
  const receipt = await popup;
  expect(receipt.url()).toMatch(/\/storage\/v1\/object\/sign\/receipts\/.+token=/);
  await receipt.close();

  // Someone from another workspace cannot fetch the file, even knowing its path.
  const { data: row } = await admin().from("expenses").select("receipt_path").eq("created_by", userId).single();
  const outsiderEmail = testEmail("outsider");
  const outsider = await userClient(outsiderEmail);
  const { data: outsiderUser } = await outsider.auth.getUser();
  if (outsiderUser.user) created.push(outsiderUser.user.id);
  const stolen = await outsider.storage.from("receipts").download(row!.receipt_path as string);
  expect(stolen.data).toBeNull();
  const link = await outsider.storage.from("receipts").createSignedUrl(row!.receipt_path as string, 60);
  expect(link.data).toBeNull();

  await page.getByRole("button", { name: "Archive" }).click();
  await expect(page.getByText("Expense archived")).toBeVisible();
  await expect(page.getByRole("list", { name: /Expenses in/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Expense is back")).toBeVisible();
  await expect(page.getByRole("list", { name: /Expenses in/ })).toContainText("Engen Rivonia");

  await page.goto(home);
  await expect(page.getByRole("region", { name: "Setup quest" })).toBeVisible();
});

test("a repeating cost is listed with its next date and can be stopped", async ({ page }) => {
  const userId = await signIn(page, testEmail("rent"), "/welcome", "Rita Rent");
  created.push(userId);
  await expect(page).toHaveURL(/\/rita-[0-9a-f]{4}$/, { timeout: 15_000 });
  const home = new URL(page.url()).pathname;
  await page.goto(`${home}/money/expenses/new`);
  const form = page.getByRole("form", { name: "Log an expense" });
  await form.getByLabel("Amount (R)").fill("8 000");
  await form.getByLabel("Category").selectOption({ label: "Rent" });
  await form.getByLabel(/Supplier/).fill("Landlord");
  await form.getByLabel(/This repeats/).selectOption("monthly");
  await form.getByRole("button", { name: "Log expense" }).click();
  await expect(page.getByText("Expense logged.")).toBeVisible();
  const repeating = page.getByRole("region", { name: "Repeating costs" });
  await expect(repeating).toContainText("Landlord · every month · next");
  await repeating.getByRole("button", { name: "Stop Landlord" }).click();
  await expect(page.getByText("Landlord stopped")).toBeVisible();
  await expect(page.getByRole("region", { name: "Repeating costs" })).toHaveCount(0);
});
