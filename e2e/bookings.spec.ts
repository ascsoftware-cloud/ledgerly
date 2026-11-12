import { expect, test } from "@playwright/test";
import { admin, cleanUp, hasAdminKey, signIn, testEmail } from "./support/session";

test.skip(!hasAdminKey, "Add SUPABASE_SERVICE_ROLE_KEY to .env.local to run signed-in tests");

const created: string[] = [];
test.afterAll(async () => {
  if (hasAdminKey) await cleanUp(created);
});

// A week from today in SAST: same weekday, safely in the future.
const sastNow = new Date(Date.now() + 2 * 3600_000);
const target = new Date(Date.UTC(sastNow.getUTCFullYear(), sastNow.getUTCMonth(), sastNow.getUTCDate() + 7));
const isoWeekday = ((target.getUTCDay() + 6) % 7) + 1;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayChip = `${DAYS[target.getUTCDay()]} ${target.getUTCDate()} ${MONTHS[target.getUTCMonth()]}`;

test("a client books a free slot, gets a calendar file, and the business sees it", async ({ page, browser }) => {
  const userId = await signIn(page, testEmail("bookings"), "/welcome", "Busi Bookings");
  created.push(userId);
  await expect(page).toHaveURL(/\/busi-[0-9a-f]{4}$/, { timeout: 15_000 });
  const slug = new URL(page.url()).pathname.slice(1);

  await page.goto(`/${slug}/settings/bookings`);
  const add = page.getByRole("form", { name: "Add a service" });
  await add.getByLabel("Service").fill("Cut");
  await add.getByLabel("Minutes").fill("45");
  await add.getByLabel("Gap after").fill("15");
  await add.getByLabel("Price (R)").fill("250");
  await add.getByRole("button", { name: "Add" }).click();
  await expect(page.getByRole("list", { name: "Services" })).toContainText("Cut · 45 min + 15 min gap · R 250,00");

  const hours = page.getByRole("form", { name: "Add opening hours" });
  await hours.getByLabel("Day").selectOption(String(isoWeekday));
  await hours.getByLabel("Opens").fill("09:00");
  await hours.getByLabel("Closes").fill("11:00");
  await hours.getByRole("button", { name: "Add hours" }).click();
  await expect(page.getByText("Hours added")).toBeVisible();
  await page.getByRole("switch", { name: "Take bookings online" }).click();
  await expect(page.getByText("Booking page is live")).toBeVisible();

  // A stranger books.
  const client = await browser.newPage();
  await client.goto(`/book/${slug}`);
  await expect(client.getByRole("heading", { level: 1, name: "Busi's business" })).toBeVisible();
  await client.getByRole("link", { name: /Cut/ }).click();
  await client.getByRole("link", { name: dayChip }).click();
  const times = client.getByRole("region", { name: "3. Choose a time" });
  await expect(times.getByRole("link")).toHaveText(["09:00", "09:15", "09:30", "09:45", "10:00", "10:15"]);
  await times.getByRole("link", { name: "09:00" }).click();
  const form = client.getByRole("form", { name: "Book" });
  await form.getByRole("button", { name: "Book" }).click();
  await expect(form.getByRole("alert")).toContainText("Type your name");
  await form.getByLabel("Your name").fill("Lerato Dube");
  await form.getByLabel(/Email/).fill("lerato.e2e@client.test");
  await form.getByLabel(/Phone/).fill("082 123 4567");
  await form.getByRole("button", { name: "Book" }).click();
  await expect(client.getByRole("heading", { name: "You're booked" })).toBeVisible();
  await expect(client.getByRole("region", { name: "Booking confirmed" })).toContainText("Cut with Busi's business");

  const ics = await client.request.get(await client.getByRole("link", { name: "Add to calendar" }).getAttribute("href") ?? "");
  expect(ics.status()).toBe(200);
  expect(ics.headers()["content-type"]).toContain("text/calendar");
  const body = await ics.text();
  expect(body).toContain("BEGIN:VEVENT\r\n");
  expect(body).toContain("SUMMARY:Cut with Busi's business");
  expect(body).not.toContain("lerato");

  // The slot and its 15-minute gap are gone for the next visitor.
  await client.goto(`/book/${slug}`);
  await client.getByRole("link", { name: /Cut/ }).click();
  await client.getByRole("link", { name: dayChip }).click();
  await expect(client.getByRole("region", { name: "3. Choose a time" }).getByRole("link")).toHaveText(["10:00", "10:15"]);
  await client.close();

  // A confirmation and a reminder were queued.
  const { data: outbox } = await admin().from("outbox").select("template").eq("to_address", "lerato.e2e@client.test");
  expect((outbox ?? []).map((o) => o.template).sort()).toEqual(["booking_confirmed", "booking_reminder"]);

  // The business sees it and can cancel.
  await page.goto(`/${slug}/work/bookings`);
  const item = page.getByRole("listitem", { name: "09:00 Lerato Dube" });
  await expect(item).toContainText("09:00–09:45");
  await expect(item).toContainText("Cut");
  await item.getByRole("button", { name: /Cancel Lerato Dube/ }).click();
  await item.getByRole("button", { name: "Yes, cancel it" }).click();
  await expect(page.getByText("Booking cancelled")).toBeVisible();
  await expect(page.getByRole("listitem", { name: "09:00 Lerato Dube" })).toContainText("Cancelled");
});
