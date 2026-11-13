import { unzipSync, strFromU8 } from "fflate";
import { expect, test } from "@playwright/test";
import { admin, cleanUp, hasAdminKey, signIn, testEmail } from "./support/session";

test.skip(!hasAdminKey, "Add SUPABASE_SERVICE_ROLE_KEY to .env.local to run signed-in tests");

const created: string[] = [];
test.afterAll(async () => {
  if (hasAdminKey) await cleanUp(created);
});

async function workspaceOf(owner: string) {
  const { data } = await admin().from("workspaces").select("id, slug").eq("created_by", owner).single();
  return data!;
}

test("export holds this business's data only; deleting a business has a grace period and can be undone", async ({ page }) => {
  const owner = await signIn(page, testEmail("priv"), "/welcome", "Priya Privacy");
  created.push(owner);
  await expect(page).toHaveURL(/\/priya-[0-9a-f]{4}$/, { timeout: 15_000 });
  const home = new URL(page.url()).pathname;
  const mine = await workspaceOf(owner);

  const db = admin();
  await db.from("contacts").insert({ workspace_id: mine.id, name: "Mine Client", email: "mine@client.test" });
  // Someone else's business, whose data must never appear.
  const other = await db.auth.admin.createUser({ email: testEmail("privother"), email_confirm: true });
  created.push(other.data.user!.id);
  const { data: otherWs } = await db.from("workspaces").insert({ slug: `other-${Date.now().toString(36)}`, name: "Other Co", created_by: other.data.user!.id }).select("id").single();
  await db.from("contacts").insert({ workspace_id: otherWs!.id, name: "Their Client", email: "theirs@client.test" });

  await page.goto(`${home}/more`);
  await page.getByRole("link", { name: /^Your data/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Your data" })).toBeVisible();

  // The export is a ZIP of this business only.
  const res = await page.request.get(`${home}/settings/data/export`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("application/zip");
  expect(res.headers()["content-disposition"]).toMatch(/ledgerly-priya-[0-9a-f]{4}-\d{4}-\d{2}-\d{2}\.zip/);
  const files = unzipSync(new Uint8Array(await res.body()));
  const contacts = JSON.parse(strFromU8(files["data/contacts.json"]!)) as { name: string }[];
  expect(contacts.map((c) => c.name)).toEqual(["Mine Client"]);
  const everything = Object.entries(files).filter(([n]) => n.startsWith("data/")).map(([, b]) => strFromU8(b)).join("\n");
  expect(everything).not.toContain("Their Client");
  expect(everything).not.toContain("theirs@client.test");
  expect(everything).not.toContain("Other Co");
  expect(JSON.parse(strFromU8(files["MANIFEST.json"]!)).business).toBe(mine.slug);

  // Deleting needs the business name, then waits 7 days and can be undone.
  const form = page.getByRole("form", { name: "Delete this business" });
  await form.getByLabel(/Type .* to confirm/).fill("wrong name");
  await form.getByRole("button", { name: "Delete this business" }).click();
  await expect(form.getByRole("alert")).toContainText("exactly");
  const name = (await form.locator("span.font-semibold").textContent())!.trim();
  await form.getByLabel(/Type .* to confirm/).fill(name);
  await form.getByRole("button", { name: "Delete this business" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "will be deleted on" })).toBeVisible();
  const { data: flagged } = await db.from("workspaces").select("deletion_requested_at").eq("id", mine.id).single();
  const days = (Date.now() - new Date(flagged!.deletion_requested_at as string).getTime()) / 86_400_000;
  expect(days).toBeLessThan(1);

  await page.getByRole("button", { name: "Keep this business" }).first().click();
  await expect(page.getByRole("alert").filter({ hasText: "will be deleted on" })).toHaveCount(0);
  const { data: cleared } = await db.from("workspaces").select("deletion_requested_at").eq("id", mine.id).single();
  expect(cleared!.deletion_requested_at).toBeNull();
});

test("account deletion needs DELETE, waits 7 days and can be undone", async ({ page }) => {
  const owner = await signIn(page, testEmail("privacct"), "/welcome", "Asha Account");
  created.push(owner);
  await expect(page).toHaveURL(/\/asha-[0-9a-f]{4}$/, { timeout: 15_000 });
  const home = new URL(page.url()).pathname;

  await page.goto(`${home}/settings/data`);
  const form = page.getByRole("form", { name: "Delete my account" });
  await form.getByLabel("Type DELETE to confirm").fill("delete");
  await form.getByRole("button", { name: "Delete my account" }).click();
  await expect(form.getByRole("alert")).toContainText("DELETE");
  await form.getByLabel("Type DELETE to confirm").fill("DELETE");
  await form.getByRole("button", { name: "Delete my account" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Your account will be deleted on" })).toBeVisible();
  await page.getByRole("button", { name: "Keep my account" }).first().click();
  await expect(page.getByRole("alert").filter({ hasText: "Your account will be deleted on" })).toHaveCount(0);
});

// The test server runs with this secret (playwright.config.ts); the real one lives in Vercel and Supabase Vault.
const SECRET = "e2e-only-jobs-secret-0123456789abcdef";

test("the daily job removes only what is due, files included, and refuses callers without the secret", async ({ page, request }) => {
  const owner = await signIn(page, testEmail("privjob"), "/welcome", "Jobe Purge");
  created.push(owner);
  await expect(page).toHaveURL(/\/jobe-[0-9a-f]{4}$/, { timeout: 15_000 });
  const mine = await workspaceOf(owner);
  const db = admin();
  const keep = await db.from("workspaces").insert({ slug: `keep-${Date.now().toString(36)}`, name: "Keeps", created_by: owner, deletion_requested_at: new Date(Date.now() - 2 * 86_400_000).toISOString() }).select("id").single();
  const path = `${mine.id}/proofs/${crypto.randomUUID()}.txt`;
  const up = await db.storage.from("documents").upload(path, Buffer.from("hello"), { contentType: "text/plain" });
  expect(up.error).toBeNull();
  await db.from("workspaces").update({ deletion_requested_at: new Date(Date.now() - 8 * 86_400_000).toISOString(), deletion_requested_by: owner }).eq("id", mine.id);
  const refused = await request.post("/api/jobs/purge", { headers: { Authorization: "Bearer wrong" } });
  expect(refused.status()).toBe(401);
  const run = await request.post("/api/jobs/purge", { headers: { Authorization: `Bearer ${SECRET}` } });
  expect(run.status()).toBe(200);
  expect((await run.json()).workspaces).toBeGreaterThanOrEqual(1);
  const { data: gone } = await db.from("workspaces").select("id").eq("id", mine.id);
  expect(gone).toEqual([]);
  const { data: remaining } = await db.storage.from("documents").list(mine.id);
  expect(remaining ?? []).toEqual([]);
  // A business still inside its 7 days is left alone.
  const { data: kept } = await db.from("workspaces").select("id").eq("id", keep.data!.id);
  expect(kept).toHaveLength(1);
});
