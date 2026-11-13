import { expect, test } from "@playwright/test";
import { admin, cleanUp, hasAdminKey, signIn, testEmail } from "./support/session";

test.skip(!hasAdminKey, "Add SUPABASE_SERVICE_ROLE_KEY to .env.local to run signed-in tests");

const created: string[] = [];
test.afterAll(async () => {
  if (hasAdminKey) await cleanUp(created);
});

test("invite someone, refuse the wrong email, accept, change their role, remove them", async ({ page, browser }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  const owner = await signIn(page, testEmail("owner"), "/welcome", "Olga Owner");
  created.push(owner);
  await expect(page).toHaveURL(/\/olga-[0-9a-f]{4}$/, { timeout: 15_000 });
  const home = new URL(page.url()).pathname;

  await page.goto(`${home}/settings/team`);
  await expect(page.getByRole("heading", { level: 1, name: "Team" })).toBeVisible();
  await expect(page.getByRole("list", { name: "People with access" })).toContainText("Olga Owner");

  // Invite by email, with a role.
  const inviteeEmail = testEmail("invitee");
  const form = page.getByRole("form", { name: "Invite someone" });
  await form.getByRole("button", { name: "Send invitation" }).click();
  await expect(form.getByRole("alert")).toContainText("email");
  await form.getByLabel("Their email").fill(inviteeEmail);
  await form.getByLabel("Role").selectOption("staff");
  await expect(form.getByText(/No reports, team, settings or payment keys/)).toBeVisible();
  await form.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByText(`Invitation sent to ${inviteeEmail}.`)).toBeVisible();
  await expect(page.getByRole("list", { name: "Open invitations" })).toContainText(inviteeEmail);

  // The emailed link carries the token; tests read it from the outbox instead of an inbox.
  const db = admin();
  const { data: ws } = await db.from("workspaces").select("id").eq("created_by", owner).single();
  const { data: mail } = await db.from("outbox").select("payload").eq("workspace_id", ws!.id).eq("template", "team_invite").eq("to_address", inviteeEmail).single();
  const token = (mail!.payload as { token: string }).token;
  expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

  // Signed out, the link says who is asking and sends you to sign in.
  const outsider = await browser.newContext({ baseURL });
  const op = await outsider.newPage();
  await op.goto(`/invite/${token}`);
  await expect(op.getByRole("heading", { level: 1, name: /^Join / })).toBeVisible();
  await expect(op.getByText(/to the email address|email address the invitation went to/).first()).toBeVisible();
  await expect(op.getByRole("link", { name: "Sign in to accept" })).toHaveAttribute("href", new RegExp(`/login\\?next=%2Finvite%2F${token}`));

  // Someone else signed in with the link does not get in.
  const intruder = await signIn(op, testEmail("intruder"), `/invite/${token}`, "Ivan Intruder");
  created.push(intruder);
  await op.getByRole("button", { name: "Accept the invitation" }).click();
  await expect(op.getByText(/sent to a different email address/)).toBeVisible();
  await outsider.close();

  // The invited person signs in and joins.
  const guest = await browser.newContext({ baseURL });
  const gp = await guest.newPage();
  const guestId = await signIn(gp, inviteeEmail, `/invite/${token}`, "Gina Guest");
  created.push(guestId);
  await gp.getByRole("button", { name: "Accept the invitation" }).click();
  await expect(gp).toHaveURL(new RegExp(`${home}$`), { timeout: 15_000 });

  // Staff do not get a team page.
  await gp.goto(`${home}/settings/team`);
  await expect(gp.getByRole("heading", { level: 1, name: "We can't find that page" })).toBeVisible();
  await guest.close();

  // The owner sees the new member, can change the role, and the log says what happened.
  await page.goto(`${home}/settings/team`);
  const people = page.getByRole("list", { name: "People with access" });
  await expect(people).toContainText("Gina Guest");
  await expect(page.getByRole("list", { name: "Open invitations" })).toHaveCount(0);
  await page.getByLabel("Role for Gina Guest").selectOption("accountant");
  await expect(page.getByText("Gina Guest is now accountant")).toBeVisible();
  await expect(people).toContainText("Accountant");

  // Your own row offers leaving, never changing your role; the last owner cannot go.
  await expect(page.getByLabel("Role for Olga Owner")).toHaveCount(0);
  await page.getByRole("button", { name: "Leave this business" }).click();
  await page.getByRole("button", { name: "Yes, leave" }).click();
  await expect(page.getByText(/at least one owner/)).toBeVisible();

  await page.getByRole("button", { name: "Remove Gina Guest" }).click();
  await page.getByRole("button", { name: /Yes, remove Gina Guest/ }).click();
  await expect(page.getByText("Gina Guest removed")).toBeVisible();
  await expect(page.getByRole("list", { name: "People with access" })).not.toContainText("Gina Guest");

  await page.getByRole("link", { name: "Activity log" }).click();
  const log = page.getByRole("list", { name: "Activity" });
  await expect(log).toContainText(`Invited ${inviteeEmail} as staff`);
  await expect(log).toContainText("Gina Guest joined as staff");
  await expect(log).toContainText("role changed from staff to accountant");
  await expect(log).toContainText("Gina Guest was removed from the team");
});
