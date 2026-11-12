import { expect, test } from "@playwright/test";
import { cleanUp, hasAdminKey, signIn, testEmail } from "./support/session";

test.skip(!hasAdminKey, "Add SUPABASE_SERVICE_ROLE_KEY to .env.local to run signed-in tests");

const created: string[] = [];
test.afterAll(async () => {
  if (hasAdminKey) await cleanUp(created);
});

async function workspace(page: import("@playwright/test").Page, tag: string) {
  created.push(await signIn(page, testEmail(tag), "/welcome", "Clara Client"));
  await expect(page).toHaveURL(/\/clara-[0-9a-f]{4}$/, { timeout: 15_000 });
  return new URL(page.url()).pathname;
}

test("add a client, add a note, see it on the timeline, archive and undo", async ({ page }) => {
  const home = await workspace(page, "clients");
  await page.goto(`${home}/clients`);
  await expect(page.getByRole("heading", { name: "No clients yet" })).toBeVisible();
  await page.getByRole("link", { name: "Add your first client" }).click();

  await page.getByLabel("Name").fill("Thandi Mokoena");
  await page.getByLabel("Email").fill("Thandi@Acme.co.za");
  await page.getByLabel("Phone").fill("082 123 4567");
  await page.getByLabel("Company").fill("Acme Plumbing");
  await page.getByRole("button", { name: "Add client" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Thandi Mokoena" })).toBeVisible();
  await expect(page.getByText("Acme Plumbing")).toBeVisible();
  await expect(page.getByRole("link", { name: "thandi@acme.co.za" })).toBeVisible();
  await expect(page.getByRole("link", { name: "WhatsApp" })).toHaveAttribute("href", "https://wa.me/27821234567");
  await expect(page.getByText("Added as a client")).toBeVisible();

  await page.getByLabel("Add a note").fill("Prefers WhatsApp after 5pm");
  await page.getByRole("button", { name: "Add note" }).click();
  await expect(page.getByRole("region", { name: "Notes" }).getByText("Prefers WhatsApp after 5pm")).toBeVisible();
  await expect(page.getByRole("region", { name: "Timeline" }).getByText("Prefers WhatsApp after 5pm")).toBeVisible();

  // The quest step ticks itself.
  await page.goto(home);
  await expect(page.getByRole("region", { name: "Setup quest" })).toContainText("1 of 4 done");

  await page.goto(`${home}/clients?q=thand`);
  await page.getByRole("link", { name: /Thandi Mokoena/ }).click();
  await page.getByRole("button", { name: "Archive" }).click();
  await expect(page).toHaveURL(new RegExp(`${home}/clients(\\?archived=.*)?$`));
  await expect(page.getByText("Thandi Mokoena archived")).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Thandi Mokoena is back")).toBeVisible();
  await expect(page.getByRole("list", { name: "Clients" }).getByText("Thandi Mokoena")).toBeVisible();
});

test("the form explains mistakes next to the field", async ({ page }) => {
  const home = await workspace(page, "clientform");
  await page.goto(`${home}/clients/new`);
  await page.getByLabel("Name").fill("Sipho");
  await page.getByLabel("Phone").fill("12");
  await page.getByRole("button", { name: "Add client" }).click();
  await expect(page.getByText("That phone number doesn't look right.")).toBeVisible();
  await expect(page.getByLabel("Phone")).toHaveAttribute("aria-invalid", "true");
  // Nothing typed is lost.
  await expect(page.getByLabel("Name")).toHaveValue("Sipho");
  await expect(page.getByLabel("Phone")).toHaveValue("12");
});

test("CSV import checks every row first, then adds them all", async ({ page }) => {
  const home = await workspace(page, "import");
  await page.goto(`${home}/clients/import`);

  const bad = "Naam;Epos;Selfoon\nSipho Dube;sipho@x.test;082 555 1234\nBad Row;not-an-email;\n";
  await page.getByLabel("CSV file").setInputFiles({ name: "clients.csv", mimeType: "text/csv", buffer: Buffer.from(bad) });
  await expect(page.getByLabel("Column for Name")).toHaveValue("0");
  await expect(page.getByLabel("Column for Email")).toHaveValue("1");
  await expect(page.getByRole("list", { name: "Rows to fix" })).toContainText("Line 3: That email doesn't look right.");
  await expect(page.getByRole("button", { name: "Fix the rows above first" })).toBeDisabled();

  const good = "﻿Name,Email,Phone,Company\nSipho Dube,sipho@x.test,082 555 1234,Dube Builders\n\"Mokoena, Thandi\",,0821234567,\n";
  await page.getByLabel("CSV file").setInputFiles({ name: "clients.csv", mimeType: "text/csv", buffer: Buffer.from(good) });
  await page.getByRole("button", { name: "Import 2 clients" }).click();
  await expect(page.getByRole("heading", { name: "2 clients added" })).toBeVisible();

  await page.getByRole("link", { name: "See your clients" }).click();
  const list = page.getByRole("list", { name: "Clients" });
  await expect(list.getByText("Sipho Dube")).toBeVisible();
  await expect(list.getByText("Mokoena, Thandi")).toBeVisible();
});
