import { expect, test } from "@playwright/test";

test.describe("sign-in page", () => {
  test("offers only Google and email: one text field, no password", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { level: 1, name: "Sign in to Ledgerly" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Email me a code" })).toBeVisible();
    await expect(page.locator('input:not([type="hidden"])')).toHaveCount(1);
    await expect(page.getByLabel("Email")).toHaveAttribute("type", "email");
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
  });

  test("coming from onboarding, it talks about saving the workspace", async ({ page }) => {
    await page.goto("/login?method=email&next=%2Fwelcome");
    await expect(page.getByRole("heading", { level: 1, name: "Save your workspace" })).toBeVisible();
    await expect(page.getByLabel("Email")).toBeFocused();
  });

  test("an expired link explains what to do", async ({ page }) => {
    await page.goto("/login?error=link");
    await expect(page.getByRole("alert").filter({ hasText: "expired or was already used" })).toBeVisible();
  });

  test("an unknown error code shows nothing alarming", async ({ page }) => {
    await page.goto("/login?error=<script>alert(1)</script>");
    await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toHaveCount(0);
  });
});

test.describe("sign-in links", () => {
  test("a bad email link lands on sign-in with a clear message", async ({ page }) => {
    await page.goto("/auth/confirm?token_hash=not-a-real-token-hash&type=email");
    await expect(page).toHaveURL(/\/login\?error=link$/);
    await expect(page.getByRole("alert").filter({ hasText: "expired" })).toBeVisible();
  });

  test("a callback without a code cannot be used to redirect elsewhere", async ({ page }) => {
    await page.goto("/auth/callback?next=https://evil.example");
    await expect(page).toHaveURL(/\/login\?error=link$/);
  });

  test("a callback with a made-up code is refused", async ({ page }) => {
    await page.goto("/auth/callback?code=made-up-code&next=%2Fwelcome");
    await expect(page).toHaveURL(/\/login\?error=link$/);
  });
});

test.describe("signed-out visitors", () => {
  test("are sent to sign in from a workspace, and come back after", async ({ page }) => {
    await page.goto("/someone-1a2b");
    await expect(page).toHaveURL(/\/login\?next=%2Fsomeone-1a2b$/);
  });

  test("are sent to sign in from the building screen", async ({ page }) => {
    await page.goto("/welcome");
    await expect(page).toHaveURL(/\/login\?next=%2Fwelcome$/);
  });

  test("get a real 404 for addresses that cannot be a workspace", async ({ page }) => {
    const res = await page.goto("/Not_A_Workspace!");
    expect(res?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "We can't find that page" })).toBeVisible();
  });

  test("are redirected by the server, not by the page", async ({ request }) => {
    const res = await request.get("/someone-1a2b/money?tab=x", { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    expect(res.headers()["location"]).toBe("/login?next=%2Fsomeone-1a2b%2Fmoney%3Ftab%3Dx");
  });
});

test("onboarding's last screen signs in with Google through the server", async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem("ledgerly-onboarding")) return;
    localStorage.setItem(
      "ledgerly-onboarding",
      JSON.stringify({ v: 1, step: 8, answers: {} }),
    );
  });
  await page.goto("/start");
  const google = page.getByRole("button", { name: "Continue with Google" });
  await expect(google).toBeVisible();
  await expect(page.locator('form:has(button:text("Continue with Google")) input[name="next"]')).toHaveValue(
    "/welcome",
  );
  await expect(page.getByRole("link", { name: "Continue with email" })).toHaveAttribute(
    "href",
    "/login?method=email&next=%2Fwelcome",
  );
});
