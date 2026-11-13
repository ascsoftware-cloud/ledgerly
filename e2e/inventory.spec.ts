import { expect, test } from "@playwright/test";
import { admin, cleanUp, hasAdminKey, signIn, testEmail } from "./support/session";

test.skip(!hasAdminKey, "Add SUPABASE_SERVICE_ROLE_KEY to .env.local to run signed-in tests");

const created: string[] = [];
test.afterAll(async () => {
  if (hasAdminKey) await cleanUp(created);
});

test("a product is counted, taken off by an invoice, put back by a void and restocked by an order", async ({ page }) => {
  const userId = await signIn(page, testEmail("stock"), "/welcome", "Stella Stock");
  created.push(userId);
  await expect(page).toHaveURL(/\/stella-[0-9a-f]{4}$/, { timeout: 15_000 });
  const home = new URL(page.url()).pathname;

  // The Stock section shows for businesses that sell products; switch it on for this test business.
  const db = admin();
  const { data: ws } = await db.from("workspaces").select("id").eq("created_by", userId).single();
  await db.from("workspace_modules").upsert({ workspace_id: ws!.id, module: "inventory", enabled: true });
  await db.from("contacts").insert({ workspace_id: ws!.id, name: "Thandi Mokoena" });

  await page.goto(`${home}/stock`);
  await expect(page.getByRole("heading", { level: 1, name: "Stock" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No products yet" })).toBeVisible();

  // A supplier, then a counted product that warns at 5.
  await page.goto(`${home}/stock/suppliers/new`);
  await page.getByLabel("Supplier name").fill("Builders Warehouse");
  await page.getByRole("button", { name: "Add supplier" }).click();
  await expect(page.getByRole("list", { name: "Suppliers" })).toContainText("Builders Warehouse");

  await page.goto(`${home}/stock/new`);
  const form = page.getByRole("form", { name: "Add a product" });
  await form.getByRole("button", { name: "Add product" }).click();
  await expect(form.getByRole("alert")).toContainText("Name the product");
  await form.getByLabel("Name", { exact: true }).fill("Floor tile");
  await form.getByLabel("SKU or code").fill("TILE-1");
  await form.getByLabel("Selling price (R)").fill("95");
  await form.getByLabel(/What it costs you/).fill("60");
  await form.getByLabel("Keep count of how many I have").check();
  await form.getByLabel(/Warn me when I am down to/).fill("5");
  await form.getByLabel("How many do you have now?").fill("8");
  await form.getByRole("button", { name: "Add product" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Floor tile" })).toBeVisible();
  await expect(page.getByText("8", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("list", { name: "Stock history" })).toContainText("Opening stock");

  // A count correction is a movement too.
  const adjust = page.getByRole("form", { name: "Change stock" });
  await adjust.getByLabel("Add or remove").fill("-1");
  await adjust.getByLabel(/Why/).fill("Broken");
  await adjust.getByRole("button", { name: "Update stock" }).click();
  await expect(page.getByText("Stock is now 7.")).toBeVisible();

  // Invoice with that product: 3 tiles leaves 4, which is under the re-order level.
  await page.goto(`${home}/money/new?kind=invoice`);
  await page.getByLabel("Client", { exact: true }).filter({ visible: true }).selectOption({ label: "Thandi Mokoena" });
  await page.getByLabel("Line 1 product").selectOption({ label: "Floor tile (7 in stock)" });
  await expect(page.getByLabel("Line 1 description")).toHaveValue("Floor tile");
  await expect(page.getByLabel("Line 1 price")).toHaveValue("95,00");
  await page.getByLabel("Line 1 quantity").fill("3");
  await page.getByRole("button", { name: "Save and send invoice" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "INV-0001" })).toBeVisible();

  await page.goto(`${home}/stock`);
  await expect(page.getByRole("status", { name: "Low stock" })).toContainText("1 product needs re-ordering");
  await expect(page.getByRole("list", { name: "Products" })).toContainText("4");

  // Voiding the invoice returns the tiles.
  await page.goto(`${home}/money`);
  await page.getByRole("link", { name: /INV-0001/ }).first().click();
  await page.getByRole("button", { name: "Void" }).click();
  await page.getByRole("button", { name: /Yes, void/ }).click();
  await expect(page.getByText("INV-0001 voided")).toBeVisible();
  await page.goto(`${home}/stock`);
  await expect(page.getByRole("list", { name: "Products" })).toContainText("7");
  await expect(page.getByRole("status", { name: "Low stock" })).toHaveCount(0);

  // Order 20 from the supplier and receive them.
  await page.goto(`${home}/stock/orders/new`);
  await page.getByLabel("Supplier").selectOption({ label: "Builders Warehouse" });
  await page.getByRole("button", { name: "Start order" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /PO-0001/ })).toBeVisible();
  const add = page.getByRole("form", { name: "Add a product to the order" });
  await add.getByLabel("Product").selectOption({ label: "Floor tile" });
  await add.getByLabel("How many").fill("20");
  await add.getByRole("button", { name: "Add" }).click();
  await expect(page.getByRole("list", { name: "Products on this order" })).toContainText("20 × R 60,00");
  await page.getByRole("button", { name: "Mark as sent" }).click();
  await page.getByRole("button", { name: "Receive the goods" }).click();
  await expect(page.getByText("Received", { exact: false }).first()).toBeVisible();

  await page.goto(`${home}/stock`);
  await expect(page.getByRole("list", { name: "Products" })).toContainText("27");
});
