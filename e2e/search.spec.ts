import { expect, test } from "@playwright/test";
import { admin, cleanUp, hasAdminKey, signIn, testEmail } from "./support/session";

test.skip(!hasAdminKey, "Add SUPABASE_SERVICE_ROLE_KEY to .env.local to run signed-in tests");

const created: string[] = [];
test.afterAll(async () => {
  if (hasAdminKey) await cleanUp(created);
});

test("search finds things, and the keyboard shortcuts take you places", async ({ page }) => {
  const owner = await signIn(page, testEmail("find"), "/welcome", "Fikile Find");
  created.push(owner);
  await expect(page).toHaveURL(/\/fikile-[0-9a-f]{4}$/, { timeout: 15_000 });
  const home = new URL(page.url()).pathname;

  const db = admin();
  const { data: ws } = await db.from("workspaces").select("id").eq("created_by", owner).single();
  const { data: client } = await db.from("contacts").insert({ workspace_id: ws!.id, name: "Zanele Mokoena", email: "zanele@example.co.za" }).select("id").single();
  await db.from("tasks").insert({ workspace_id: ws!.id, title: "Call Zanele about the quote" });
  await page.reload();

  // The search button and Ctrl+K both open it; Escape closes it.
  await page.getByRole("button", { name: "Search" }).click();
  const box = page.getByRole("combobox", { name: "Search your business" });
  await expect(box).toBeFocused();
  await box.fill("z");
  await expect(page.getByText("Type at least two letters.")).toBeVisible();
  await box.fill("zanele");
  const results = page.getByRole("listbox", { name: "Results" });
  await expect(results).toContainText("Zanele Mokoena");
  await expect(results).toContainText("Call Zanele about the quote");
  await box.fill("nobody-by-this-name");
  await expect(page.getByText("Nothing found for")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(box).toHaveCount(0);

  await page.keyboard.press("Control+k");
  await expect(box).toBeFocused();
  await box.fill("zanele");
  await expect(results).toContainText("Zanele Mokoena");
  await page.keyboard.press("Enter"); // the first result is the client
  await expect(page).toHaveURL(new RegExp(`/clients/${client!.id}$`));

  // g then a letter goes to a section; n then a letter starts something new.
  await page.locator("body").click({ position: { x: 5, y: 300 } });
  await page.keyboard.press("g");
  await page.keyboard.press("m");
  await expect(page).toHaveURL(`${home}/money`);
  await page.keyboard.press("g");
  await page.keyboard.press("h");
  await expect(page).toHaveURL(home);
  await page.keyboard.press("n");
  await page.keyboard.press("e");
  await expect(page).toHaveURL(`${home}/money/expenses/new`);

  // Typing in a box never triggers a shortcut.
  await page.getByLabel("Amount (R)").fill("g");
  await page.keyboard.press("m");
  await expect(page).toHaveURL(`${home}/money/expenses/new`);
  await expect(page.getByLabel("Amount (R)")).toHaveValue("gm");

  // ? shows the list.
  await page.getByRole("heading", { level: 1 }).click();
  await page.keyboard.press("?");
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toContainText("g then h");
});
