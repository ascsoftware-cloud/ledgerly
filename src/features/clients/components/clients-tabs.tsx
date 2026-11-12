import Link from "next/link";

/** Two views of the same people: the list, and the deals in progress. */
export function ClientsTabs({ slug, current }: { slug: string; current: "list" | "pipeline" }) {
  const tab = (key: "list" | "pipeline", href: string, label: string) => (
    <Link
      href={href}
      aria-current={current === key ? "page" : undefined}
      className="flex h-11 items-center rounded-lg px-4 text-sm font-medium text-muted-foreground hover:text-foreground aria-[current=page]:bg-card aria-[current=page]:text-foreground aria-[current=page]:shadow-card"
    >
      {label}
    </Link>
  );
  return (
    <nav aria-label="Client views" className="inline-flex rounded-xl bg-muted p-1">
      {tab("list", `/${slug}/clients`, "All clients")}
      {tab("pipeline", `/${slug}/clients/pipeline`, "Pipeline")}
    </nav>
  );
}
