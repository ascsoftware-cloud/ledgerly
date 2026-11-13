"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { archiveFile, archiveFolder, createFolder, fileLink, uploadFile, type FormResult } from "../actions";

export function UploadForm({ slug, folders, current }: { slug: string; folders: { id: string; name: string }[]; current: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [state, action, pending] = useActionState<FormResult, FormData>(async (prev, form) => {
    const r = await uploadFile(slug, prev, form);
    if (r.status === "saved") {
      toast.success(r.message);
      if (input.current) input.current.value = "";
      router.refresh();
    }
    return r;
  }, { status: "idle" });
  return (
    <form action={action} noValidate aria-label="Upload a file" className="grid gap-3 rounded-2xl border bg-card p-5 shadow-card sm:grid-cols-[2fr_1fr_auto] sm:items-end">
      <label className="space-y-1 text-sm font-medium">
        File <span className="font-normal text-muted-foreground">(PDF, photo, Word, Excel, text; up to 10 MB)</span>
        <input ref={input} name="file" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.txt,.csv,.docx,.xlsx" className="block w-full py-3 text-sm" />
      </label>
      <label className="space-y-1 text-sm font-medium">
        Folder
        <select name="folderId" defaultValue={current !== "all" && current !== "none" ? current : ""} className="h-12 w-full rounded-xl border bg-background px-3 text-base">
          <option value="">No folder</option>
          {folders.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </label>
      <Button type="submit" size="touch" disabled={pending}>
        {pending ? "Uploading…" : "Upload"}
      </Button>
      {state.status === "error" && (
        <p role="alert" className="text-sm text-destructive sm:col-span-3">
          {state.message}
        </p>
      )}
    </form>
  );
}

export function NewFolderForm({ slug }: { slug: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [state, action, pending] = useActionState<FormResult, FormData>(async (prev, form) => {
    const r = await createFolder(slug, prev, form);
    if (r.status === "saved") {
      toast.success(r.message);
      setName("");
      router.refresh();
    }
    return r;
  }, { status: "idle" });
  return (
    <form action={action} noValidate aria-label="New folder" className="flex flex-wrap items-end gap-2">
      <label className="space-y-1 text-sm font-medium">
        New folder
        <Input name="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Leases, Insurance…" maxLength={80} className="h-11 w-48 text-base" />
      </label>
      <Button type="submit" variant="outline" size="touch" disabled={pending}>
        Add folder
      </Button>
      {state.status === "error" && (
        <p role="alert" className="basis-full text-sm text-destructive">
          {state.message}
        </p>
      )}
    </form>
  );
}

export function FileActions({ slug, id, name }: { slug: string; id: string; name: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  return (
    <span className="flex flex-wrap items-center gap-1">
      <Button
        type="button"
        variant="outline"
        size="touch"
        disabled={pending}
        aria-label={`Open ${name}`}
        onClick={() =>
          start(async () => {
            const url = await fileLink(slug, id);
            if (!url) return void toast.error("Couldn't open that file.");
            window.open(url, "_blank", "noopener");
          })
        }
      >
        Open
      </Button>
      {confirming ? (
        <span className="flex gap-1" role="group" aria-label={`Archive ${name}?`}>
          <Button
            type="button"
            variant="destructive"
            size="touch"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await archiveFile(slug, id);
                setConfirming(false);
                if (!r.ok) return void toast.error("Couldn't archive that.");
                toast.success("File archived");
                router.refresh();
              })
            }
          >
            Yes, archive
          </Button>
          <Button type="button" variant="ghost" size="touch" onClick={() => setConfirming(false)}>
            Keep
          </Button>
        </span>
      ) : (
        <Button type="button" variant="ghost" size="touch" aria-label={`Archive ${name}`} onClick={() => setConfirming(true)}>
          Archive
        </Button>
      )}
    </span>
  );
}

export function ArchiveFolderButton({ slug, id, name }: { slug: string; id: string; name: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      variant="ghost"
      size="touch"
      disabled={pending}
      aria-label={`Remove folder ${name}`}
      onClick={() =>
        start(async () => {
          const r = await archiveFolder(slug, id);
          if (!r.ok) return void toast.error("Couldn't remove that folder.");
          toast.success(`Folder ${name} removed. Its files are still under “No folder”.`);
          router.push(`/${slug}/docs`);
        })
      }
    >
      Remove folder
    </Button>
  );
}
