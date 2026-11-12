import { expect, test, type Page } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 } });

const next = (page: Page) => page.getByRole("button", { name: "Continue" });
const heading = (page: Page, name: string) => page.getByRole("heading", { level: 1, name });

async function answerFirstSix(page: Page) {
  await page.getByRole("radio", { name: "Freelancer" }).click();
  await next(page).click();
  await page.getByRole("radio", { name: "Just me" }).click();
  await next(page).click();
  await page.getByRole("checkbox", { name: "Getting paid" }).click();
  await page.getByRole("checkbox", { name: "Admin and paperwork" }).click();
  await next(page).click();
  await page.getByRole("checkbox", { name: "Invoices" }).click();
  await page.getByRole("checkbox", { name: "Clients" }).click();
  await next(page).click();
  await page.getByRole("checkbox", { name: "EFT" }).click();
  await next(page).click();
  await page.getByRole("radio", { name: "R20k – R100k" }).click();
  await next(page).click();
}

test("a new user completes all eight questions by tapping only", async ({ page }) => {
  await page.goto("/start");
  await expect(heading(page, "What are you building?")).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");

  await answerFirstSix(page);

  await expect(heading(page, "Pick your vibe")).toBeVisible();
  await page.getByRole("radio", { name: "Violet" }).click();
  await page.getByRole("radio", { name: "Dark" }).click();
  await next(page).click();

  await expect(heading(page, "How long each day?")).toBeVisible();
  await page.getByRole("radio", { name: "10 minutes" }).click();
  await next(page).click();

  await expect(heading(page, "Save your workspace")).toBeVisible();
  await expect(page.getByRole("link", { name: "Continue with Google" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Continue with email" })).toBeVisible();

  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("ledgerly-onboarding")!));
  expect(saved.answers).toEqual({
    business: "freelancer",
    team: "solo",
    headaches: ["getting_paid", "admin"],
    manage: ["invoices", "clients"],
    paid: ["eft"],
    revenue: "20k_100k",
    accent: "violet",
    mode: "dark",
    dailyMinutes: 10,
  });
});

test("nothing needs typing: no text fields on any question", async ({ page }) => {
  await page.goto("/start");
  await expect(page.locator("input, textarea, select")).toHaveCount(0);
  await answerFirstSix(page);
  await expect(heading(page, "Pick your vibe")).toBeVisible();
  await expect(page.locator("input, textarea, select")).toHaveCount(0);
});

test("Continue stays disabled until something is chosen, and Miko reacts", async ({ page }) => {
  await page.goto("/start");
  await expect(next(page)).toBeDisabled();
  await page.getByRole("radio", { name: "Trades" }).click();
  await expect(next(page)).toBeEnabled();
  await next(page).click();

  await page.getByRole("radio", { name: "Just me" }).click();
  await expect(page.getByRole("status")).toContainText("Nice, a one-person army!");
  await next(page).click();

  // Multi-select: deselecting the only choice disables Continue again.
  await expect(next(page)).toBeDisabled();
  const stock = page.getByRole("checkbox", { name: "Stock" });
  await stock.click();
  await expect(next(page)).toBeEnabled();
  await stock.click();
  await expect(next(page)).toBeDisabled();
});

test("'Not yet' clears other payment methods, and picking one clears 'Not yet'", async ({ page }) => {
  await page.goto("/start");
  await page.getByRole("radio", { name: "Agency" }).click();
  await next(page).click();
  await page.getByRole("radio", { name: "2–5 people" }).click();
  await next(page).click();
  await page.getByRole("checkbox", { name: "Stock" }).click();
  await next(page).click();
  await page.getByRole("checkbox", { name: "Invoices" }).click();
  await next(page).click();

  const cash = page.getByRole("checkbox", { name: "Cash" });
  const notYet = page.getByRole("checkbox", { name: "Not yet" });
  await cash.click();
  await notYet.click();
  await expect(cash).toHaveAttribute("aria-checked", "false");
  await expect(notYet).toHaveAttribute("aria-checked", "true");
  await cash.click();
  await expect(notYet).toHaveAttribute("aria-checked", "false");
});

test("Back returns to the previous question with its answer still selected", async ({ page }) => {
  await page.goto("/start");
  await expect(page.getByRole("button", { name: "Back" })).toBeHidden();
  await page.getByRole("radio", { name: "Agency" }).click();
  await next(page).click();
  await expect(heading(page, "How big is the team?")).toBeVisible();

  await page.getByRole("button", { name: "Back" }).click();
  await expect(heading(page, "What are you building?")).toBeVisible();
  await expect(page.getByRole("radio", { name: "Agency" })).toHaveAttribute("aria-checked", "true");
});

test("a refresh mid-flow resumes on the same question", async ({ page }) => {
  await page.goto("/start");
  await page.getByRole("radio", { name: "Online store" }).click();
  await next(page).click();
  await page.getByRole("radio", { name: "6–20 people" }).click();
  await next(page).click();
  await expect(heading(page, "What's your biggest headache?")).toBeVisible();

  await page.reload();
  await expect(heading(page, "What's your biggest headache?")).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "3");
});

test("corrupt saved progress starts again instead of crashing", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("ledgerly-onboarding", "{not json"));
  await page.goto("/start");
  await expect(heading(page, "What are you building?")).toBeVisible();
});

test("the vibe step changes the whole page's colours live", async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem("ledgerly-onboarding")) return;
    localStorage.setItem(
      "ledgerly-onboarding",
      JSON.stringify({
        v: 1,
        step: 6,
        answers: {
          business: "agency",
          team: "solo",
          headaches: ["stock"],
          manage: ["invoices"],
          paid: ["eft"],
          revenue: "none",
        },
      }),
    );
  });
  await page.goto("/start");
  await expect(heading(page, "Pick your vibe")).toBeVisible();
  // A default is preselected so the user can simply continue.
  await expect(next(page)).toBeEnabled();

  await page.getByRole("radio", { name: "Coral" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-accent", "coral");
  await page.getByRole("radio", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("the flow works with the keyboard alone", async ({ page }) => {
  await page.goto("/start");
  const freelancer = page.getByRole("radio", { name: "Freelancer" });
  await freelancer.focus();
  await page.keyboard.press("Space");
  await expect(freelancer).toHaveAttribute("aria-checked", "true");
  await next(page).focus();
  await page.keyboard.press("Enter");
  await expect(heading(page, "How big is the team?")).toBeVisible();
});

test("every option card is at least 44px tall", async ({ page }) => {
  await page.goto("/start");
  for (const card of await page.getByRole("radio").all()) {
    expect((await card.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  }
});

test("sound and vibration can be switched on and off", async ({ page }) => {
  await page.goto("/start");
  const sound = page.getByRole("button", { name: "Sound" });
  await expect(sound).toHaveAttribute("aria-pressed", "false");
  await sound.click();
  await expect(sound).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(page.getByRole("button", { name: "Sound" })).toHaveAttribute("aria-pressed", "true");
});
