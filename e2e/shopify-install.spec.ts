import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";
import { cleanUp, hasAdminKey, signIn, testEmail } from "./support/session";

// Test-only app credentials, set for the test server in playwright.config.ts.
const SECRET = "e2e-shopify-client-secret";
const SHOP = "cool-store.myshopify.com";

/** The query Shopify sends to the App URL: sorted name=value pairs signed with the app secret (hex HMAC-SHA256). */
function installQuery(shop = SHOP, ageSeconds = 0): string {
  const fields: Record<string, string> = { host: "YWRtaW4", shop, timestamp: String(Math.floor(Date.now() / 1000) - ageSeconds) };
  const message = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join("&");
  const hmac = createHmac("sha256", SECRET).update(message).digest("hex");
  return new URLSearchParams({ ...fields, hmac }).toString();
}

test.describe("installing Ledgerly from Shopify (the App URL)", () => {
  test("a forged or stale request is refused", async ({ request }) => {
    const forged = await request.get(`/auth/shopify?${installQuery().replace(SHOP, "evil-store.myshopify.com")}`, { maxRedirects: 0 });
    expect(forged.status()).toBe(400);
    const stale = await request.get(`/auth/shopify?${installQuery(SHOP, 7200)}`, { maxRedirects: 0 });
    expect(stale.status()).toBe(400);
    const bare = await request.get("/auth/shopify", { maxRedirects: 0 });
    expect(bare.status()).toBe(400);
  });

  test("a genuine request is sent on to choose a business", async ({ request }) => {
    const res = await request.get(`/auth/shopify?${installQuery()}`, { maxRedirects: 0 });
    expect(res.status()).toBe(303);
    const to = new URL(res.headers()["location"]!);
    expect(to.pathname).toBe("/auth/shopify/connect");
    expect(to.searchParams.get("shop")).toBe(SHOP);
  });

  test("signed out, the merchant signs in and lands back on the connect page", async ({ page }) => {
    await page.goto(`/auth/shopify/connect?shop=${SHOP}`);
    await expect(page).toHaveURL(/\/login\?next=/);
    expect(new URL(page.url()).searchParams.get("next")).toBe(`/auth/shopify/connect?shop=${SHOP}`);
  });
});

test.describe("choosing the business", () => {
  test.skip(!hasAdminKey, "Add SUPABASE_SERVICE_ROLE_KEY to .env.local to run signed-in tests");
  const created: string[] = [];
  test.afterAll(async () => {
    if (hasAdminKey) await cleanUp(created);
  });

  test("the owner picks their business and is sent to Shopify to approve the connection", async ({ page }) => {
    const owner = await signIn(page, testEmail("shopify"), "/welcome", "Shop Owner");
    created.push(owner);
    await expect(page).toHaveURL(/\/shop-[0-9a-f]{4}$/, { timeout: 15_000 });
    const slug = new URL(page.url()).pathname.slice(1);

    await page.goto(`/auth/shopify/connect?shop=${SHOP}`);
    await expect(page.getByRole("heading", { level: 1, name: `Connect ${SHOP} to Ledgerly` })).toBeVisible();

    // Follow the link's hand-off to Shopify without actually visiting Shopify: read where it points.
    const href = await page.getByRole("link", { name: /Connect$/ }).first().getAttribute("href");
    expect(href).toContain(`/api/oauth/shopify/start?ws=${slug}`);
    const handOff = await page.request.get(href!, { maxRedirects: 0 });
    expect(handOff.status()).toBeGreaterThanOrEqual(300);
    expect(handOff.status()).toBeLessThan(400);
    const url = new URL(handOff.headers()["location"]!);
    expect(url.origin).toBe(`https://${SHOP}`);
    expect(url.pathname).toBe("/admin/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("e2e-shopify-client-id");
    expect(url.searchParams.get("scope")).toBe("read_products,read_inventory,read_locations,read_orders");
    expect(url.searchParams.get("redirect_uri")).toMatch(/\/api\/oauth\/shopify\/callback$/);
    expect(url.searchParams.get("state")).toBeTruthy();
  });

  test("an address that is not a Shopify store is turned away", async ({ page }) => {
    const owner = await signIn(page, testEmail("shopify-bad"), "/welcome", "Shop Owner");
    created.push(owner);
    await page.goto("/auth/shopify/connect?shop=evil.example.com");
    await expect(page.getByRole("heading", { name: /doesn.t look right/ })).toBeVisible();
  });
});
