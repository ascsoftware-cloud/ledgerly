import { expect, test } from "@playwright/test";

// A read-only check that a running site is healthy. It changes nothing and signs nobody in, so it is safe to point
// at the live site:   BASE_URL=https://business.ascsoftware.co.za npm run smoke
// Without BASE_URL it runs against the local test build like every other test.

test("the front door, pricing and legal pages load", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "Get started" }).first()).toBeVisible();
  for (const [path, title] of [
    ["/pricing", /flat price/],
    ["/privacy", /Privacy policy/],
    ["/terms", /Terms of use/],
    ["/popia", /POPIA/],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
  }
});

test("signing in is offered, and a signed-out visitor is sent to it", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.goto("/some-business-that-does-not-exist");
  await expect(page).toHaveURL(/\/login/);
});

test("an unknown address is a real 404", async ({ request }) => {
  const res = await request.get("/Not_A_Page.xyz");
  expect(res.status()).toBe(404);
});

test("the database answers, and the app can be installed", async ({ request }) => {
  const health = await request.get("/api/health");
  expect(health.status(), "the health check says the database is not answering").toBe(200);
  expect((await health.json()).status).toBe("ok");
  const manifest = await request.get("/manifest.webmanifest");
  expect(manifest.ok()).toBe(true);
  expect((await manifest.json()).display).toBe("standalone");
  expect((await request.get("/sw.js")).ok()).toBe(true);
});

test("the security headers are on, and the site is served over HTTPS when remote", async ({ request, baseURL }) => {
  const res = await request.get("/");
  const h = res.headers();
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["strict-transport-security"]).toContain("max-age=");
  if (baseURL && !baseURL.startsWith("http://localhost")) expect(baseURL.startsWith("https://")).toBe(true);
});

test("robots and sitemap are served", async ({ request }) => {
  expect((await request.get("/robots.txt")).ok()).toBe(true);
  expect((await request.get("/sitemap.xml")).ok()).toBe(true);
});
