"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveTask, type WorkFormResult } from "../actions";

export type TaskInitial = { title: string; projectId: string; assigneeId: string; dueDate: string; priority: string; notes: string };
const EMPTY: TaskInitial = { title: "", projectId: "", assigneeId: "", dueDate: "", priority: "normal", notes: "" };

/** Add or edit a task: name it, and optionally give it a project, a person, a date and a priority. */
export function TaskForm({
  slug,
  taskId = null,
  parentId = null,
  projects,
  members,
  initial = EMPTY,
  after,
}: {
  slug: string;
  taskId?: string | null;
  parentId?: string | null;
  projects: { id: string; name: string }[];
  members: { id: string; name: string }[];
  initial?: TaskInitial;
  /** Where to go after saving a new task; edits stay on the page. */
  after?: string;
}) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const set = (k: keyof TaskInitial) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });
  const [state, action, pending] = useActionState<WorkFormResult, FormData>(async (prev, form) => {
    const r = await saveTask(slug, taskId, parentId, prev, form);
    if (r.status === "saved") {
      toast.success(r.message);
      if (!taskId) {
        setV(initial); // ready for the next one when "after" is this same page (subtasks)
        router.push(after ?? `/${slug}/work/tasks/${r.id}`);
        router.refresh();
      } else router.refresh();
    }
    return r;
  }, { status: "idle" });
  const field = "h-12 w-full rounded-xl border bg-background px-3 text-base";

  return (
    <form action={action} noValidate aria-label={taskId ? "Edit task" : parentId ? "Add a subtask" : "New task"} className="grid gap-4 rounded-2xl border bg-card p-5 shadow-card sm:grid-cols-2">
      <label className="space-y-1 text-sm font-medium sm:col-span-2">
        What needs doing
        <Input name="title" value={v.title} onChange={set("title")} className="h-12 text-base" maxLength={200} autoFocus={!taskId} />
      </label>
      {!parentId && (
        <label className="space-y-1 text-sm font-medium">
          Project
          <select name="projectId" value={v.projectId} onChange={set("projectId")} className={field}>
            <option value="">No project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="space-y-1 text-sm font-medium">
        Who
        <select name="assigneeId" value={v.assigneeId} onChange={set("assigneeId")} className={field}>
          <option value="">Anyone</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      <label className="space-y-1 text-sm font-medium">
        Due <span className="font-normal text-muted-foreground">(optional)</span>
        <Input name="dueDate" value={v.dueDate} onChange={set("dueDate")} placeholder="31/01/2027" inputMode="numeric" className="h-12 text-base" />
      </label>
      <label className="space-y-1 text-sm font-medium">
        Priority
        <select name="priority" value={v.priority} onChange={set("priority")} className={field}>
          <option value="low">Low</option>
          <option value="normal">Normal</option>
          <option value="high">High</option>
        </select>
      </label>
      <label className="space-y-1 text-sm font-medium sm:col-span-2">
        Notes <span className="font-normal text-muted-foreground">(optional)</span>
        <textarea name="notes" value={v.notes} onChange={set("notes")} rows={3} maxLength={2000} className="w-full rounded-xl border bg-background p-3 text-base" />
      </label>
      {state.status === "error" && (
        <p role="alert" className="text-sm text-destructive sm:col-span-2">
          {state.message}
        </p>
      )}
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" size="touch" disabled={pending}>
          {pending ? "Saving…" : taskId ? "Save changes" : parentId ? "Add subtask" : "Add task"}
        </Button>
      </div>
    </form>
  );
}
