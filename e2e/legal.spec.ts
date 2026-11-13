import { expect, test } from "@playwright/test";

test("the legal pages exist, say they are drafts until details are set, and link to each other", async ({ page }) => {
  for (const [path, title] of [
    ["/privacy", "Privacy policy"],
    ["/terms", "Terms of use"],
    ["/popia", "POPIA and PAIA notice"],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2 }).first()).toBeVisible();
  }
  await page.goto("/privacy");
  await expect(page.getByRole("note")).toContainText("to confirm");
  await page.getByRole("link", { name: "POPIA page" }).click();
  await expect(page).toHaveURL(/\/popia$/);
});

test("the cookie notice is a plain notice that stays dismissed", async ({ page }) => {
  await page.goto("/");
  const banner = page.getByRole("region", { name: "Cookies and privacy" });
  await expect(banner).toContainText("only uses the cookies and storage it needs");
  await expect(banner).toContainText("No ads, no tracking");
  await banner.getByRole("button", { name: "Got it" }).click();
  await expect(banner).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("region", { name: "Cookies and privacy" })).toHaveCount(0);
});

test("search engines and monitors get what they need", async ({ request }) => {
  const robots = await request.get("/robots.txt");
  expect(robots.ok()).toBe(true);
  const text = await robots.text();
  expect(text).toContain("Sitemap:");
  expect(text).toContain("Disallow: /api/");
  expect(text).toContain("Disallow: /portal/");

  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.ok()).toBe(true);
  const xml = await sitemap.text();
  for (const p of ["/pricing", "/privacy", "/terms", "/popia"]) expect(xml).toContain(p);
  expect(xml).not.toContain("/portal");

  const og = await request.get("/opengraph-image");
  expect(og.ok()).toBe(true);
  expect(og.headers()["content-type"]).toContain("image/png");

  const health = await request.get("/api/health");
  expect([200, 503]).toContain(health.status());
  const body = await health.json();
  expect(body).toHaveProperty("status");
  expect(JSON.stringify(body)).not.toMatch(/key|secret|token/i);
  expect(health.headers()["cache-control"]).toContain("no-store");
});

test("the landing page has structured data and share tags", async ({ page }) => {
  await page.goto("/");
  const ld = JSON.parse((await page.locator('script[type="application/ld+json"]').first().textContent()) ?? "{}");
  const types = ld["@graph"].map((n: { "@type": string }) => n["@type"]);
  expect(types).toEqual(["Organization", "SoftwareApplication"]);
  const app = ld["@graph"][1];
  expect(app.offers.map((o: { price: string }) => o.price)).toEqual(["0", "199"]);
  await expect(page.locator('meta[property="og:site_name"]')).toHaveAttribute("content", "Ledgerly");
  await expect(page.locator('meta[property="og:image"]')).toHaveCount(1);
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");
});
