"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { searchWorkspace, type SearchHit } from "../actions";
import { isTypingTarget, KIND_LABEL, nextKey, SHORTCUT_HELP, type NavPlace } from "../keys";

const SEQUENCE_MS = 1500;

/** The search button, the Ctrl/Cmd+K palette, the two-key shortcuts and the "?" help, all in one place. */
export function CommandCenter({ slug, nav, canCreate }: { slug: string; nav: NavPlace[]; canCreate: boolean }) {
  const router = useRouter();
  const [searchOpen, setSearchOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ q: string; list: SearchHit[] } | null>(null);
  const [active, setActive] = useState(0);
  const pending = useRef<{ key: string; timer: ReturnType<typeof setTimeout> } | null>(null);

  const term = q.trim();
  const list = hits && hits.q === term ? hits.list : [];
  const searching = term.length >= 2 && hits?.q !== term;

  // Keys: Ctrl/Cmd+K anywhere; the single-letter shortcuts never fire while typing or with a modifier held.
  useEffect(() => {
    function clear() {
      if (pending.current) clearTimeout(pending.current.timer);
      pending.current = null;
    }
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        clear();
        setSearchOpen((o) => !o);
        setQ("");
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || e.key.length > 1 && e.key !== "Escape") return;
      if (isTypingTarget(e.target as HTMLElement | null)) return;
      if (document.querySelector("[role=dialog]")) return;
      const out = nextKey(pending.current?.key ?? null, e.key, { slug, nav, canCreate });
      clear();
      if (out.pending) {
        const key = out.pending;
        pending.current = { key, timer: setTimeout(() => (pending.current = null), SEQUENCE_MS) };
      } else if (out.go) {
        e.preventDefault();
        router.push(out.go);
      } else if (out.help) {
        e.preventDefault();
        setHelpOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      clear();
    };
  }, [slug, nav, canCreate, router]);

  // Search as the person types, a moment after they stop. A newer search replaces an older one.
  useEffect(() => {
    if (term.length < 2) return;
    let stale = false;
    const t = setTimeout(async () => {
      const found = await searchWorkspace(slug, term).catch(() => []);
      if (!stale) {
        setHits({ q: term, list: found });
        setActive(0);
      }
    }, 200);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [term, slug]);

  function open(hit: SearchHit | undefined) {
    if (!hit) return;
    setSearchOpen(false);
    router.push(hit.href);
  }

  return (
    <>
      <Button variant="outline" size="icon" aria-label="Search" onClick={() => setSearchOpen(true)} className="size-11 rounded-full bg-card shadow-card">
        <Search className="size-5" aria-hidden />
      </Button>

      <Dialog
        open={searchOpen}
        onOpenChange={(o) => {
          setSearchOpen(o);
          if (!o) setQ("");
        }}
      >
        <DialogContent className="top-[20%] translate-y-0 gap-3 p-4 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Search</DialogTitle>
            <DialogDescription>Clients, invoices, quotes, tasks, projects and products. Press ? outside a box for shortcuts.</DialogDescription>
          </DialogHeader>
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, list.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                open(list[active]);
              }
            }}
            role="combobox"
            aria-expanded={list.length > 0}
            aria-controls="search-results"
            aria-activedescendant={list[active] ? `hit-${list[active].id}` : undefined}
            aria-label="Search your business"
            placeholder="Search…"
            maxLength={60}
            className="h-12 w-full rounded-xl border bg-background px-3 text-base"
          />
          <ul id="search-results" role="listbox" aria-label="Results" className="max-h-80 divide-y overflow-y-auto">
            {list.map((h, i) => (
              <li key={`${h.kind}-${h.id}`} id={`hit-${h.id}`} role="option" aria-selected={i === active}>
                <button type="button" onClick={() => open(h)} onMouseEnter={() => setActive(i)} className="flex min-h-12 w-full items-center gap-3 rounded-lg px-2 py-2 text-left data-[active=true]:bg-muted" data-active={i === active} tabIndex={-1}>
                  <span className="w-16 shrink-0 text-xs font-medium text-muted-foreground">{KIND_LABEL[h.kind] ?? h.kind}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{h.title}</span>
                    {h.subtitle && <span className="block truncate text-sm text-muted-foreground">{h.subtitle}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {term.length >= 2 && !searching && list.length === 0 && <p className="text-sm text-muted-foreground">Nothing found for “{term}”.</p>}
          {searching && <p className="text-sm text-muted-foreground">Searching…</p>}
          {term.length < 2 && <p className="text-sm text-muted-foreground">Type at least two letters.</p>}
        </DialogContent>
      </Dialog>

      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
            <DialogDescription>Shortcuts work when you are not typing in a box.</DialogDescription>
          </DialogHeader>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            {SHORTCUT_HELP.map((s) => (
              <div key={s.keys} className="contents">
                <dt className="font-mono font-medium">{s.keys}</dt>
                <dd className="text-muted-foreground">{s.does}</dd>
              </div>
            ))}
          </dl>
        </DialogContent>
      </Dialog>
    </>
  );
}
