import { createHmac } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { admin, cleanUp, hasAdminKey, publicPath, signIn, testEmail, userClient } from "./support/session";

test.skip(!hasAdminKey, "Add SUPABASE_SERVICE_ROLE_KEY to .env.local to run signed-in tests");

const created: string[] = [];
test.afterAll(async () => {
  if (hasAdminKey) await cleanUp(created);
});

async function sentInvoice(page: Page, tag: string, price = "2 000") {
  const email = testEmail(tag);
  const userId = await signIn(page, email, "/welcome", "Penny Paid");
  created.push(userId);
  await expect(page).toHaveURL(/\/penny-[0-9a-f]{4}$/, { timeout: 15_000 });
  const home = new URL(page.url()).pathname;
  await page.goto(`${home}/clients/new`);
  await page.getByLabel("Name").fill("Thandi Mokoena");
  await page.getByRole("button", { name: "Add client" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Thandi Mokoena" })).toBeVisible();
  await page.getByRole("link", { name: "New invoice" }).click();
  await page.getByLabel("Line 1 description").filter({ visible: true }).fill("Plumbing");
  await page.getByLabel("Line 1 price").filter({ visible: true }).fill(price);
  await page.getByRole("button", { name: "Save and send invoice" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "INV-0001" })).toBeVisible();
  return { home, email, userId, docUrl: page.url() };
}

test("record an EFT part payment, then the rest; the client sees it paid", async ({ page, browser }) => {
  const { userId } = await sentInvoice(page, "eft");

  await page.getByRole("button", { name: "Record a payment" }).click();
  const form = page.getByRole("form", { name: "Record a payment" });
  await expect(form.getByLabel("Amount (R)")).toHaveValue("2 000,00");
  await form.getByLabel("Amount (R)").fill("500");
  await form.getByLabel("Reference").fill("FNB 12345");
  await form.getByRole("button", { name: "Save payment" }).click();
  await expect(page.getByText("Your first payment! 🎉")).toBeVisible();
  await expect(page.getByText("Part paid", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Payments" })).toContainText("EFT · FNB 12345");
  await expect(page.getByRole("article", { name: "Invoice" })).toContainText("R 1 500,00");

  await page.getByRole("button", { name: "Record a payment" }).click();
  await expect(form.getByLabel("Amount (R)")).toHaveValue("1 500,00");
  await form.getByLabel("How it was paid").selectOption("cash");
  await form.getByRole("button", { name: "Save payment" }).click();
  await expect(page.getByText("Paid", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Record a payment" })).toHaveCount(0);

  const link = await publicPath(userId, "INV-0001");
  const client = await browser.newPage();
  await client.goto(link);
  await expect(client.getByRole("region", { name: "Amount due" })).toContainText("Paid in full");
  await client.close();
});

test("bank details are checked, saved, and shown on invoices", async ({ page, browser }) => {
  const { home, userId } = await sentInvoice(page, "bank");
  await page.goto(`${home}/more`);
  await page.getByRole("link", { name: /Getting paid/ }).click();
  const eft = page.getByRole("region", { name: "EFT (bank transfer)" });
  await eft.getByLabel("Account holder").fill("Penny Plumbing");
  await eft.getByLabel("Account number").fill("123");
  await eft.getByLabel("Branch code").fill("250655");
  await eft.getByRole("button", { name: "Save bank details" }).click();
  await expect(eft.getByRole("alert")).toContainText("6 to 16 digits");
  await expect(eft.getByLabel("Account holder")).toHaveValue("Penny Plumbing");
  await eft.getByLabel("Account number").fill("6200 0000 000");
  await eft.getByRole("button", { name: "Save bank details" }).click();
  await expect(eft.getByRole("status")).toContainText("Bank details saved");

  const client = await browser.newPage();
  await client.goto(await publicPath(userId, "INV-0001"));
  await expect(client.getByRole("article", { name: "Invoice" })).toContainText("62000000000");
  await expect(client.getByRole("article", { name: "Invoice" })).toContainText("250655");
  await client.close();

  await page.goto(home);
  await expect(page.getByRole("region", { name: "Setup quest" })).toContainText("Set up how you get paid");
});

test("a mistyped Yoco key gets a clear message", async ({ page }) => {
  const { home } = await sentInvoice(page, "yocokey");
  await page.goto(`${home}/settings/payments`);
  const yoco = page.getByRole("region", { name: "Yoco" });
  await yoco.getByLabel("Secret key").fill("pk_test_thisisthepublickey");
  await yoco.getByRole("button", { name: "Connect Yoco" }).click();
  await expect(yoco.getByRole("alert")).toContainText("starts with sk_test_ or sk_live_");
});

test("a signed Yoco notification marks the invoice paid, once; forgeries are refused", async ({ page, request }) => {
  const { email, docUrl } = await sentInvoice(page, "yocohook", "1 250");
  const docId = docUrl.split("/").pop()!;

  // Connect Yoco as the owner, with a webhook secret we know (normally Yoco issues it).
  const webhookSecret = "whsec_" + Buffer.from("ledgerly-e2e-webhook-secret-123").toString("base64");
  const owner = await userClient(email);
  const { data: ws } = await owner.from("workspaces").select("id").single();
  const { data: conn, error } = await owner.rpc("connect_payment_provider", {
    p_workspace: ws!.id,
    p_provider: "yoco",
    p_mode: "test",
    p_merchant_id: null,
    p_secret: "sk_test_e2ee2ee2ee2ee2ee2e",
    p_passphrase: null,
  });
  expect(error).toBeNull();
  const attach = await owner.rpc("attach_yoco_webhook", { p_connection: conn, p_webhook_id: "wh_e2e", p_webhook_secret: webhookSecret });
  expect(attach.error).toBeNull();
  const { data: checkout } = await admin()
    .from("payment_checkouts")
    .insert({ workspace_id: ws!.id, document_id: docId, connection_id: conn, provider: "yoco", amount_cents: 125000 })
    .select("id")
    .single();

  const body = JSON.stringify({
    id: "evt_e2e_1",
    type: "payment.succeeded",
    payload: { id: "p_e2e_1", amount: 125000, currency: "ZAR", status: "succeeded", metadata: { ledgerlyRef: checkout!.id } },
  });
  const sign = (id: string, ts: string, b: string) =>
    "v1," + createHmac("sha256", Buffer.from(webhookSecret.slice(6), "base64")).update(`${id}.${ts}.${b}`).digest("base64");
  const ts = String(Math.floor(Date.now() / 1000));
  const headers = {
    "webhook-id": "msg_e2e_1",
    "webhook-timestamp": ts,
    "webhook-signature": sign("msg_e2e_1", ts, body),
    "content-type": "application/json",
  };

  const forged = await request.post(`/api/webhooks/yoco/${conn}`, { data: body, headers: { ...headers, "webhook-signature": "v1,AAAA" } });
  expect(forged.status()).toBe(401);
  const stale = String(Math.floor(Date.now() / 1000) - 600);
  const old = await request.post(`/api/webhooks/yoco/${conn}`, {
    data: body,
    headers: { ...headers, "webhook-timestamp": stale, "webhook-signature": sign("msg_e2e_1", stale, body) },
  });
  expect(old.status()).toBe(401);

  const ok = await request.post(`/api/webhooks/yoco/${conn}`, { data: body, headers });
  expect(ok.status()).toBe(200);
  expect(await ok.json()).toEqual({ outcome: "applied" });
  const again = await request.post(`/api/webhooks/yoco/${conn}`, { data: body, headers });
  expect(await again.json()).toEqual({ outcome: "duplicate" });

  await page.reload();
  await expect(page.getByText("Paid", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("region", { name: "Payments" })).toContainText("Yoco");
  await expect(page.getByRole("region", { name: "Payments" })).toContainText("R 1 250,00");

  const unknown = await request.post(`/api/webhooks/yoco/8e0b5c7e-3a1d-4b8a-9c3e-2f1a0b9c8d7e`, { data: body, headers });
  expect(unknown.status()).toBe(404);
});

test("reminders are off until switched on, and quick add starts a quote", async ({ page }) => {
  const { home } = await sentInvoice(page, "remind");
  await page.goto(`${home}/settings/payments`);
  const toggle = page.getByRole("switch", { name: "Send payment reminders automatically" });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();
  await expect(page.getByText("Reminders are on")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("switch", { name: "Send payment reminders automatically" })).toHaveAttribute("aria-checked", "true");

  await page.getByRole("button", { name: "Quick add" }).filter({ visible: true }).click();
  await page.getByRole("menuitem", { name: "New quote" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "New quote" }).filter({ visible: true })).toBeVisible();
});
