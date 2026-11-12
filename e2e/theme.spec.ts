import { expect, test } from "@playwright/test";

test("a saved theme and accent are applied before paint and reflected in the controls", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));

  await page.addInitScript(() => {
    localStorage.setItem("ledgerly-theme", "dark");
    localStorage.setItem("ledgerly-accent", "violet");
  });
  await page.goto("/styleguide");

  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-theme", "dark");
  await expect(html).toHaveAttribute("data-accent", "violet");

  // The controls must agree with what is applied, not with the server default.
  await expect(page.getByRole("button", { name: "dark", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("button", { name: "system", exact: true })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(page.getByRole("button", { name: "Violet" })).toHaveAttribute("aria-pressed", "true");
  expect(errors).toEqual([]);
});

test("choosing a theme and accent survives a reload", async ({ page }) => {
  await page.goto("/styleguide");
  await page.getByRole("button", { name: "dark", exact: true }).click();
  await page.getByRole("button", { name: "Sky" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveAttribute("data-accent", "sky");
  await expect(page.getByRole("button", { name: "Sky" })).toHaveAttribute("aria-pressed", "true");
});

test("system mode follows the device setting", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/styleguide");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});
