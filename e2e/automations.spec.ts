import { expect, test } from "@playwright/test";
import { admin, cleanUp, hasAdminKey, signIn, testEmail } from "./support/session";

test.skip(!hasAdminKey, "Add SUPABASE_SERVICE_ROLE_KEY to .env.local to run signed-in tests");

const created: string[] = [];
test.afterAll(async () => {
  if (hasAdminKey) await cleanUp(created);
});

test("make a rule in plain words, see what it did, switch it off and delete it", async ({ page }) => {
  const owner = await signIn(page, testEmail("auto"), "/welcome", "Alma Auto");
  // The portal and automations are Pro features (0038): this business is upgraded the way billing would.
  await admin().from("workspaces").update({ plan: "pro" }).eq("created_by", owner);
  created.push(owner);
  await expect(page).toHaveURL(/\/alma-[0-9a-f]{4}$/, { timeout: 15_000 });
  const home = new URL(page.url()).pathname;

  await page.goto(`${home}/more`);
  await page.getByRole("link", { name: /^Automations/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Automations" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No automations yet" })).toBeVisible();

  const form = page.getByRole("form", { name: "New automation" });
  await form.getByRole("button", { name: "Add rule" }).click();
  await expect(form.getByRole("alert")).toContainText("Name the rule");
  await form.getByLabel("Name").fill("Chase late invoices");
  await form.getByLabel("For how many days?").fill("500");
  await form.getByRole("button", { name: "Add rule" }).click();
  await expect(form.getByRole("alert")).toContainText("from 0 to 365");
  await form.getByLabel("For how many days?").fill("3");
  await form.getByLabel("Then").selectOption({ label: "Email the client a reminder" });
  await form.getByRole("button", { name: "Add rule" }).click();
  const rules = page.getByRole("list", { name: "Rules" });
  await expect(rules).toContainText("When an invoice is 3 days overdue, email the client a reminder.");

  // The choices follow the trigger: a task can only notify you; a booking counts hours; stock needs no number.
  await form.getByLabel("When").selectOption({ label: "A task is overdue" });
  await expect(form.getByLabel("Then").locator("option")).toHaveText(["Notify me"]);
  await form.getByLabel("When").selectOption({ label: "A booking is coming up" });
  await expect(form.getByLabel("For how many hours?")).toHaveValue("24");
  await form.getByLabel("When").selectOption({ label: "A product falls to its re-order level" });
  await expect(form.getByLabel(/For how many/)).toHaveCount(0);
  await form.getByLabel("Name").fill("Low stock alert");
  await form.getByRole("button", { name: "Add rule" }).click();
  await expect(rules).toContainText("When a product falls to its re-order level, notify me.");

  // The run log shows what a rule did.
  const db = admin();
  const { data: ws } = await db.from("workspaces").select("id").eq("created_by", owner).single();
  const { data: rule } = await db.from("automation_rules").select("id").eq("workspace_id", ws!.id).eq("name", "Chase late invoices").single();
  await db.from("automation_runs").insert({ workspace_id: ws!.id, rule_id: rule!.id, ref_key: "demo-1", outcome: "done", detail: "Reminder emailed to the client" });
  await db.from("automation_runs").insert({ workspace_id: ws!.id, rule_id: rule!.id, ref_key: "demo-2", outcome: "failed", detail: "This client has no email address" });
  await page.reload();
  const log = page.getByRole("list", { name: "Run log" });
  await expect(log).toContainText("Chase late invoices · Reminder emailed to the client");
  await expect(log).toContainText("Couldn't act: This client has no email address");

  // Off, then deleted after a confirm.
  await page.getByRole("checkbox", { name: /^On.*Chase late invoices/ }).uncheck();
  await expect(page.getByRole("checkbox", { name: /^On.*Chase late invoices/ })).not.toBeChecked();
  await page.getByRole("button", { name: "Delete Chase late invoices" }).click();
  await page.getByRole("button", { name: "Yes, delete" }).click();
  await expect(page.getByText("Rule deleted")).toBeVisible();
  await expect(rules).not.toContainText("Chase late invoices");
  await expect(rules).toContainText("Low stock alert");
});
