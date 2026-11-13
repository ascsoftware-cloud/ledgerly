"use client";

import { useRef, useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { askAssistant } from "../actions";

type Turn = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = ["Who owes me money?", "How is this month going?", "What stock is running low?"];

/** The "Ask" panel. The conversation lives only in this browser tab: it is not saved anywhere. */
export function AssistantPanel({ slug, used: initialUsed, limit }: { slug: string; used: number; limit: number }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [used, setUsed] = useState(initialUsed);
  const [pending, start] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);

  function ask(text: string) {
    const q = text.trim();
    if (!q || pending) return;
    setError(null);
    setQuestion("");
    const history = turns;
    setTurns([...history, { role: "user", content: q }]);
    start(async () => {
      const r = await askAssistant(slug, { question: q, history });
      if (r.status === "ok") {
        setTurns((t) => [...t, { role: "assistant", content: r.reply }]);
        setUsed(r.used);
      } else {
        setError(r.message);
      }
      endRef.current?.scrollIntoView({ block: "end" });
    });
  }

  return (
    <Sheet>
      <SheetTrigger render={<Button variant="outline" size="icon" aria-label="Ask Ledgerly" className="rounded-full bg-card shadow-card" />}>
        <Sparkles className="size-5" aria-hidden />
      </SheetTrigger>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b p-4 pr-14">
          <SheetTitle>Ask Ledgerly</SheetTitle>
          <SheetDescription>
            AI answers can be wrong: check figures that matter. Your question and the figures it needs are sent to our AI provider. Nothing is changed or saved.
          </SheetDescription>
        </SheetHeader>

        <div role="log" aria-label="Conversation" aria-live="polite" className="flex-1 space-y-3 overflow-y-auto p-4">
          {turns.length === 0 && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Try asking:</p>
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" onClick={() => ask(s)} className="flex min-h-11 w-full items-center rounded-xl border bg-card px-3 text-left text-sm hover:border-primary">
                  {s}
                </button>
              ))}
            </div>
          )}
          {turns.map((t, i) => (
            <p key={i} data-role={t.role} className={t.role === "user" ? "ml-8 rounded-2xl bg-primary px-3 py-2 text-primary-foreground" : "mr-8 rounded-2xl border bg-card px-3 py-2 whitespace-pre-wrap"}>
              {t.content}
            </p>
          ))}
          {pending && <p className="text-sm text-muted-foreground">Looking that up…</p>}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div ref={endRef} />
        </div>

        <form
          aria-label="Ask a question"
          className="space-y-2 border-t p-4"
          onSubmit={(e) => {
            e.preventDefault();
            ask(question);
          }}
        >
          <div className="flex gap-2">
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              maxLength={500}
              placeholder="Ask about your business…"
              aria-label="Your question"
              className="h-12 min-w-0 flex-1 rounded-xl border bg-background px-3 text-base"
            />
            <Button type="submit" size="touch" disabled={pending || !question.trim()}>
              Ask
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {used} of {limit} AI requests used this month
          </p>
        </form>
      </SheetContent>
    </Sheet>
  );
}
