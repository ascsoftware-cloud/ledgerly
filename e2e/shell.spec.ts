import { expect, test } from "@playwright/test";

const TABS = ["Home", "Money", "Clients", "Work", "More"];

test.describe("app shell on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("shows a bottom tab bar with five tabs and no sidebar", async ({ page }) => {
    await page.goto("/demo");
    const tabs = page.getByRole("navigation", { name: "Primary" });
    await expect(tabs).toBeVisible();
    await expect(tabs.getByRole("link")).toHaveText(TABS);
    await expect(page.getByRole("navigation", { name: "Sidebar" })).toBeHidden();
  });

  test("every tab is at least 44px tall and wide", async ({ page }) => {
    await page.goto("/demo");
    const links = page.getByRole("navigation", { name: "Primary" }).getByRole("link");
    for (const link of await links.all()) {
      const box = await link.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
      expect(box?.width).toBeGreaterThanOrEqual(44);
    }
  });

  test("the current tab is marked for screen readers", async ({ page }) => {
    await page.goto("/demo");
    const home = page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Home" });
    await expect(home).toHaveAttribute("aria-current", "page");
  });
});

test.describe("app shell on a desktop", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("shows the sidebar and no bottom tab bar", async ({ page }) => {
    await page.goto("/demo");
    await expect(page.getByRole("navigation", { name: "Sidebar" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeHidden();
  });

  test("sidebar collapses and expands, and remembers the choice", async ({ page }) => {
    await page.goto("/demo");
    const sidebar = page.getByRole("navigation", { name: "Sidebar" });
    const wide = (await sidebar.boundingBox())!.width;

    await page.getByRole("button", { name: "Collapse sidebar" }).click();
    await expect.poll(async () => (await sidebar.boundingBox())!.width).toBeLessThan(wide / 2);
    // Links keep their accessible names when only icons are visible.
    await expect(sidebar.getByRole("link", { name: "Money" })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
    await page.getByRole("button", { name: "Expand sidebar" }).click();
    await expect.poll(async () => (await sidebar.boundingBox())!.width).toBe(wide);
  });

  test("links are reachable by keyboard and show a focus ring", async ({ page }) => {
    await page.goto("/demo");
    const first = page.getByRole("navigation", { name: "Sidebar" }).getByRole("link").first();
    await first.focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(first).toBeFocused();
    const outline = await first.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe("none");
  });
});

test("demo page shows the three standard states", async ({ page }) => {
  await page.goto("/demo");
  await expect(page.getByRole("heading", { name: "No invoices yet" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create your first invoice" })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Couldn't load" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(page.getByRole("status", { name: "Loading" })).toBeVisible();
});
