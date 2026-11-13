import { expect, test } from "@playwright/test";
import { admin, cleanUp, hasAdminKey, signIn, testEmail, userClient } from "./support/session";

test.skip(!hasAdminKey, "Add SUPABASE_SERVICE_ROLE_KEY to .env.local to run signed-in tests");

const created: string[] = [];
test.afterAll(async () => {
  if (hasAdminKey) await cleanUp(created);
});

// A 1x1 PNG (a PDF would open the browser download instead of a tab in headless Chromium).
const FILE = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

test("a template becomes a contract, the client signs it in the portal, and the link can be turned off", async ({ page, browser }, testInfo) => {
  const email = testEmail("docs");
  const owner = await signIn(page, email, "/welcome", "Dora Docs");
  created.push(owner);
  await expect(page).toHaveURL(/\/dora-[0-9a-f]{4}$/, { timeout: 15_000 });
  const home = new URL(page.url()).pathname;

  // A client with an email, and one sent invoice, made the way the app makes them.
  const me = await userClient(email);
  const { data: ws } = await me.from("workspaces").select("id").eq("created_by", owner).single();
  const workspace_id = ws!.id as string;
  const { data: contact } = await me.from("contacts").insert({ workspace_id, name: "Thandi Mokoena", email: "thandi@client.test" }).select("id").single();
  const { data: docId } = await me.rpc("save_document_draft", {
    p_workspace: workspace_id,
    p_id: null,
    p_doc: { kind: "invoice", contact_id: contact!.id },
    p_lines: [{ description: "Geyser", quantity: 1, unit_cents: 150000, vat_rate: 0 }],
  });
  expect((await me.rpc("send_document", { p_id: docId })).error).toBeNull();

  // A template with fields, including a built-in one and one the person fills in.
  await page.goto(`${home}/docs/templates/new`);
  const tform = page.getByRole("form", { name: "New template" });
  await tform.getByLabel("Template name").fill("Service agreement");
  await tform.getByLabel("Text", { exact: true }).fill("Agreement between {{business_name}} and {{client_name}}.\n\nThe price is {{price}}.\n<script>alert(1)</script>");
  await expect(tform.getByText("{{price}}", { exact: false }).first()).toBeVisible();
  await tform.getByRole("button", { name: "Save template" }).click();
  await expect(page.getByRole("list", { name: "Templates" })).toContainText("Asks for: price");

  // A contract from it: the form asks for the price.
  await page.goto(`${home}/docs/contracts/new`);
  const cform = page.getByRole("form", { name: "New contract" });
  await cform.getByRole("button", { name: "Make the contract" }).click();
  await expect(cform.getByRole("alert")).toContainText("Choose a client");
  await cform.locator('select[name="contactId"]').selectOption({ label: "Thandi Mokoena" });
  await cform.locator('select[name="templateId"]').selectOption({ label: "Service agreement" });
  await expect(cform.getByLabel("Title")).toHaveValue("Service agreement");
  await cform.getByRole("button", { name: "Make the contract" }).click();
  await expect(cform.getByRole("alert")).toContainText("price");
  await cform.getByLabel("price").fill("R 5 000");
  await cform.getByRole("button", { name: "Make the contract" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Service agreement" })).toBeVisible();
  await expect(page.locator('form[aria-label="Edit contract"] textarea')).toHaveValue(/Agreement between Dora's business and Thandi Mokoena\.\n\nThe price is R 5 000\./);

  // Send it: the client's portal link appears.
  await page.getByRole("button", { name: "Send for signing" }).click();
  const linkBox = page.getByLabel("Your client signs here (their portal link)");
  await expect(linkBox).toBeVisible();
  const link = await linkBox.inputValue();
  expect(link).toMatch(/\/portal\/[A-Za-z0-9_-]{32}$/);
  const portalPath = new URL(link).pathname;

  // The client opens the portal signed out, on their own device.
  const guest = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
  const gp = await guest.newPage();
  await gp.goto(portalPath);
  await expect(gp.getByRole("heading", { level: 1, name: "Your documents" })).toBeVisible();
  await expect(gp.getByText("Hi Thandi Mokoena.")).toBeVisible();
  const invoices = gp.getByRole("list", { name: "Invoices and quotes" });
  await expect(invoices).toContainText("Invoice INV-0001");
  await expect(invoices).toContainText("R 1 500,00");
  await expect(invoices.getByRole("link", { name: /INV-0001/ })).toHaveAttribute("href", /^\/p\/[A-Za-z0-9_-]{32}$/);
  await expect(gp.getByRole("list", { name: "Contracts" })).toContainText("Waiting for your signature");

  await gp.getByRole("link", { name: /Service agreement/ }).click();
  // The text is shown as text: markup in it is visible, not run.
  await expect(gp.getByLabel("Contract text")).toContainText("<script>alert(1)</script>");
  await expect(gp.getByLabel("Contract text")).toContainText("The price is R 5 000.");
  const sign = gp.getByRole("form", { name: "Sign this contract" });
  await expect(sign.getByText(/ordinary electronic signature under the Electronic Communications and Transactions Act/)).toBeVisible();
  await sign.getByRole("button", { name: "Sign the contract" }).click();
  await expect(sign.getByRole("alert")).toContainText("Tick the box");
  await sign.getByLabel("Type your full name").fill("Thandi Mokoena");
  await sign.getByLabel(/I have read this contract/).check();
  const canvas = gp.getByLabel("Draw your signature (optional)");
  const box = (await canvas.boundingBox())!;
  await gp.mouse.move(box.x + 30, box.y + 40);
  await gp.mouse.down();
  await gp.mouse.move(box.x + 160, box.y + 90, { steps: 6 });
  await gp.mouse.move(box.x + 260, box.y + 50, { steps: 6 });
  await gp.mouse.up();
  await sign.getByRole("button", { name: "Sign the contract" }).click();
  // The page swaps the form for the signed notice at once.
  await expect(gp.getByRole("status")).toContainText("Signed by Thandi Mokoena");
  await expect(gp.getByRole("form", { name: "Sign this contract" })).toHaveCount(0);

  // The record: who, when, the fingerprint and the drawn mark.
  const db = admin();
  const { data: sig } = await db.from("contract_signatures").select("signer_name, document_hash, signature_image, user_agent").eq("workspace_id", workspace_id).single();
  expect(sig!.signer_name).toBe("Thandi Mokoena");
  expect(sig!.document_hash).toMatch(/^[0-9a-f]{64}$/);
  expect(sig!.signature_image).toMatch(/^data:image\/png;base64,/);
  expect(sig!.user_agent).toBeTruthy();

  await page.goto(`${home}/docs/contracts`);
  await expect(page.getByRole("list", { name: "Contracts" })).toContainText("Signed");
  await page.getByRole("link", { name: /Service agreement/ }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Signed by Thandi Mokoena" })).toBeVisible();
  await expect(page.getByText(sig!.document_hash)).toBeVisible();
  await expect(page.getByRole("img", { name: "Signature drawn by Thandi Mokoena" })).toBeVisible();

  // Turning the portal off makes the old link a 404.
  await page.goto(`${home}/clients/${contact!.id}`);
  await expect(page.getByRole("region", { name: "Client portal" })).toBeVisible();
  await page.getByRole("button", { name: "Turn off" }).click();
  await page.getByRole("button", { name: "Yes, turn it off" }).click();
  await expect(page.getByText("Portal turned off")).toBeVisible();
  await gp.goto(portalPath);
  await expect(gp.getByRole("heading", { level: 1, name: "We can't find that page" })).toBeVisible();
  await guest.close();

  // Files: upload, open with a short-lived link, and another business cannot fetch it.
  await page.goto(`${home}/docs`);
  const up = page.getByRole("form", { name: "Upload a file" });
  await up.getByLabel(/^File/).setInputFiles({ name: "Lease.png", mimeType: "image/png", buffer: FILE });
  await up.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByRole("list", { name: "Files" })).toContainText("Lease.png");
  const popup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open Lease.png" }).click();
  const opened = await popup;
  await expect.poll(() => opened.url(), { timeout: 15_000 }).toMatch(/\/storage\/v1\/object\/sign\/documents\/.+token=/);
  await opened.close();
  const { data: file } = await db.from("files").select("storage_path").eq("workspace_id", workspace_id).single();
  const outsiderEmail = testEmail("outsider");
  const outsider = await userClient(outsiderEmail);
  const { data: outsiderUser } = await outsider.auth.getUser();
  if (outsiderUser.user) created.push(outsiderUser.user.id);
  expect((await outsider.storage.from("documents").download(file!.storage_path as string)).data).toBeNull();
  expect((await outsider.storage.from("documents").createSignedUrl(file!.storage_path as string, 60)).data).toBeNull();
  await page.getByRole("button", { name: "Archive Lease.png" }).click();
  await page.getByRole("button", { name: "Yes, archive" }).click();
  await expect(page.getByText("File archived")).toBeVisible();
});
