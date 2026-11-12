"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/dates";
import { deleteTask, quickAddTask, setTaskStatus } from "../actions";
import { moveStatus, PRIORITY_LABEL, type TaskPriority, type TaskStatus } from "../views";

type Row = {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: string | null;
  projectName: string | null;
};

/** One task in the list: tick it done, open it, see when it is due. */
export function TaskRow({ slug, task, canWrite, today, showMoves = false }: { slug: string; task: Row; canWrite: boolean; today: string; showMoves?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [status, setStatus] = useState(task.status);
  const change = (next: TaskStatus, message?: string) => {
    // Show the change at once (outside the transition), and roll back if saving fails.
    const prev = status;
    setStatus(next);
    start(async () => {
      const r = await setTaskStatus(slug, task.id, next);
      if (!r.ok) {
        setStatus(prev);
        toast.error("Couldn't update the task.");
      } else {
        if (message) toast.success(message);
        router.refresh();
      }
    });
  };
  const overdue = status !== "done" && task.due_date !== null && task.due_date < today;

  return (
    <li className="flex min-h-16 items-center gap-3 px-4 py-2" aria-label={task.title}>
      <input
        type="checkbox"
        checked={status === "done"}
        disabled={!canWrite || pending}
        onChange={(e) => change(e.target.checked ? "done" : "todo", e.target.checked ? "Done! +5 XP" : undefined)}
        aria-label={`Mark ${task.title} ${status === "done" ? "not done" : "done"}`}
        className="size-6 shrink-0 accent-primary"
      />
      <Link href={`/${slug}/work/tasks/${task.id}`} className="min-w-0 flex-1 py-2">
        <span className={`block truncate font-medium ${status === "done" ? "text-muted-foreground line-through" : ""}`}>{task.title}</span>
        <span className="block text-sm text-muted-foreground">
          {[task.projectName, task.due_date && `${overdue ? "Overdue · " : "Due "}${formatDate(task.due_date)}`, task.priority !== "normal" && `${PRIORITY_LABEL[task.priority]} priority`]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </Link>
      {showMoves && canWrite && (
        <span className="flex">
          <Button type="button" variant="ghost" size="icon-touch" aria-label={`Move ${task.title} back`} disabled={pending || status === "todo"} onClick={() => change(moveStatus(status, "left"))}>
            <ChevronLeft className="size-5" aria-hidden />
          </Button>
          <Button type="button" variant="ghost" size="icon-touch" aria-label={`Move ${task.title} forward`} disabled={pending || status === "done"} onClick={() => change(moveStatus(status, "right"))}>
            <ChevronRight className="size-5" aria-hidden />
          </Button>
        </span>
      )}
    </li>
  );
}

/** Type what needs doing, press Enter. Details can come later. */
export function QuickAddTask({ slug, projectId = null }: { slug: string; projectId?: string | null }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [pending, start] = useTransition();
  return (
    <form
      aria-label="Add a task"
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await quickAddTask(slug, title, projectId);
          if (!r.ok) return void toast.error(r.message ?? "Couldn't add the task.");
          setTitle("");
          toast.success("Task added");
          router.refresh();
        });
      }}
    >
      <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a task, e.g. Order tiles" aria-label="New task" className="h-12 flex-1 text-base" maxLength={200} />
      <Button type="submit" size="touch" disabled={pending || !title.trim()}>
        <Plus className="size-5" aria-hidden /> Add
      </Button>
    </form>
  );
}

/** Delete a task (and its subtasks) after a second tap. */
export function DeleteTask({ slug, taskId, after }: { slug: string; taskId: string; after: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  if (!confirming)
    return (
      <Button type="button" variant="ghost" size="touch" onClick={() => setConfirming(true)}>
        Delete
      </Button>
    );
  return (
    <span className="flex gap-1">
      <Button
        type="button"
        variant="destructive"
        size="touch"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await deleteTask(slug, taskId);
            if (!r.ok) return void toast.error("Couldn't delete the task.");
            toast.success("Task deleted");
            router.push(after);
          })
        }
      >
        Yes, delete it
      </Button>
      <Button type="button" variant="ghost" size="touch" onClick={() => setConfirming(false)}>
        Keep
      </Button>
    </span>
  );
}
