import { expect, test } from "@playwright/test";
import { cleanUp, hasAdminKey, signIn, testEmail, userClient } from "./support/session";

test.skip(!hasAdminKey, "Add SUPABASE_SERVICE_ROLE_KEY to .env.local to run signed-in tests");

const created: string[] = [];
test.afterAll(async () => {
  if (hasAdminKey) await cleanUp(created);
});

test("a payment appears live in the bell, can be read, and a switched-off kind stays quiet", async ({ page }) => {
  test.setTimeout(90_000);
  const email = testEmail("notify");
  const owner = await signIn(page, email, "/welcome", "Nora Notify");
  created.push(owner);
  await expect(page).toHaveURL(/\/nora-[0-9a-f]{4}$/, { timeout: 15_000 });
  const home = new URL(page.url()).pathname;

  const me = await userClient(email);
  const { data: ws } = await me.from("workspaces").select("id").eq("created_by", owner).single();
  const workspace_id = ws!.id as string;
  const { data: contact } = await me.from("contacts").insert({ workspace_id, name: "Thandi Mokoena" }).select("id").single();
  const { data: docId } = await me.rpc("save_document_draft", {
    p_workspace: workspace_id,
    p_id: null,
    p_doc: { kind: "invoice", contact_id: contact!.id },
    p_lines: [{ description: "Geyser", quantity: 1, unit_cents: 200000, vat_rate: 0 }],
  });
  expect((await me.rpc("send_document", { p_id: docId })).error).toBeNull();

  // The page is open; the payment is recorded elsewhere. The toast and the badge arrive without a reload.
  await expect(page.getByRole("link", { name: "Notifications" })).toBeVisible();
  const pay = (cents: number) => me.rpc("record_manual_payment", { p_doc: docId, p_amount_cents: cents, p_method: "cash", p_paid_on: null, p_reference: "cash", p_proof_path: null, p_request: crypto.randomUUID() });
  await page.waitForTimeout(2000); // let the Realtime channel subscribe
  expect((await pay(40000)).error).toBeNull();
  await expect(page.getByText("Payment of R400.00 received for INV-0001")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("link", { name: "Notifications, 1 unread" })).toBeVisible({ timeout: 20_000 });

  // The list, opened from the bell; reading clears the badge.
  await page.getByRole("link", { name: /^Notifications/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Notifications" })).toBeVisible();
  const list = page.getByRole("list", { name: "Notifications" });
  await expect(list).toContainText("Payment of R400.00 received for INV-0001");
  await expect(list).toContainText("Payment received · just now");
  await page.getByRole("button", { name: "Mark all as read" }).click();
  await expect(page.getByRole("link", { name: "Notifications", exact: true })).toBeVisible();

  // Settings: switch the kind off; the next payment says nothing.
  await page.getByRole("link", { name: "Notification settings" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Notification settings" })).toBeVisible();
  await expect(page.getByText(/Push notifications are not switched on for this site yet|can't receive push/)).toBeVisible();
  const row = page.getByRole("list", { name: "Notification kinds" }).getByRole("listitem").filter({ hasText: "Payment received" });
  await row.getByRole("checkbox").first().uncheck();
  await expect(row.getByRole("checkbox").nth(1)).toBeDisabled();
  await page.waitForTimeout(1500);
  expect((await pay(30000)).error).toBeNull();
  await page.goto(`${home}/notifications`);
  await expect(page.getByRole("list", { name: "Notifications" })).not.toContainText("R300.00");
  await expect(page.getByRole("link", { name: "Notifications", exact: true })).toBeVisible();
});
