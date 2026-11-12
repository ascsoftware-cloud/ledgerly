import { expect, test } from "@playwright/test";

test("landing page loads with one headline and a way to start", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));

  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

  const cta = page.getByRole("link", { name: "Get started" }).first();
  await expect(cta).toBeVisible();
  await expect(cta).toHaveAttribute("href", "/start");

  // The security policy must not break the page: no blocked scripts or styles.
  expect(errors).toEqual([]);
});

test("landing page sends the security headers", async ({ request }) => {
  const response = await request.get("/");
  const h = response.headers();
  expect(h["content-security-policy"]).toContain("default-src 'self'");
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(h["strict-transport-security"]).toContain("max-age=");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["permissions-policy"]).toBeTruthy();
});

test("landing page has footer links to the legal pages", async ({ page }) => {
  await page.goto("/");
  const footer = page.getByRole("contentinfo");
  for (const name of ["Privacy", "Terms"]) {
    await expect(footer.getByRole("link", { name })).toBeVisible();
  }
});

test("landing page fits a phone without sideways scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("an unknown address shows a helpful 404 with a way home", async ({ page }) => {
  const response = await page.goto("/nope_not_here");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "We can't find that page" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to home" })).toHaveAttribute("href", "/");
});
