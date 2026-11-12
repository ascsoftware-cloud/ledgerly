import { expect, test, type Page } from "@playwright/test";
import { cleanUp, hasAdminKey, publicPath, signIn, testEmail } from "./support/session";

test.skip(!hasAdminKey, "Add SUPABASE_SERVICE_ROLE_KEY to .env.local to run signed-in tests");

const created: string[] = [];
test.afterAll(async () => {
  if (hasAdminKey) await cleanUp(created);
});

async function sendDocument(page: Page, tag: string, kind: "invoice" | "quote") {
  const userId = await signIn(page, testEmail(tag), "/welcome", "Paula Public");
  created.push(userId);
  await expect(page).toHaveURL(/\/paula-[0-9a-f]{4}$/, { timeout: 15_000 });
  const home = new URL(page.url()).pathname;
  await page.goto(`${home}/clients/new`);
  await page.getByLabel("Name").fill("Thandi Mokoena");
  await page.getByRole("button", { name: "Add client" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Thandi Mokoena" })).toBeVisible();
  await page.goto(`${home}/money/new?kind=${kind}`);
  await page.getByLabel("Client", { exact: true }).filter({ visible: true }).selectOption({ label: "Thandi Mokoena" });
  await page.getByLabel("Line 1 description").filter({ visible: true }).fill("Bathroom tiling");
  await page.getByLabel("Line 1 price").filter({ visible: true }).fill("8 400");
  await page.getByRole("button", { name: `Save and send ${kind}` }).click();
  const number = kind === "quote" ? "QUO-0001" : "INV-0001";
  await expect(page.getByRole("heading", { level: 1, name: number })).toBeVisible();
  return { home, link: await publicPath(userId, number), docUrl: page.url() };
}

test("a client opens an invoice link without an account, and the business sees it was opened", async ({ page, browser }) => {
  const { home, link, docUrl } = await sendDocument(page, "pubinv", "invoice");

  const client = await browser.newContext();
  const c = await client.newPage();
  await c.goto(link);
  await expect(c.getByRole("heading", { level: 1, name: "Invoice INV-0001" })).toBeVisible();
  await expect(c.getByRole("region", { name: "Amount due" })).toContainText("R 8 400,00");
  await expect(c.getByRole("article", { name: "Invoice" })).toContainText("Bathroom tiling");
  await expect(c.getByRole("navigation")).toHaveCount(0);

  const pdf = await c.request.get(`${link}/pdf`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  await client.close();

  await page.goto(docUrl);
  await expect(page.getByText("Viewed", { exact: true })).toBeVisible();
  await page.goto(`${home}/clients`);
  await page.getByRole("link", { name: /Thandi Mokoena/ }).click();
  await expect(page.getByRole("region", { name: "Timeline" })).toContainText("Invoice INV-0001 opened by the client");

  const own = await page.request.get(`/api/documents/${docUrl.split("/").pop()}/pdf?ws=${home.slice(1)}`);
  expect(own.status()).toBe(200);
  expect((await own.body()).subarray(0, 5).toString()).toBe("%PDF-");
});

test("a client accepts a quote by typing their name", async ({ page, browser }) => {
  const { link, docUrl } = await sendDocument(page, "pubquote", "quote");

  const client = await browser.newContext();
  const c = await client.newPage();
  await c.goto(link);
  const form = c.getByRole("form", { name: "Accept this quote" });
  await form.getByRole("button", { name: "Accept quote" }).click();
  await expect(form.getByRole("alert")).toContainText("Type your full name.");
  await form.getByLabel("Your full name").fill("Thandi Mokoena");
  await form.getByRole("button", { name: "Accept quote" }).click();
  await expect(form.getByRole("alert")).toContainText("Tick the box");
  await form.getByRole("checkbox").check();
  await form.getByRole("button", { name: "Accept quote" }).click();
  await expect(c.getByText("Thanks, Thandi Mokoena.")).toBeVisible();
  await c.reload();
  await expect(c.getByRole("status").filter({ hasText: "Accepted on" })).toBeVisible();
  await expect(c.getByRole("form", { name: "Accept this quote" })).toHaveCount(0);
  await client.close();

  await page.goto(docUrl);
  await expect(page.getByText("Accepted", { exact: true })).toBeVisible();
});

test("a made-up link shows not found", async ({ page }) => {
  const res = await page.goto("/p/abcdefghijklmnopqrstuvwxyz012345");
  await expect(page.getByRole("heading", { name: "We can't find that page" })).toBeVisible();
  expect([200, 404]).toContain(res?.status());
  const pdf = await page.request.get("/p/abcdefghijklmnopqrstuvwxyz012345/pdf");
  expect(pdf.status()).toBe(404);
});
