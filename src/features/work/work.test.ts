import { describe, expect, test } from "vitest";
import { boardColumns, calendarWeeks, moveStatus, sortForList, taskSchema, type TaskItem } from "./views";

const task = (id: string, over: Partial<TaskItem> = {}): TaskItem => ({
  id,
  title: `Task ${id}`,
  status: "todo",
  priority: "normal",
  due_date: null,
  project_id: null,
  parent_id: null,
  assignee_id: null,
  ...over,
});

const tasks = [
  task("a", { status: "doing", due_date: "2026-11-20", priority: "high" }),
  task("b", { due_date: "2026-11-03" }),
  task("c", { status: "done", due_date: "2026-12-01" }),
  task("d"),
  task("e", { due_date: "2026-11-30", priority: "low" }),
];

describe("one set of tasks, three views", () => {
  test("the board holds exactly the tasks in the list", () => {
    const board = boardColumns(tasks);
    expect(board.map((c) => c.key)).toEqual(["todo", "doing", "done"]);
    const onBoard = board.flatMap((c) => c.tasks.map((t) => t.id)).sort();
    expect(onBoard).toEqual(sortForList(tasks).map((t) => t.id).sort());
  });

  test("the calendar shows every task due that month, on its day, Monday-first", () => {
    const weeks = calendarWeeks("2026-11", tasks);
    expect(weeks[0]?.[0]?.date).toBe("2026-10-26"); // 1 Nov 2026 is a Sunday
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    const shown = weeks.flat().filter((d) => d.inMonth).flatMap((d) => d.tasks.map((t) => t.id)).sort();
    expect(shown).toEqual(["a", "b", "e"]);
    expect(weeks.flat().find((d) => d.date === "2026-11-20")?.tasks.map((t) => t.id)).toEqual(["a"]);
  });

  test("the list puts open work first: overdue and soonest due, high priority, undated, then done", () => {
    expect(sortForList(tasks).map((t) => t.id)).toEqual(["b", "a", "e", "d", "c"]);
  });
});

describe("moveStatus (keyboard-friendly board moves)", () => {
  test.each([
    ["todo", "right", "doing"],
    ["doing", "right", "done"],
    ["done", "right", "done"],
    ["doing", "left", "todo"],
    ["todo", "left", "todo"],
  ] as const)("%s → %s = %s", (from, dir, to) => {
    expect(moveStatus(from, dir)).toBe(to);
  });
});

describe("taskSchema", () => {
  const base = { title: " Measure walls ", projectId: "", dueDate: "20/11/2026", priority: "normal", assigneeId: "", notes: "" };
  test("reads a South African date and trims the title", () => {
    const r = taskSchema.safeParse(base);
    expect(r.success && r.data).toMatchObject({ title: "Measure walls", dueDate: "2026-11-20", projectId: null, assigneeId: null });
  });
  test.each([
    [{ title: "  " }, "Give the task a name"],
    [{ dueDate: "31/02/2026" }, "Use a date like"],
    [{ projectId: "nope" }, "Choose a project"],
    [{ priority: "urgent" }, "Pick a priority"],
  ])("%j is refused", (patch, message) => {
    const r = taskSchema.safeParse({ ...base, ...patch });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toContain(message);
  });
});
