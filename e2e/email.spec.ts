import { expect, test } from "@playwright/test";
import { admin, cleanUp, hasAdminKey, signIn, testEmail } from "./support/session";

test.skip(!hasAdminKey, "Add SUPABASE_SERVICE_ROLE_KEY to .env.local to run signed-in tests");

const created: string[] = [];
test.afterAll(async () => {
  if (hasAdminKey) await cleanUp(created);
});

test("emailing an invoice goes through the outbox once, even with a double tap", async ({ page }) => {
  const userId = await signIn(page, testEmail("email"), "/welcome", "Erin Email");
  created.push(userId);
  await expect(page).toHaveURL(/\/erin-[0-9a-f]{4}$/, { timeout: 15_000 });
  const home = new URL(page.url()).pathname;

  await page.goto(`${home}/clients/new`);
  await page.getByLabel("Name").fill("Thandi Mokoena");
  await page.getByLabel("Email").fill("thandi@client.invalid");
  await page.getByRole("button", { name: "Add client" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Thandi Mokoena" })).toBeVisible();

  await page.getByRole("link", { name: "New invoice" }).click();
  await page.getByLabel("Line 1 description").filter({ visible: true }).fill("Consulting");
  await page.getByLabel("Line 1 price").filter({ visible: true }).fill("2 000");
  await page.getByRole("button", { name: "Save and send invoice" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "INV-0001" })).toBeVisible();

  await page.getByRole("button", { name: "Email it" }).click();
  const form = page.getByRole("form", { name: "Email this document" });
  await expect(form.getByLabel("To")).toHaveValue("thandi@client.invalid");
  await form.getByLabel("Message").fill("Thanks for your business!");
  await form.getByRole("button", { name: "Send email" }).dblclick();
  await expect(page.getByText("Email on its way to thandi@client.invalid")).toBeVisible();

  const db = admin();
  const { data: ws } = await db.from("workspaces").select("id").eq("created_by", userId).single();
  await expect
    .poll(async () => {
      const { data } = await db.from("outbox").select("status, to_address, payload").eq("workspace_id", ws!.id);
      return data;
    }, { timeout: 15_000 })
    .toEqual([{ status: "sent", to_address: "thandi@client.invalid", payload: expect.objectContaining({ message: "Thanks for your business!" }) }]);
});

test("the jobs endpoint refuses callers without the secret", async ({ request }) => {
  const none = await request.post("/api/jobs/outbox");
  expect([401, 503]).toContain(none.status());
  const wrong = await request.post("/api/jobs/outbox", { headers: { Authorization: "Bearer not-the-secret-at-all-not-the-secret" } });
  expect([401, 503]).toContain(wrong.status());
});
