import Link from "next/link";

const TABS = [
  { key: "tasks", label: "Tasks", path: "" },
  { key: "projects", label: "Projects", path: "/projects" },
  { key: "bookings", label: "Bookings", path: "/bookings" },
] as const;

/** Work: what needs doing, the projects it belongs to, and who has booked a time. */
export function WorkTabs({ slug, current }: { slug: string; current: (typeof TABS)[number]["key"] }) {
  return (
    <nav aria-label="Work sections" className="inline-flex rounded-xl bg-muted p-1">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={`/${slug}/work${t.path}`}
          aria-current={current === t.key ? "page" : undefined}
          className="flex h-11 items-center rounded-lg px-4 text-sm font-medium text-muted-foreground hover:text-foreground aria-[current=page]:bg-card aria-[current=page]:text-foreground aria-[current=page]:shadow-card"
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
