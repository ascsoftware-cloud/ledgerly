import Link from "next/link";

const SECTIONS = [
  { key: "sales", label: "Sales", path: "" },
  { key: "expenses", label: "Expenses", path: "/expenses" },
  { key: "bank", label: "Bank", path: "/bank" },
] as const;

/** Money in, money out, and the bank statement that ties them together. */
export function MoneySections({ slug, current }: { slug: string; current: (typeof SECTIONS)[number]["key"] }) {
  return (
    <nav aria-label="Money sections" className="inline-flex rounded-xl bg-muted p-1">
      {SECTIONS.map((s) => (
        <Link
          key={s.key}
          href={`/${slug}/money${s.path}`}
          aria-current={current === s.key ? "page" : undefined}
          className="flex h-11 items-center rounded-lg px-4 text-sm font-medium text-muted-foreground hover:text-foreground aria-[current=page]:bg-card aria-[current=page]:text-foreground aria-[current=page]:shadow-card"
        >
          {s.label}
        </Link>
      ))}
    </nav>
  );
}
