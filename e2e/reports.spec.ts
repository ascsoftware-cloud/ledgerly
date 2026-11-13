import { expect, test } from "@playwright/test";
import { admin, cleanUp, hasAdminKey, signIn, testEmail, userClient } from "./support/session";

test.skip(!hasAdminKey, "Add SUPABASE_SERVICE_ROLE_KEY to .env.local to run signed-in tests");

const created: string[] = [];
test.afterAll(async () => {
  if (hasAdminKey) await cleanUp(created);
});

// Today in South Africa.
const today = new Date(Date.now() + 2 * 3600_000).toISOString().slice(0, 10);

test("reports show the numbers, export to CSV and PDF, and are closed to staff", async ({ page, browser }, testInfo) => {
  const email = testEmail("reports");
  const owner = await signIn(page, email, "/welcome", "Rita Reports");
  created.push(owner);
  await expect(page).toHaveURL(/\/rita-[0-9a-f]{4}$/, { timeout: 15_000 });
  const home = new URL(page.url()).pathname;

  // One sent invoice (R2 000, no VAT) and one expense (R450), both today, made the way the app makes them.
  const me = await userClient(email);
  const db = admin();
  const { data: ws } = await me.from("workspaces").select("id").eq("created_by", owner).single();
  const workspace_id = ws!.id as string;
  const { data: contact } = await me.from("contacts").insert({ workspace_id, name: "Thandi Mokoena" }).select("id").single();
  const { data: docId, error: draftError } = await me.rpc("save_document_draft", {
    p_workspace: workspace_id,
    p_id: null,
    p_doc: { kind: "invoice", contact_id: contact!.id },
    p_lines: [{ description: "Geyser", quantity: 2, unit_cents: 100000, vat_rate: 0 }],
  });
  expect(draftError).toBeNull();
  expect((await me.rpc("send_document", { p_id: docId })).error).toBeNull();
  expect((await me.from("expenses").insert({ workspace_id, spent_on: today, amount_cents: 45000, payment_method: "cash" })).error).toBeNull();

  await page.goto(`${home}/reports`);
  await expect(page.getByRole("heading", { level: 1, name: "Reports" })).toBeVisible();
  const pnl = page.getByRole("table", { name: /Profit and loss/ });
  await expect(pnl).toContainText("R 2 000,00");
  await expect(pnl).toContainText("R 1 550,00");
  await expect(page.getByRole("term").filter({ hasText: "Profit" })).toBeVisible();

  await page.getByRole("link", { name: "Aged debtors" }).click();
  await expect(page.getByText("Total owed to you:")).toContainText("R 2 000,00");
  await expect(page.getByRole("table", { name: /Unpaid invoices/ })).toContainText("INV-0001");

  await page.getByRole("link", { name: "Cash flow" }).click();
  await expect(page.getByRole("table", { name: "Cash-flow forecast by week" }).getByRole("row")).toHaveCount(14);
  await expect(page.getByText("Expected in").locator("xpath=..")).toContainText("R 2 000,00");

  await page.getByRole("link", { name: "VAT", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("not set up as VAT-registered");

  // A period outside the data is zero, not an error.
  await page.getByRole("link", { name: "Profit and loss" }).click();
  await expect(page.getByRole("table", { name: /Profit and loss/ })).toBeVisible();
  await page.getByRole("link", { name: "Last tax year" }).click();
  await expect(page.getByRole("link", { name: "Last tax year" })).toHaveAttribute("aria-current", "true");
  await expect(page.getByRole("table", { name: /Profit and loss/ })).toContainText("R 0,00");

  // Exports.
  const csv = await page.request.get(`${home}/reports/export?r=pnl&period=this-month&format=csv`);
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-disposition"]).toContain("attachment");
  const text = await csv.text();
  expect(text.startsWith("﻿")).toBe(true);
  expect(text).toContain("Profit,1550");
  const pdf = await page.request.get(`${home}/reports/export?r=aged&format=pdf`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect((await pdf.body()).subarray(0, 4).toString()).toBe("%PDF");
  expect((await page.request.get(`${home}/reports/export?r=nope&format=csv`)).status()).toBe(404);

  // Staff see no Reports in the menu, no page and no export.
  const staffContext = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
  const sp = await staffContext.newPage();
  const staffId = await signIn(sp, testEmail("staff"), "/welcome", "Sam Staff");
  created.push(staffId);
  await expect(sp).toHaveURL(/\/sam-[0-9a-f]{4}$/, { timeout: 15_000 });
  const added = await db.from("memberships").insert({ workspace_id, user_id: staffId, role: "staff" });
  expect(added.error).toBeNull();
  await sp.goto(`${home}`);
  await expect(sp.getByRole("link", { name: "Money" }).filter({ visible: true }).first()).toBeVisible();
  await expect(sp.getByRole("link", { name: "Reports" }).filter({ visible: true })).toHaveCount(0);
  await sp.goto(`${home}/reports`);
  await expect(sp.getByRole("heading", { level: 1, name: "We can't find that page" })).toBeVisible();
  expect((await sp.request.get(`${home}/reports/export?r=pnl&period=this-month&format=csv`)).status()).toBe(404);
  await staffContext.close();
});
