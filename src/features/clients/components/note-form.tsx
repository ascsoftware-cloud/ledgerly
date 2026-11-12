"use client";

import { useActionState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { addNote } from "../actions";

type State = { status: "idle" | "error" | "saved"; message?: string };

export function NoteForm({ slug, contactId }: { slug: string; contactId: string }) {
  const [state, action, pending] = useActionState<State, FormData>(addNote.bind(null, slug, contactId), {
    status: "idle",
  });
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "saved") formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={action} className="space-y-2">
      <label htmlFor="note" className="sr-only">
        Add a note
      </label>
      <Textarea
        id="note"
        name="body"
        rows={3}
        placeholder="Add a note: what you discussed, what's next…"
        aria-invalid={state.status === "error"}
        className="text-base"
      />
      {state.status === "error" && (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      )}
      <Button type="submit" size="touch" variant="secondary" disabled={pending}>
        {pending ? "Saving…" : "Add note"}
      </Button>
    </form>
  );
}
