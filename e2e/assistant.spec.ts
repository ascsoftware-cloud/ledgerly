import { expect, test } from "@playwright/test";
import { cleanUp, hasAdminKey, signIn, testEmail } from "./support/session";

test.skip(!hasAdminKey, "Add SUPABASE_SERVICE_ROLE_KEY to .env.local to run signed-in tests");

// The server runs with AI_PROVIDER=mock (playwright.config.ts): no real AI service is contacted.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

const created: string[] = [];
test.afterAll(async () => {
  if (hasAdminKey) await cleanUp(created);
});

test("Miko is on from the start, answers, counts usage, reads a receipt, and can be switched off and on", async ({ page }) => {
  const owner = await signIn(page, testEmail("ai"), "/welcome", "Ayo Assist");
  created.push(owner);
  await expect(page).toHaveURL(/\/ayo-[0-9a-f]{4}$/, { timeout: 15_000 });
  const home = new URL(page.url()).pathname;

  // On by default: Miko's button is there from the start, and the More page has no AI card.
  await expect(page.getByRole("button", { name: "Ask Miko" })).toBeVisible();
  await page.goto(`${home}/more`);
  await expect(page.getByRole("link", { name: /Miko is switched off|AI helper/ })).toHaveCount(0);
  await page.goto(`${home}/settings/ai`);
  await expect(page.getByRole("heading", { level: 1, name: "Miko, your AI helper" })).toBeVisible();
  await expect(page.getByLabel("Usage this month")).toContainText("0 of 20");
  await expect(page.getByRole("checkbox", { name: "Use Miko, the AI helper, in this business" })).toBeChecked();

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
  // Wait for the streamed form to settle: while a page streams in, a hidden copy can briefly sit beside it.
  await expect(page.getByRole("button", { name: "Fill in from the photo (AI)" })).toBeVisible();
  await page.getByLabel(/^Receipt/).setInputFiles({ name: "slip.png", mimeType: "image/png", buffer: PNG });
  await page.getByRole("button", { name: "Fill in from the photo (AI)" }).click();
  await expect(page.getByText("Filled in from the photo")).toBeVisible();
  await expect(page.getByLabel("Amount (R)")).toHaveValue("345,50");
  await expect(page.getByLabel(/^Supplier/)).toHaveValue("Mock Hardware");

  // An owner can switch Miko off: the button goes, the More page offers a way back, and switching on restores it.
  await page.goto(`${home}/settings/ai`);
  await page.getByRole("checkbox", { name: "Use Miko, the AI helper, in this business" }).uncheck();
  await expect(page.getByText("Miko switched off")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Ask Miko" })).toHaveCount(0);
  await page.goto(`${home}/more`);
  await page.getByRole("link", { name: /^Miko is switched off/ }).click();
  await page.getByRole("checkbox", { name: "Use Miko, the AI helper, in this business" }).check();
  await expect(page.getByText("Miko switched on")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Ask Miko" })).toBeVisible();
});
