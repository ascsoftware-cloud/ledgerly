import { expect, test } from "@playwright/test";
import { cleanUp, hasAdminKey, signIn, testEmail } from "./support/session";

test.skip(!hasAdminKey, "Add SUPABASE_SERVICE_ROLE_KEY to .env.local to run signed-in tests");

// The server runs with AI_PROVIDER=mock (playwright.config.ts): no real AI service is contacted.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

const created: string[] = [];
test.afterAll(async () => {
  if (hasAdminKey) await cleanUp(created);
});

test("the AI helper is off until switched on, then answers, counts usage and reads a receipt", async ({ page }) => {
  const owner = await signIn(page, testEmail("ai"), "/welcome", "Ayo Assist");
  created.push(owner);
  await expect(page).toHaveURL(/\/ayo-[0-9a-f]{4}$/, { timeout: 15_000 });
  const home = new URL(page.url()).pathname;

  // Off by default: no Ask button, and the expense form offers no scan.
  await expect(page.getByRole("button", { name: "Ask Miko" })).toHaveCount(0);
  await page.goto(`${home}/money/expenses/new`);
  await expect(page.getByRole("button", { name: /Fill in from the photo/ })).toHaveCount(0);

  await page.goto(`${home}/settings/ai`);
  await expect(page.getByRole("heading", { level: 1, name: "AI helper" })).toBeVisible();
  await expect(page.getByLabel("Usage this month")).toContainText("0 of 20");
  await page.getByRole("checkbox", { name: "Use the AI helper in this business" }).check();
  await expect(page.getByText("AI helper switched on")).toBeVisible();

  // Ask a question: the answer comes through a tool call, and the allowance goes down.
  await page.reload();
  await page.getByRole("button", { name: "Ask Miko" }).click();
  const panel = page.getByRole("dialog");
  await expect(panel.getByText("0 of 20 AI requests used this month")).toBeVisible();
  await panel.getByRole("button", { name: "Who owes me money?" }).click();
  await expect(panel.getByRole("log")).toContainText("Mock assistant: 0 overdue invoice(s)");
  await expect(panel.getByText("1 of 20 AI requests used this month")).toBeVisible();

  // A failing provider shows a calm message and gives the request back.
  await panel.getByLabel("Your question").fill("please fail");
  await panel.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("couldn't answer that");
  await page.keyboard.press("Escape");
  await page.goto(`${home}/settings/ai`);
  await expect(page.getByLabel("Usage this month")).toContainText("1 of 20");

  // Receipt scan fills the form; nothing is saved until the person saves.
  await page.goto(`${home}/money/expenses/new`);
  await page.getByLabel(/^Receipt/).setInputFiles({ name: "slip.png", mimeType: "image/png", buffer: PNG });
  await page.getByRole("button", { name: "Fill in from the photo (AI)" }).click();
  await expect(page.getByText("Filled in from the photo")).toBeVisible();
  await expect(page.getByLabel("Amount (R)")).toHaveValue("345,50");
  await expect(page.getByLabel(/^Supplier/)).toHaveValue("Mock Hardware");

  // Switched off again: the button goes away.
  await page.goto(`${home}/settings/ai`);
  await page.getByRole("checkbox", { name: "Use the AI helper in this business" }).uncheck();
  await expect(page.getByText("AI helper switched off")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Ask Miko" })).toHaveCount(0);
});
