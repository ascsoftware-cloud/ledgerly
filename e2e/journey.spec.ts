import { expect, test, type Page } from "@playwright/test";
import { cleanUp, hasAdminKey, signIn, testEmail } from "./support/session";

/**
 * The Phase 2 journey: landing → onboarding → sign-in → building → dashboard.
 * Needs SUPABASE_SERVICE_ROLE_KEY to sign a throwaway user in without email.
 */
test.skip(!hasAdminKey, "Add SUPABASE_SERVICE_ROLE_KEY to .env.local to run the signed-in journey");
test.use({ viewport: { width: 390, height: 844 } });

const created: string[] = [];
test.afterAll(async () => {
  if (hasAdminKey) await cleanUp(created);
});

async function answerEverything(page: Page) {
  const go = () => page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("radio", { name: "Freelancer" }).click();
  await go();
  await page.getByRole("radio", { name: "Just me" }).click();
  await go();
  await page.getByRole("checkbox", { name: "Getting paid" }).click();
  await go();
  await page.getByRole("checkbox", { name: "Invoices" }).click();
  await page.getByRole("checkbox", { name: "Expenses" }).click();
  await go();
  await page.getByRole("checkbox", { name: "EFT" }).click();
  await go();
  await page.getByRole("radio", { name: "R20k – R100k" }).click();
  await go();
  await page.getByRole("radio", { name: "Sky" }).click();
  await go();
  await page.getByRole("radio", { name: "5 minutes", exact: true }).click();
  await go();
}

test("a new user goes from the landing page to a workspace built from their answers", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Get started free" }).click();
  await answerEverything(page);
  await expect(page.getByRole("heading", { name: "Save your workspace" })).toBeVisible();

  created.push(await signIn(page, testEmail("journey"), "/welcome", "Thandi Mokoena"));
  await expect(page.getByRole("heading", { name: "Building your workspace…" })).toBeVisible();

  await expect(page).toHaveURL(/\/thandi-[0-9a-f]{4}$/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Thandi");
  await expect(page.locator("html")).toHaveAttribute("data-accent", "sky");

  const quest = page.getByRole("region", { name: "Setup quest" });
  await expect(quest).toContainText("0 of 6 done");
  for (const step of ["Add your business details", "Send your first invoice", "Set up how you get paid", "Log an expense", "Add your first task"]) {
    await expect(quest.getByText(step)).toBeVisible();
  }
  await expect(page.getByRole("region", { name: "Monthly goal" })).toContainText("R 60 000,00");

  const tabs = page.getByRole("navigation", { name: "Primary" });
  await expect(tabs.getByRole("link")).toHaveText(["Home", "Money", "Clients", "Work", "More"]);

  // The answers were sent to the database, so the browser copy is gone.
  expect(await page.evaluate(() => localStorage.getItem("ledgerly-onboarding"))).toBeNull();
});

test("signing in on a second device still gives a working workspace, then the questions", async ({ page }) => {
  created.push(await signIn(page, testEmail("device2"), "/welcome"));
  await expect(page).toHaveURL(/\/e-[0-9a-f]{4}$|\/biz-[0-9a-f]{4}$/, { timeout: 15_000 });

  const banner = page.getByRole("heading", { name: "Finish setting up" });
  await expect(banner).toBeVisible();
  await page.getByRole("link", { name: "Answer the questions" }).click();

  await answerEverything(page);
  await expect(page).toHaveURL(/\/(e|biz)-[0-9a-f]{4}$/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Finish setting up" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Setup quest" })).toContainText("0 of 6 done");
});

test("one person cannot open another person's workspace", async ({ page, browser }) => {
  const owner = await browser.newPage();
  created.push(await signIn(owner, testEmail("owner"), "/welcome", "Owner Person"));
  await expect(owner).toHaveURL(/\/owner-[0-9a-f]{4}$/, { timeout: 15_000 });
  const ownersSlug = new URL(owner.url()).pathname;
  await owner.close();

  created.push(await signIn(page, testEmail("intruder"), "/welcome", "Intruder Person"));
  await expect(page).toHaveURL(/\/intruder-[0-9a-f]{4}$/, { timeout: 15_000 });

  await page.goto(ownersSlug);
  await expect(page.getByRole("heading", { name: "We can't find that page" })).toBeVisible();
  await expect(page.getByText("Owner's business")).toHaveCount(0);
});

test("signing out ends the session", async ({ page }) => {
  created.push(await signIn(page, testEmail("signout"), "/welcome", "Sipho Dube"));
  await expect(page).toHaveURL(/\/sipho-[0-9a-f]{4}$/, { timeout: 15_000 });
  const home = new URL(page.url()).pathname;

  await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "More" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto(home);
  await expect(page).toHaveURL(/\/login\?next=/);
});
