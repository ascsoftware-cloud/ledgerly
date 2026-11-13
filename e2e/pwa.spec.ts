import { expect, test } from "@playwright/test";
import { cleanUp, hasAdminKey, signIn, testEmail } from "./support/session";

test("the app can be installed: manifest and icons are served", async ({ request }) => {
  const res = await request.get("/manifest.webmanifest");
  expect(res.ok()).toBe(true);
  const m = await res.json();
  expect(m.display).toBe("standalone");
  for (const icon of m.icons) {
    const r = await request.get(icon.src);
    expect(r.ok(), icon.src).toBe(true);
    expect(r.headers()["content-type"]).toContain("image/png");
  }
  expect((await request.get("/apple-icon.png")).ok()).toBe(true);
  const sw = await request.get("/sw.js");
  expect(sw.ok()).toBe(true);
  expect(sw.headers()["content-type"]).toContain("javascript");
});

test.describe("offline", () => {
  test.skip(!hasAdminKey, "Add SUPABASE_SERVICE_ROLE_KEY to .env.local to run signed-in tests");
  const created: string[] = [];
  test.afterAll(async () => {
    if (hasAdminKey) await cleanUp(created);
  });

  test("the Install button appears on More even if the browser offered installation earlier, on another page", async ({ page }) => {
    const owner = await signIn(page, testEmail("pwainstall"), "/welcome", "Ines Install");
    created.push(owner);
    await expect(page).toHaveURL(/\/ines-[0-9a-f]{4}$/, { timeout: 15_000 });
    // The browser's offer arrives a little after the page has loaded, while the person is on the home page. Offer it
    // until the page has taken it (its listener is attached when the app finishes loading).
    await expect
      .poll(() =>
        page.evaluate(() => {
          const e = new Event("beforeinstallprompt", { cancelable: true });
          (e as Event & { prompt: () => Promise<void> }).prompt = async () => undefined;
          window.dispatchEvent(e);
          return e.defaultPrevented;
        }),
      )
      .toBe(true);
    // They then open More without reloading.
    await page.getByRole("link", { name: "More" }).first().click();
    await expect(page.getByRole("heading", { level: 1, name: "More" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Install the app" })).toBeVisible();
  });

  test("pages you opened still read offline, others say so, and sign-out forgets them", async ({ page, context }) => {
    const owner = await signIn(page, testEmail("pwa"), "/welcome", "Pule Offline");
    created.push(owner);
    await expect(page).toHaveURL(/\/pule-[0-9a-f]{4}$/, { timeout: 15_000 });
    const home = new URL(page.url()).pathname;

    // The worker takes over, then a page is opened so a copy is saved.
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await page.reload();
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 15_000 }).toBe(true);
    await page.goto(`${home}/money`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const heading = (await page.getByRole("heading", { level: 1 }).first().textContent()) ?? "";
    // The save happens as the page loads; wait for it to land.
    await expect.poll(() => page.evaluate(async (u) => !!(await (await caches.open("ledgerly-pages-v1")).match(u)), `${location_origin(page)}${home}/money`), { timeout: 10_000 }).toBe(true);

    await context.setOffline(true);
    await page.goto(`${home}/money`);
    await expect(page.getByRole("heading", { level: 1 }).first()).toHaveText(heading);
    await expect(page.getByRole("status").filter({ hasText: "You're offline" })).toBeVisible();

    await page.goto(`${home}/work/projects`).catch(() => undefined);
    await expect(page.getByRole("heading", { name: "You're offline" })).toBeVisible();

    // Back online: the banner goes, and signing out wipes the saved pages.
    await context.setOffline(false);
    await page.goto(`${home}/more`);
    await expect(page.getByText("You're offline")).toHaveCount(0);
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/(login|$)/, { timeout: 15_000 });
    const left = await page.evaluate(async () => {
      const names = (await caches.keys()).filter((n) => n.startsWith("ledgerly-pages-"));
      let n = 0;
      for (const name of names) n += (await (await caches.open(name)).keys()).length;
      return n;
    });
    expect(left).toBe(0);
  });
});

function location_origin(page: { url(): string }) {
  return new URL(page.url()).origin;
}
