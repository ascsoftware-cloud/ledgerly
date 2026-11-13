import { expect, test } from "@playwright/test";
import { admin, cleanUp, hasAdminKey, signIn, testEmail } from "./support/session";

// The server runs with PayFast sandbox test values (playwright.config.ts): nothing is ever charged, and the
// hosted PayFast page is intercepted so the test can read the form the browser posts.

test("the pricing page shows both plans from the same price the app charges", async ({ page }) => {
  await page.goto("/pricing");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("One flat price");
  const table = page.getByRole("table", { name: "Free and Pro compared" });
  await expect(table).toContainText("R199 a month");
  await expect(table).toContainText("10 a month");
  await expect(table).toContainText("200 MB");
  await expect(table).toContainText("10 GB");
  await page.getByRole("link", { name: "Pricing" }).first().waitFor();
});

test("a payment notice that is not from PayFast is refused", async ({ request }) => {
  const res = await request.post("/api/webhooks/payfast-billing", {
    form: { merchant_id: "10000100", payment_status: "COMPLETE", amount_gross: "199.00", m_payment_id: "11111111-2222-3333-4444-555555555555", signature: "0".repeat(32) },
  });
  expect(res.status()).toBe(400);
  expect(await res.text()).toContain("Refused");
});

test.describe("signed in", () => {
  test.skip(!hasAdminKey, "Add SUPABASE_SERVICE_ROLE_KEY to .env.local to run signed-in tests");
  const created: string[] = [];
  test.afterAll(async () => {
    if (hasAdminKey) await cleanUp(created);
  });

  test("a Free business sees its limits, is held back from Pro things, and can start an upgrade; Pro unlocks them", async ({ page }) => {
    const owner = await signIn(page, testEmail("bill"), "/welcome", "Bongani Billing");
    created.push(owner);
    await expect(page).toHaveURL(/\/bongani-[0-9a-f]{4}$/, { timeout: 15_000 });
    const home = new URL(page.url()).pathname;

    await page.goto(`${home}/more`);
    await page.getByRole("link", { name: /^Plan and billing/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Plan and billing" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your plan: Free" })).toBeVisible();
    const usage = page.getByRole("list", { name: "Usage" });
    await expect(usage).toContainText("0 of 10");
    await expect(usage).toContainText("of 200 MB");
    await expect(usage).toContainText("0 of 20");
    await expect(page.getByRole("form", { name: "Add another business" })).toHaveCount(0);

    // Automations are Pro: the database says no, in plain words.
    await page.goto(`${home}/settings/automations`);
    const form = page.getByRole("form", { name: "New automation" });
    await form.getByLabel("Name").fill("Chase late invoices");
    await form.getByRole("button", { name: "Add rule" }).click();
    await expect(form.getByRole("alert")).toContainText("Automations are part of the Pro plan");

    // Upgrade opens PayFast with a signed monthly subscription for the exact price.
    let posted: URLSearchParams | null = null;
    await page.route("https://sandbox.payfast.co.za/**", async (route) => {
      posted = new URLSearchParams(route.request().postData() ?? "");
      await route.fulfill({ status: 200, contentType: "text/html", body: "<h1>PayFast (test double)</h1>" });
    });
    await page.goto(`${home}/settings/plan`);
    await page.getByRole("button", { name: "Upgrade to Pro for R199 a month" }).click();
    await expect(page.getByRole("heading", { name: "PayFast (test double)" })).toBeVisible({ timeout: 15_000 });
    const f = posted as URLSearchParams | null;
    expect(f).not.toBeNull();
    expect(f!.get("amount")).toBe("199.00");
    expect(f!.get("recurring_amount")).toBe("199.00");
    expect(f!.get("subscription_type")).toBe("1");
    expect(f!.get("frequency")).toBe("3");
    expect(f!.get("cycles")).toBe("0");
    expect(f!.get("notify_url")).toMatch(/\/api\/webhooks\/payfast-billing$/);
    expect(f!.get("m_payment_id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(f!.get("signature")).toMatch(/^[0-9a-f]{32}$/);

    // PayFast confirms (as the server would after verifying it): the business is Pro, and Pro things work.
    const db = admin();
    const { data: ws } = await db.from("workspaces").select("id").eq("created_by", owner).single();
    const { data: ck } = await db.from("billing_checkouts").select("id").eq("workspace_id", ws!.id).single();
    const { data: outcome } = await db.rpc("billing_apply_payment", { p_checkout: ck!.id, p_token: "e2e-token-1", p_pf_payment_id: `e2e-${Date.now()}`, p_amount_cents: 19900 });
    expect(outcome).toBe("activated");
    await page.goto(`${home}/settings/plan`);
    await expect(page.getByRole("heading", { name: "Your plan: Pro" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel Pro" })).toBeVisible();
    await expect(page.getByRole("form", { name: "Add another business" })).toBeVisible();

    await page.goto(`${home}/settings/automations`);
    const proForm = page.getByRole("form", { name: "New automation" });
    await proForm.getByLabel("Name").fill("Chase late invoices");
    await proForm.getByRole("button", { name: "Add rule" }).click();
    await expect(page.getByRole("list", { name: "Rules" })).toContainText("Chase late invoices");

    // A Pro owner can add another business, which starts on Free.
    await page.goto(`${home}/settings/plan`);
    await page.getByRole("form", { name: "Add another business" }).getByLabel("Business name").fill("Second Shop");
    await page.getByRole("button", { name: "Add business" }).click();
    await expect(page).toHaveURL(/\/secondshop-[0-9a-f]{4}$/, { timeout: 15_000 });
  });
});
