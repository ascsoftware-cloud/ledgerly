"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveProject, setProjectArchived, type WorkFormResult } from "../actions";

export type ProjectInitial = { name: string; contactId: string; rate: string; status: string; notes: string };
const EMPTY: ProjectInitial = { name: "", contactId: "", rate: "", status: "active", notes: "" };

export function ProjectForm({
  slug,
  projectId = null,
  clients,
  initial = EMPTY,
}: {
  slug: string;
  projectId?: string | null;
  clients: { id: string; name: string }[];
  initial?: ProjectInitial;
}) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const set = (k: keyof ProjectInitial) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });
  const [state, action, pending] = useActionState<WorkFormResult, FormData>(async (prev, form) => {
    const r = await saveProject(slug, projectId, prev, form);
    if (r.status === "saved") {
      toast.success(r.message);
      if (!projectId) router.push(`/${slug}/work/projects/${r.id}`);
      else router.refresh();
    }
    return r;
  }, { status: "idle" });
  const field = "h-12 w-full rounded-xl border bg-background px-3 text-base";

  return (
    <form action={action} noValidate aria-label={projectId ? "Edit project" : "New project"} className="grid gap-4 rounded-2xl border bg-card p-5 shadow-card sm:grid-cols-2">
      <label className="space-y-1 text-sm font-medium sm:col-span-2">
        Project name
        <Input name="name" value={v.name} onChange={set("name")} placeholder="Kitchen renovation" className="h-12 text-base" maxLength={120} autoFocus={!projectId} />
      </label>
      <label className="space-y-1 text-sm font-medium">
        Client <span className="font-normal text-muted-foreground">(optional)</span>
        <select name="contactId" value={v.contactId} onChange={set("contactId")} className={field}>
          <option value="">No client</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="space-y-1 text-sm font-medium">
        Hourly rate (R) <span className="font-normal text-muted-foreground">(for billable time)</span>
        <Input name="rate" value={v.rate} onChange={set("rate")} placeholder="450,00" inputMode="decimal" className="h-12 text-base" />
      </label>
      {projectId && (
        <label className="space-y-1 text-sm font-medium">
          Status
          <select name="status" value={v.status} onChange={set("status")} className={field}>
            <option value="active">Active</option>
            <option value="done">Finished</option>
          </select>
        </label>
      )}
      <label className="space-y-1 text-sm font-medium sm:col-span-2">
        Notes <span className="font-normal text-muted-foreground">(optional)</span>
        <textarea name="notes" value={v.notes} onChange={set("notes")} rows={2} maxLength={2000} className="w-full rounded-xl border bg-background p-3 text-base" />
      </label>
      {state.status === "error" && (
        <p role="alert" className="text-sm text-destructive sm:col-span-2">
          {state.message}
        </p>
      )}
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" size="touch" disabled={pending}>
          {pending ? "Saving…" : projectId ? "Save changes" : "Create project"}
        </Button>
      </div>
    </form>
  );
}

/** Owners and admins: archive a finished-with project. */
export function ArchiveProject({ slug, projectId }: { slug: string; projectId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="touch"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const r = await setProjectArchived(slug, projectId, true);
        setBusy(false);
        if (!r.ok) return toast.error("Couldn't archive the project.");
        router.push(`/${slug}/work/projects?archived=${projectId}`);
      }}
    >
      Archive project
    </Button>
  );
}

/** On the project list right after an archive: one toast, six seconds to undo. */
export function UndoProjectArchive({ slug, id }: { slug: string; id: string }) {
  const router = useRouter();
  const shown = useRef<string | null>(null);
  useEffect(() => {
    if (shown.current === id) return;
    shown.current = id;
    router.replace(`/${slug}/work/projects`, { scroll: false });
    toast("Project archived", {
      duration: 6000,
      action: {
        label: "Undo",
        onClick: async () => {
          const r = await setProjectArchived(slug, id, false);
          if (r.ok) {
            toast.success("Project is back");
            router.refresh();
          } else toast.error("Couldn't undo. Try again.");
        },
      },
    });
  }, [id, router, slug]);
  return null;
}

export function RestoreProject({ slug, id, name }: { slug: string; id: string; name: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      variant="ghost"
      size="touch"
      disabled={pending}
      aria-label={`Restore ${name}`}
      onClick={() =>
        start(async () => {
          const r = await setProjectArchived(slug, id, false);
          if (!r.ok) return void toast.error("Couldn't restore it.");
          toast.success(`${name} restored`);
          router.refresh();
        })
      }
    >
      Restore
    </Button>
  );
}
