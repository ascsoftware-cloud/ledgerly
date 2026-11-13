import { expect, test } from "@playwright/test";
import { cleanUp, hasAdminKey, signIn, testEmail } from "./support/session";

test.skip(!hasAdminKey, "Add SUPABASE_SERVICE_ROLE_KEY to .env.local to run signed-in tests");

const created: string[] = [];
test.afterAll(async () => {
  if (hasAdminKey) await cleanUp(created);
});

// The 15th of the current month in SAST, as a South African date and as ISO.
const sast = new Date(Date.now() + 2 * 3600_000);
const mm = String(sast.getUTCMonth() + 1).padStart(2, "0");
const yyyy = String(sast.getUTCFullYear());

test("a project with tasks and a subtask, ticked off, moved on the board and seen on the calendar", async ({ page }) => {
  const userId = await signIn(page, testEmail("work"), "/welcome", "Wanda Work");
  created.push(userId);
  await expect(page).toHaveURL(/\/wanda-[0-9a-f]{4}$/, { timeout: 15_000 });
  const home = new URL(page.url()).pathname;

  await page.goto(`${home}/work/projects/new`);
  const form = page.getByRole("form", { name: "New project" });
  await form.getByLabel("Project name").fill("Kitchen renovation");
  await form.getByLabel(/Hourly rate/).fill("450");
  await form.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Kitchen renovation" })).toBeVisible();
  await expect(page.getByText("R 450,00 per hour")).toBeVisible();

  const add = page.getByRole("form", { name: "Add a task" });
  await add.getByLabel("New task").fill("Measure walls");
  await add.getByRole("button", { name: "Add" }).click();
  await expect(page.getByRole("list", { name: "Tasks for Kitchen renovation" })).toContainText("Measure walls");
  await add.getByLabel("New task").fill("Order tiles");
  await add.getByRole("button", { name: "Add" }).click();
  await expect(page.getByRole("list", { name: "Tasks for Kitchen renovation" })).toContainText("Order tiles");

  // Details and a subtask.
  await page.getByRole("link", { name: /Order tiles/ }).click();
  const edit = page.getByRole("form", { name: "Edit task" });
  await edit.getByLabel("Due").fill(`15/${mm}/${yyyy}`);
  await edit.getByLabel("Priority").selectOption("high");
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Task updated.")).toBeVisible();
  const sub = page.getByRole("form", { name: "Add a subtask" });
  await sub.getByLabel("What needs doing").fill("Ask for samples");
  await sub.getByRole("button", { name: "Add subtask" }).click();
  await expect(page.getByRole("list", { name: "Subtasks" })).toContainText("Ask for samples");

  // Tick one off.
  await page.goto(`${home}/work`);
  await page.getByRole("checkbox", { name: "Mark Measure walls done" }).check();
  await expect(page.getByText("Done! +5 XP")).toBeVisible();

  // Board: move "Order tiles" from To do to Doing with the keyboard-friendly buttons.
  await page.getByRole("link", { name: "Board", exact: true }).click();
  await page.getByRole("region", { name: "To do" }).getByRole("button", { name: "Move Order tiles forward" }).click();
  await expect(page.getByRole("region", { name: "Doing" })).toContainText("Order tiles");
  await expect(page.getByRole("region", { name: "Done" })).toContainText("Measure walls");

  // Calendar: the dated task sits on the 15th.
  await page.getByRole("link", { name: "Calendar", exact: true }).click();
  await expect(page.getByRole("gridcell", { name: new RegExp(`^${yyyy}-${mm}-15, 1 due`) })).toContainText("Order tiles");
  await expect(page.getByText("Tasks without a due date are in the list view.")).toBeVisible();

  // Archiving a project can be undone at once, or restored later.
  await page.goto(`${home}/work/projects`);
  await page.getByRole("link", { name: /Kitchen renovation/ }).click();
  await page.getByRole("button", { name: "Archive project" }).click();
  await expect(page.getByText("Project archived")).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Project is back")).toBeVisible();
  await expect(page.getByRole("list", { name: "Projects" })).toContainText("Kitchen renovation");
  await page.getByRole("link", { name: /Kitchen renovation/ }).click();
  await page.getByRole("button", { name: "Archive project" }).click();
  await expect(page.getByRole("list", { name: "Projects" })).toHaveCount(0);
  await page.getByText(/Archived projects/).click();
  await page.getByRole("button", { name: "Restore Kitchen renovation" }).click();
  await expect(page.getByText("Kitchen renovation restored")).toBeVisible();
  await expect(page.getByRole("list", { name: "Projects" })).toContainText("Kitchen renovation");
});
