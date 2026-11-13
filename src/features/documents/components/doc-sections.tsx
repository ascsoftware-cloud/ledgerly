import Link from "next/link";

const SECTIONS = [
  { key: "files", label: "Files", path: "" },
  { key: "contracts", label: "Contracts", path: "/contracts" },
  { key: "templates", label: "Templates", path: "/templates" },
] as const;

export function DocSections({ slug, current }: { slug: string; current: (typeof SECTIONS)[number]["key"] }) {
  return (
    <nav aria-label="Document sections" className="inline-flex rounded-xl bg-muted p-1">
      {SECTIONS.map((s) => (
        <Link
          key={s.key}
          href={`/${slug}/docs${s.path}`}
          aria-current={current === s.key ? "page" : undefined}
          className="flex h-11 items-center rounded-lg px-4 text-sm font-medium text-muted-foreground hover:text-foreground aria-[current=page]:bg-card aria-[current=page]:text-foreground aria-[current=page]:shadow-card"
        >
          {s.label}
        </Link>
      ))}
    </nav>
  );
}
